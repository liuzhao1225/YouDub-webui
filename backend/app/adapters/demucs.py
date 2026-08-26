from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
import soundfile as sf

from ..config import REPO_ROOT, ffmpeg_binary, ffprobe_binary
from ..devices import resolve_device


SHIFTS = 3
DEFAULT_CHUNK_SECONDS = 600
OVERLAP_SECONDS = 10
FINALIZE_BLOCK_FRAMES = 1 << 20
LARGE_WAVE_FORMAT = "RF64"


def _device() -> str:
    return resolve_device("demucs").selected


def _chunk_seconds() -> int:
    raw = os.getenv("DEMUCS_CHUNK_SECONDS", "").strip()
    if not raw:
        return DEFAULT_CHUNK_SECONDS
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError("DEMUCS_CHUNK_SECONDS must be a positive integer.") from exc
    if value <= 0:
        raise RuntimeError("DEMUCS_CHUNK_SECONDS must be a positive integer.")
    return value


def _demucs_progress(info: dict, shifts: int) -> int:
    models = max(1, int(info.get("models") or 1))
    model_index = max(0, int(info.get("model_idx_in_bag") or 0))
    shift_index = max(0, int(info.get("shift_idx") or 0))
    audio_length = max(0, int(info.get("audio_length") or 0))
    segment_offset = max(0, int(info.get("segment_offset") or 0))
    segment_ratio = min(segment_offset / audio_length, 1) if audio_length else 0
    total_units = max(1, models * shifts)
    completed_units = model_index * shifts + shift_index + segment_ratio
    return max(0, min(99, int(completed_units / total_units * 100)))


def _chunk_plan(
    total_frames: int, chunk_frames: int, overlap_frames: int
) -> list[tuple[int, int, int]]:
    """Return (owned start, owned stop, read stop) windows for the whole track."""
    if total_frames <= 0:
        return []
    if chunk_frames <= 0:
        raise ValueError("chunk_frames must be positive")
    if overlap_frames < 0:
        raise ValueError("overlap_frames must not be negative")

    plan: list[tuple[int, int, int]] = []
    start = 0
    while start < total_frames:
        stop = min(start + chunk_frames, total_frames)
        if total_frames - stop <= overlap_frames:
            stop = total_frames
        plan.append((start, stop, min(stop + overlap_frames, total_frames)))
        start = stop
    return plan


def _crossfade(tail: np.ndarray, head: np.ndarray) -> np.ndarray:
    """Linearly blend the previous window's context into the next window."""
    length = min(len(tail), len(head))
    if length <= 0:
        return head
    ramp = np.linspace(0.0, 1.0, length, endpoint=False, dtype=np.float32)
    ramp = ramp.reshape(-1, *([1] * (head.ndim - 1)))
    blended = head.copy()
    blended[:length] = tail[:length] * (1.0 - ramp) + head[:length] * ramp
    return blended


def _probe_audio_channels(video_file: Path) -> int:
    result = subprocess.run(
        [
            ffprobe_binary(),
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=channels",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_file),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    raw = result.stdout.strip()
    try:
        channels = int(raw)
    except ValueError as exc:
        raise RuntimeError(
            f"FFprobe returned an invalid channel count for the first audio stream: {raw!r}"
        ) from exc
    if channels <= 0:
        raise RuntimeError(
            f"FFprobe returned an invalid channel count for the first audio stream: {raw!r}"
        )
    return channels


def _extract_audio(
    video_file: Path,
    destination: Path,
    sample_rate: int,
    channels: int,
) -> Path:
    """Decode the first stream with Demucs AudioFile's legacy channel semantics."""
    if channels != 2:
        raise RuntimeError(f"Demucs separation expects 2 audio channels, got {channels}.")
    source_channels = _probe_audio_channels(video_file)
    pan = "pan=stereo|c0=c0|c1=c0" if source_channels == 1 else "pan=stereo|c0=c0|c1=c1"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.unlink(missing_ok=True)
    subprocess.run(
        [
            ffmpeg_binary(),
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_file),
            "-vn",
            "-map",
            "0:a:0",
            "-af",
            pan,
            "-ar",
            str(sample_rate),
            "-c:a",
            "pcm_f32le",
            "-rf64",
            "auto",
            str(destination),
        ],
        check=True,
    )
    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError(f"FFmpeg produced no audio for separation: {video_file}")
    return destination


def _finalize(
    source: Path,
    destination: Path,
    peak: float,
    sample_rate: int,
    channels: int,
) -> None:
    """Apply Demucs-compatible global peak rescaling in a streaming second pass."""
    scale = 1.0 / max(1.01 * peak, 1.0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sf.SoundFile(source) as reader, sf.SoundFile(
        destination,
        "w",
        samplerate=sample_rate,
        channels=channels,
        subtype="PCM_16",
        format=LARGE_WAVE_FORMAT,
    ) as writer:
        while True:
            block = reader.read(FINALIZE_BLOCK_FRAMES, dtype="float32", always_2d=True)
            if len(block) == 0:
                break
            writer.write(block * scale)


def _separate_window(
    *,
    reader: sf.SoundFile,
    separator: Any,
    torch_module: Any,
    sample_rate: int,
    own_start: int,
    own_stop: int,
    window_stop: int,
    writers: dict[str, sf.SoundFile],
    tails: dict[str, np.ndarray | None],
    peaks: dict[str, float],
) -> None:
    """Infer and write one window while retaining only overlap tails on return."""
    reader.seek(own_start)
    window = reader.read(
        window_stop - own_start,
        dtype="float32",
        always_2d=True,
    )
    mix = torch_module.from_numpy(np.ascontiguousarray(window.T))
    _, stems = separator.separate_tensor(mix, sample_rate)

    vocals = stems.get("vocals")
    if vocals is None:
        raise RuntimeError("Demucs returned no vocals stem.")
    bgm = None
    for name, stem in stems.items():
        if name == "vocals":
            continue
        bgm = stem if bgm is None else bgm + stem
    if bgm is None:
        raise RuntimeError("Demucs returned no accompaniment stems.")

    own_frames = own_stop - own_start
    for name, stem in (("vocals", vocals), ("bgm", bgm)):
        samples = stem.detach().cpu().numpy().T
        core = samples[:own_frames]
        previous = tails[name]
        if previous is not None:
            core = _crossfade(previous, core)
        peaks[name] = max(
            peaks[name],
            float(np.abs(core).max(initial=0.0)),
        )
        writers[name].write(core)
        tails[name] = samples[own_frames:].copy()


def separate_audio(
    video_file: Path,
    session: Path,
    progress_callback: Callable[[int, str], None] | None = None,
) -> tuple[Path, Path]:
    chunk_seconds = _chunk_seconds()
    media_dir = session / "media"
    vocals_file = media_dir / "audio_vocals.wav"
    bgm_file = media_dir / "audio_bgm.wav"
    if vocals_file.exists() and bgm_file.exists():
        return vocals_file, bgm_file

    demucs_path = _demucs_source_path()
    sys.path.insert(0, str(demucs_path))

    import torch
    from demucs.api import Separator

    progress_state = {"index": 0, "total": 1, "last": -1}

    def emit_progress(progress: int) -> None:
        if progress_callback is None:
            return
        progress = max(progress_state["last"], min(99, progress))
        progress_state["last"] = progress
        progress_callback(
            progress,
            f"Separating audio {progress}% "
            f"(part {progress_state['index'] + 1}/{progress_state['total']})",
        )

    def report_progress(info: dict) -> None:
        within = _demucs_progress(info, SHIFTS) / 100.0
        total = max(1, progress_state["total"])
        emit_progress(int((progress_state["index"] + within) / total * 100))

    separator = Separator(
        model="htdemucs_ft",
        device=_device(),
        progress=True,
        shifts=SHIFTS,
        callback=report_progress,
    )
    sample_rate = separator.samplerate
    channels = separator.audio_channels

    tmp_dir = session / "tmp"
    source_wav = tmp_dir / "demucs_input.wav"
    vocals_raw = tmp_dir / "demucs_vocals.raw.rf64"
    bgm_raw = tmp_dir / "demucs_bgm.raw.rf64"
    temporary_files = (source_wav, vocals_raw, bgm_raw)
    for path in temporary_files:
        path.unlink(missing_ok=True)

    try:
        _extract_audio(video_file, source_wav, sample_rate, channels)
        peaks = {"vocals": 0.0, "bgm": 0.0}

        with (
            sf.SoundFile(source_wav) as reader,
            sf.SoundFile(
                vocals_raw,
                "w",
                samplerate=sample_rate,
                channels=channels,
                subtype="FLOAT",
                format=LARGE_WAVE_FORMAT,
            ) as vocals_writer,
            sf.SoundFile(
                bgm_raw,
                "w",
                samplerate=sample_rate,
                channels=channels,
                subtype="FLOAT",
                format=LARGE_WAVE_FORMAT,
            ) as bgm_writer,
        ):
            plan = _chunk_plan(
                len(reader),
                chunk_seconds * sample_rate,
                OVERLAP_SECONDS * sample_rate,
            )
            if not plan:
                raise RuntimeError(f"Extracted audio is empty: {source_wav}")
            progress_state["total"] = len(plan)
            writers = {"vocals": vocals_writer, "bgm": bgm_writer}
            tails: dict[str, np.ndarray | None] = {"vocals": None, "bgm": None}

            for index, (own_start, own_stop, window_stop) in enumerate(plan):
                progress_state["index"] = index
                _separate_window(
                    reader=reader,
                    separator=separator,
                    torch_module=torch,
                    sample_rate=sample_rate,
                    own_start=own_start,
                    own_stop=own_stop,
                    window_stop=window_stop,
                    writers=writers,
                    tails=tails,
                    peaks=peaks,
                )

                emit_progress(int((index + 1) / len(plan) * 100))

        _finalize(vocals_raw, vocals_file, peaks["vocals"], sample_rate, channels)
        _finalize(bgm_raw, bgm_file, peaks["bgm"], sample_rate, channels)
    except BaseException:
        vocals_file.unlink(missing_ok=True)
        bgm_file.unlink(missing_ok=True)
        raise
    finally:
        for path in temporary_files:
            path.unlink(missing_ok=True)

    return vocals_file, bgm_file


def _demucs_source_path() -> Path:
    demucs_path = REPO_ROOT / "submodule" / "demucs"
    api_file = demucs_path / "demucs" / "api.py"
    if api_file.exists():
        return demucs_path
    raise RuntimeError(
        "Demucs source submodule is missing or incomplete. "
        "Clone this repository with git and run: git submodule update --init --recursive. "
        "Do not use GitHub Download ZIP because it does not include submodules."
    )

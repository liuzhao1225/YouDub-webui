from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

from ..config import REPO_ROOT
from ..devices import resolve_device


def _device() -> str:
    return resolve_device("demucs").selected


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


def separate_audio(
    video_file: Path,
    session: Path,
    progress_callback: Callable[[int, str], None] | None = None,
) -> tuple[Path, Path]:
    demucs_path = _demucs_source_path()
    sys.path.insert(0, str(demucs_path))

    from demucs.api import Separator, save_audio

    media_dir = session / "media"
    vocals_file = media_dir / "audio_vocals.wav"
    bgm_file = media_dir / "audio_bgm.wav"
    if vocals_file.exists() and bgm_file.exists():
        return vocals_file, bgm_file

    shifts = 3

    def report_progress(info: dict) -> None:
        if progress_callback is None:
            return
        progress = _demucs_progress(info, shifts)
        progress_callback(progress, f"Separating audio {progress}%")

    separator = None
    separated = None
    vocals = None
    bgm = None
    stem = None
    source = None
    try:
        separator = Separator(
            model="htdemucs_ft",
            device=_device(),
            progress=True,
            shifts=shifts,
            callback=report_progress,
        )
        _, separated = separator.separate_audio_file(str(video_file))

        vocals = separated["vocals"]
        for stem, source in separated.items():
            if stem == "vocals":
                continue
            bgm = source if bgm is None else bgm + source

        save_audio(vocals, str(vocals_file), samplerate=separator.samplerate)
        save_audio(bgm, str(bgm_file), samplerate=separator.samplerate)
        return vocals_file, bgm_file
    finally:
        separator = None
        separated = None
        vocals = None
        bgm = None
        stem = None
        source = None


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

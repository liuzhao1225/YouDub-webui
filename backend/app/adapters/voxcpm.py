from __future__ import annotations

import io
import json
import os
import re
import shutil
from pathlib import Path
from typing import Callable

import soundfile as sf
from pydub import AudioSegment

from .. import runtime_security
from ..audio_mode import is_original_audio, target_text
from ..config import MODEL_CACHE_DIR

_MODEL = None

_PROMPT_CACHE_GENERATION_DEFAULTS = {
    "min_len": 2,
    "max_len": 4096,
    "retry_badcase": True,
    "retry_badcase_max_times": 3,
    "retry_badcase_ratio_threshold": 6.0,
}


def release_model() -> bool:
    global _MODEL
    was_loaded = _MODEL is not None
    _MODEL = None
    return was_loaded


def _model_path() -> Path:
    configured_dir = os.getenv("VOXCPM_MODEL_DIR")
    if configured_dir:
        return Path(configured_dir).expanduser()

    model_id = os.getenv("VOXCPM_MODEL", "OpenBMB/VoxCPM2")
    local_dir = MODEL_CACHE_DIR / model_id.replace("/", "__")
    from modelscope import snapshot_download

    downloaded = snapshot_download(model_id, local_dir=str(local_dir))
    return Path(downloaded)


def _load_model():
    global _MODEL
    if _MODEL is None:
        from voxcpm import VoxCPM

        _MODEL = VoxCPM.from_pretrained(
            str(_model_path()),
            load_denoiser=os.getenv("VOXCPM_LOAD_DENOISER", "false").lower() == "true",
        )
    return _MODEL


def _first_reference(files: list[Path], min_ms: int) -> Path | None:
    for path in files:
        if len(AudioSegment.from_file(path)) >= min_ms:
            return path
    if files:
        return files[0]
    return None


def _speaker(item: dict) -> str:
    speaker = item.get("speaker")
    if speaker is None:
        return "1"
    speaker = str(speaker).strip()
    return speaker or "1"


def _fallback_references(vocals_dir: Path, items: list[dict], min_ms: int) -> tuple[dict[str, Path], Path]:
    files = [
        vocals_dir / f"{index:04d}.wav"
        for index, item in enumerate(items, start=1)
        if not is_original_audio(item)
        and (vocals_dir / f"{index:04d}.wav").exists()
    ]
    if not files:
        raise FileNotFoundError("No vocal segments were generated for VoxCPM references.")

    global_fallback = _first_reference(files, min_ms) or files[0]
    speaker_files: dict[str, list[Path]] = {}
    for index, item in enumerate(items, start=1):
        if is_original_audio(item):
            continue
        reference = vocals_dir / f"{index:04d}.wav"
        if reference.exists():
            speaker_files.setdefault(_speaker(item), []).append(reference)

    fallbacks: dict[str, Path] = {}
    for speaker, refs in speaker_files.items():
        fallback = _first_reference(refs, min_ms)
        if fallback is not None:
            fallbacks[speaker] = fallback

    return fallbacks, global_fallback


def _tts_text(item: dict) -> str:
    text = target_text(item)
    if not isinstance(text, str) or not text.strip():
        raise ValueError("target text must be a non-empty string")
    text = text.replace("\n", " ")
    return re.sub(r"\s+", " ", text)


def _write_original_target_audio(
    output_file: Path,
    item: dict,
    original_vocals_file: Path,
) -> None:
    start = max(0, int(item.get("start_time", 0)))
    end = int(item.get("end_time", start))
    if end <= start:
        raise ValueError(f"Original audio does not cover target segment {start}-{end} ms")

    with sf.SoundFile(original_vocals_file) as source:
        start_frame = min(source.frames, max(0, int(start * source.samplerate / 1000)))
        end_frame = min(source.frames, int(end * source.samplerate / 1000))
        if end_frame <= start_frame:
            raise ValueError(
                f"Original audio does not cover target segment {start}-{end} ms"
            )
        source.seek(start_frame)
        frames = source.read(
            end_frame - start_frame,
            dtype="float32",
            always_2d=True,
        )
        if len(frames) <= 0:
            raise ValueError(
                f"Original audio does not cover target segment {start}-{end} ms"
            )

        encoded = io.BytesIO()
        sf.write(
            encoded,
            frames,
            source.samplerate,
            format="WAV",
            subtype="PCM_16",
        )
        encoded.seek(0)

    runtime_security.remove_private_file(output_file, missing_ok=True)
    with runtime_security.open_private_binary_exclusive(output_file) as handle:
        shutil.copyfileobj(encoded, handle)
        handle.flush()


def generate_tts(
    translation_file: Path,
    vocals_dir: Path,
    session: Path,
    progress_callback: Callable[[int, str], None] | None = None,
    *,
    original_vocals_file: Path | None = None,
) -> Path:
    output_dir = session / "segments" / "tts"
    output_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)
    if total == 0:
        if progress_callback:
            progress_callback(100, "No TTS clips to generate")
        return output_dir

    has_original_audio = any(is_original_audio(item) for item in items)
    if has_original_audio and original_vocals_file is None:
        raise ValueError("original_vocals_file is required for original audio items")

    if all(is_original_audio(item) for item in items):
        for index, item in enumerate(items, start=1):
            output_file = output_dir / f"{index:04d}.wav"
            assert original_vocals_file is not None
            _write_original_target_audio(output_file, item, original_vocals_file)
            if progress_callback:
                progress = round(index / total * 100)
                progress_callback(progress, f"Prepared {index}/{total} TTS clips")
        return output_dir

    model = _load_model()
    min_reference_ms = int(os.getenv("VOXCPM_MIN_REFERENCE_MS", "1200"))
    fallback_references, global_fallback = _fallback_references(vocals_dir, items, min_reference_ms)
    cfg_value = float(os.getenv("VOXCPM_CFG_VALUE", "2.0"))
    inference_timesteps = int(os.getenv("VOXCPM_INFERENCE_TIMESTEPS", "10"))

    fallback_caches = {}

    for index, item in enumerate(items, start=1):
        output_file = output_dir / f"{index:04d}.wav"
        if is_original_audio(item):
            assert original_vocals_file is not None
            _write_original_target_audio(output_file, item, original_vocals_file)
            if progress_callback:
                progress = round(index / total * 100)
                progress_callback(progress, f"Prepared {index}/{total} TTS clips")
            continue
        if not output_file.exists():
            reference = vocals_dir / f"{index:04d}.wav"
            text = _tts_text(item)
            if not reference.exists() or len(AudioSegment.from_file(reference)) < min_reference_ms:
                speaker = _speaker(item)
                if speaker not in fallback_caches:
                    fallback = fallback_references.get(speaker, global_fallback)
                    fallback_caches[speaker] = model.tts_model.build_prompt_cache(
                        reference_wav_path=str(fallback)
                    )
                result = model.tts_model.generate_with_prompt_cache(
                    target_text=text,
                    prompt_cache=fallback_caches[speaker],
                    cfg_value=cfg_value,
                    inference_timesteps=inference_timesteps,
                    **_PROMPT_CACHE_GENERATION_DEFAULTS,
                )
                wav_tensor, _, _ = result
                wav = wav_tensor.squeeze(0).cpu().numpy()
            else:
                wav = model.generate(
                    text=text,
                    reference_wav_path=str(reference),
                    cfg_value=cfg_value,
                    inference_timesteps=inference_timesteps,
                )
            sf.write(output_file, wav, model.tts_model.sample_rate)
        if progress_callback:
            progress = round(index / total * 100)
            progress_callback(progress, f"Prepared {index}/{total} TTS clips")

    return output_dir

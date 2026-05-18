from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import Callable
from pathlib import Path

import soundfile as sf
from pydub import AudioSegment

from ..config import MODEL_CACHE_DIR, device

log = logging.getLogger(__name__)
_MODEL = None

ProgressCallback = Callable[[int, int, str], None]


def _model_path() -> Path:
    configured_dir = os.getenv("VOXCPM_MODEL_DIR")
    if configured_dir:
        return Path(configured_dir).expanduser()

    model_id = os.getenv("VOXCPM_MODEL", "OpenBMB/VoxCPM2")
    local_dir = MODEL_CACHE_DIR / model_id.replace("/", "__")
    from modelscope import snapshot_download

    downloaded = snapshot_download(model_id, local_dir=str(local_dir))
    return Path(downloaded)


def _use_optimize() -> bool:
    configured = os.getenv("VOXCPM_OPTIMIZE", "").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        return False
    # torch.compile warmup on Windows can take many minutes before any clip is written.
    return sys.platform != "win32"


def _load_model():
    global _MODEL
    if _MODEL is None:
        from voxcpm import VoxCPM

        model_path = _model_path()
        load_denoiser = os.getenv("VOXCPM_LOAD_DENOISER", "false").lower() == "true"
        optimize = _use_optimize()
        dev = device()
        log.info(
            "Loading VoxCPM from %s (device=%s, optimize=%s, denoiser=%s)",
            model_path,
            dev,
            optimize,
            load_denoiser,
        )
        _MODEL = VoxCPM.from_pretrained(
            str(model_path),
            load_denoiser=load_denoiser,
            device=dev,
            optimize=optimize,
        )
        log.info("VoxCPM ready")
    return _MODEL


def _fallback_reference(vocals_dir: Path, min_ms: int) -> Path:
    files = sorted(vocals_dir.glob("*.wav"))
    if not files:
        raise FileNotFoundError("No vocal segments were generated for VoxCPM references.")
    for path in files:
        if len(AudioSegment.from_file(path)) >= min_ms:
            return path
    return files[0]


def generate_tts(
    translation_file: Path,
    vocals_dir: Path,
    session: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> Path:
    output_dir = session / "segments" / "tts"
    output_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)

    if on_progress:
        on_progress(0, total, "Loading VoxCPM model (first run may download weights)...")

    model = _load_model()
    min_reference_ms = int(os.getenv("VOXCPM_MIN_REFERENCE_MS", "1200"))
    fallback = _fallback_reference(vocals_dir, min_reference_ms)

    for index, item in enumerate(items, start=1):
        output_file = output_dir / f"{index:04d}.wav"
        if output_file.exists():
            if on_progress:
                on_progress(index, total, f"Clip {index}/{total} cached")
            continue
        if on_progress:
            on_progress(index, total, f"Generating clip {index}/{total}")
        reference = vocals_dir / f"{index:04d}.wav"
        if not reference.exists() or len(AudioSegment.from_file(reference)) < min_reference_ms:
            reference = fallback
        wav = model.generate(
            text=item.get("dst") or item.get("zh", ""),
            reference_wav_path=str(reference),
            cfg_value=float(os.getenv("VOXCPM_CFG_VALUE", "2.0")),
            inference_timesteps=int(os.getenv("VOXCPM_INFERENCE_TIMESTEPS", "10")),
        )
        sf.write(output_file, wav, model.tts_model.sample_rate)
        log.info("Wrote TTS clip %s/%s -> %s", index, total, output_file.name)

    return output_dir

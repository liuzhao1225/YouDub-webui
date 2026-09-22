"""Local Demucs invocation using the original first audio track."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from ..config import ffmpeg_binary
from .errors import ApiError
from .steps import Completed, StageContext
from .storage import data_directory

MODEL_FILES = {"htdemucs": "955717e8-8726e21a.th"}


def model_directory() -> Path:
    configured = os.getenv("YOUDUB_DEMUCS_MODELS_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else data_directory() / "models" / "demucs"


def available_models() -> list[str]:
    root = model_directory()
    return [name for name, filename in MODEL_FILES.items()
            if (root / filename).is_file() and (root / filename).stat().st_size > 0]


def run(context: StageContext, progress) -> Completed:
    from .media import _run_media
    import soundfile as sf

    context.check_cancel()
    selection = context.config.separation
    if selection is None or selection.adapter != "demucs" or selection.device == "remote":
        raise ApiError(422, "INVALID_CONFIG", "Separation requires a local Demucs model.", stage="separate")
    if selection.model not in available_models():
        raise ApiError(503, "MODEL_NOT_READY", "The selected local Demucs checkpoint is missing.", stage="separate")
    video = context.input_files.get("video")
    if video is None or not video.is_file():
        raise ApiError(500, "INPUT_MISSING", "The source video is missing.", stage="separate")
    directory = context.work_dir / "separation"
    directory.mkdir(parents=True, exist_ok=True)
    source = directory / "source.wav"
    vocals, background = directory / "vocals.wav", directory / "background.wav"
    progress(None, "Extracting the original stereo audio for separation")
    extracted = _run_media([
        ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
        "-i", str(video.resolve()), "-map", "0:a:0", "-vn", "-ar", "44100", "-ac", "2",
        "-c:a", "pcm_f32le", str(source.resolve()),
    ], check_cancel=context.check_cancel)
    if extracted.returncode:
        raise ApiError(500, "INVALID_MEDIA", "Source audio extraction failed.", stage="separate")
    progress(None, "Separating vocals and background with Demucs")
    result = _run_media([
        sys.executable, str(Path(__file__).with_name("separate_process.py")),
        "--model-path", str((model_directory() / MODEL_FILES[selection.model]).resolve()),
        "--audio-path", str(source.resolve()), "--vocals-path", str(vocals.resolve()),
        "--background-path", str(background.resolve()), "--device", selection.device,
    ], check_cancel=context.check_cancel)
    if result.returncode:
        try:
            error = json.loads(result.stderr.strip().splitlines()[-1])
        except (ValueError, IndexError):
            error = {}
        code = error.get("code")
        if code not in {"MODEL_NOT_READY", "INVALID_PROVIDER_RESULT", "INVALID_MEDIA"}:
            code = "WORKER_EXITED"
        raise ApiError(500, code, error.get("message", "The Demucs process failed."), stage="separate")
    try:
        original = sf.info(source)
        for path in (vocals, background):
            info = sf.info(path)
            if info.frames != original.frames or info.samplerate != 44100 or info.channels != 2:
                raise ValueError("Separated audio changed its source timeline or format")
    except (OSError, RuntimeError, ValueError) as exc:
        raise ApiError(502, "INVALID_PROVIDER_RESULT", "Separated audio is missing or has invalid timing.", stage="separate") from exc
    progress(1.0, "Vocals and background are ready")
    return Completed(output_files={"vocals": vocals, "background": background})

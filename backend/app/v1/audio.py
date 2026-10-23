"""Shared WAV metadata validation for media operations."""

from pathlib import Path
from .errors import ApiError


def audio_info(path: Path, *, stage: str):
    if not path.is_file() or path.stat().st_size == 0:
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "An audio file is missing or empty.", stage=stage)
    try:
        import soundfile as sf
    except ImportError as exc:
        raise ApiError(503, "MODEL_NOT_READY", "Install soundfile in the backend environment.", stage=stage) from exc
    try:
        info = sf.info(str(path))
        if info.format not in {"WAV", "WAVEX"} or info.frames <= 0 or info.samplerate <= 0 or info.channels not in {1, 2}:
            raise ValueError(f"Invalid WAV metadata: format={info.format}, frames={info.frames}, "
                             f"sample_rate={info.samplerate}, channels={info.channels}")
    except (OSError, RuntimeError, ValueError) as exc:
        raise ApiError(502, "INVALID_PROVIDER_RESULT", f"Audio {path.name} is not valid WAV audio: {exc}",
                       stage=stage, action="retry") from exc
    return info


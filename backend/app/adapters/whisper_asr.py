from __future__ import annotations

import json
import os
from pathlib import Path

from pydub import AudioSegment

from ..config import device

_MODEL = None

def _whisper_cache_file(name: str, download_root: str | None) -> Path:
    import whisper

    root = Path(download_root or os.path.expanduser("~/.cache/whisper"))
    url = whisper._MODELS.get(name)
    if not url:
        raise ValueError(f"Unknown Whisper model: {name}")
    return root / Path(url).name


def _remove_corrupt_whisper_cache(name: str, download_root: str | None) -> bool:
    path = _whisper_cache_file(name, download_root)
    if path.is_file():
        path.unlink()
        return True
    return False


def _load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    import whisper

    name = os.getenv("WHISPER_MODEL", "large-v3-turbo")
    download_root = os.getenv("WHISPER_DOWNLOAD_ROOT") or None
    dev = device()
    last_error: Exception | None = None

    for attempt in range(2):
        try:
            _MODEL = whisper.load_model(name, device=dev, download_root=download_root)
            return _MODEL
        except RuntimeError as exc:
            last_error = exc
            message = str(exc)
            checksum_failed = "SHA256 checksum" in message
            if attempt == 0 and checksum_failed and _remove_corrupt_whisper_cache(name, download_root):
                continue
            raise

    if last_error is not None:
        raise last_error
    raise RuntimeError("Failed to load Whisper model.")


def _to_ms(seconds: float) -> int:
    return int(round(float(seconds) * 1000))


def _convert_words(words: list) -> list:
    return [
        {
            "text": w.get("word", ""),
            "start_time": _to_ms(w.get("start", 0.0)),
            "end_time": _to_ms(w.get("end", 0.0)),
        }
        for w in words or []
    ]


def _convert_segments(segments: list) -> list:
    return [
        {
            "text": seg.get("text", "").strip(),
            "start_time": _to_ms(seg.get("start", 0.0)),
            "end_time": _to_ms(seg.get("end", 0.0)),
            "words": _convert_words(seg.get("words", [])),
        }
        for seg in segments
    ]


def recognize_speech(vocals_file: Path, session: Path, language: str) -> Path:
    metadata_dir = session / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    output_file = metadata_dir / "asr.json"
    if output_file.exists():
        return output_file

    model = _load_model()
    result = model.transcribe(
        str(vocals_file),
        language=language,
        word_timestamps=True,
        verbose=False,
    )

    utterances = _convert_segments(result.get("segments", []))
    if not utterances:
        raise RuntimeError("Whisper did not return any segments.")

    duration_ms = len(AudioSegment.from_file(vocals_file))
    payload = {
        "audio_info": {"duration": duration_ms},
        "result": {
            "text": (result.get("text") or "").strip(),
            "utterances": utterances,
        },
    }
    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_file

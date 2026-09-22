"""Local Whisper ASR with preserved source utterances and timestamps."""

from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .errors import ApiError
from .segments import Transcript
from .steps import Completed, StageContext
from .storage import data_directory


MODEL_NAMES = (
    "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
    "large-v1", "large-v2", "large-v3", "large-v3-turbo", "large", "turbo",
)


def model_directory() -> Path:
    configured = os.getenv("YOUDUB_WHISPER_MODELS_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else data_directory() / "models" / "whisper"


def available_models() -> list[str]:
    """Report checkpoint file metadata without importing/loading Whisper."""
    root = model_directory()
    return [name for name in MODEL_NAMES if (root / f"{name}.pt").is_file()
            and (root / f"{name}.pt").stat().st_size > 0]


def _invalid(message: str) -> ApiError:
    return ApiError(502, "INVALID_PROVIDER_RESULT", message, stage="asr", action="retry")


def _milliseconds(value: Any) -> int:
    try:
        valid = type(value) in {int, float} and math.isfinite(value) and value >= 0
        if valid:
            return round(value * 1000)
    except (OverflowError, ValueError):
        pass
    raise _invalid("Whisper returned an invalid segment timestamp.")


_MAX_SENTENCE_MS = 8000
_SENTENCE_PUNCTUATION = frozenset(".。!！?？,，;；:：、…")
_CLOSING_PUNCTUATION = "\"'”’)]}）】」』》"


def _sentence_parts(raw: dict, *, start_ms: int, end_ms: int) -> list[dict]:
    """Split on real word boundaries, retaining every source character.

    Whisper attaches punctuation to words and may emit zero-duration words.
    Keep those words with the preceding timed word (or the following one at
    the start), so punctuation never becomes an empty-duration subtitle.
    """
    if "words" not in raw:
        return [{"start_ms": start_ms, "end_ms": end_ms, "text": raw["text"]}]
    words = raw["words"]
    if not isinstance(words, list) or not words:
        raise _invalid("Whisper returned an empty or invalid word timestamp list.")

    timed_words = []
    previous_end = raw["start"]
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get("word"), str) or not word["word"].strip():
            raise _invalid("Whisper returned an empty or invalid word.")
        word_start, word_end = _milliseconds(word.get("start")), _milliseconds(word.get("end"))
        if (word["end"] < word["start"] or word["start"] < previous_end
                or word["end"] > raw["end"]):
            raise _invalid("Whisper returned inconsistent word timestamps.")
        previous_end = word["end"]
        timed_words.append({"start_ms": word_start, "end_ms": word_end, "text": word["word"]})

    text = "".join(word["text"] for word in timed_words)
    # Boundary whitespace can differ between token decoding and word alignment.
    # Preserve it from the original segment; all actual words/punctuation must match.
    if text.strip() != raw["text"].strip():
        raise _invalid("Whisper word text does not match its speech segment.")
    leading_space = raw["text"][:len(raw["text"]) - len(raw["text"].lstrip())]
    trailing_space = raw["text"][len(raw["text"].rstrip()):]
    timed_words[0]["text"] = leading_space + timed_words[0]["text"].lstrip()
    timed_words[-1]["text"] = timed_words[-1]["text"].rstrip() + trailing_space

    # Build indivisible units before choosing cuts. A zero-duration token after
    # punctuation belongs to that same unit rather than opening the next subtitle.
    units = []
    leading = None
    for word in timed_words:
        if word["end_ms"] == word["start_ms"]:
            if units:
                units[-1]["text"] += word["text"]
                units[-1]["end_ms"] = word["end_ms"]
            elif leading is None:
                leading = word.copy()
            else:
                leading["text"] += word["text"]
            continue
        unit = word.copy()
        if leading is not None:
            unit["text"] = leading["text"] + unit["text"]
            unit["start_ms"] = leading["start_ms"]
            leading = None
        units.append(unit)
    if not units:
        raise _invalid("Whisper returned speech with no positive-duration words.")

    parts = []
    current = None
    for unit in units:
        if unit["end_ms"] - unit["start_ms"] > _MAX_SENTENCE_MS:
            raise _invalid("A Whisper word exceeds the sentence duration limit and cannot be split safely.")
        if current is not None and unit["end_ms"] - current["start_ms"] > _MAX_SENTENCE_MS:
            parts.append(current)
            current = None
        if current is None:
            current = unit.copy()
        else:
            current["text"] += unit["text"]
            current["end_ms"] = unit["end_ms"]
        tail = current["text"].rstrip().rstrip(_CLOSING_PUNCTUATION)
        if tail and tail[-1] in _SENTENCE_PUNCTUATION and current["text"].strip():
            parts.append(current)
            current = None
    if current is not None:
        parts.append(current)
    if any(not part["text"].strip() for part in parts):
        raise _invalid("Whisper returned a word-timed sentence with no text.")
    return parts


def normalize_result(result: Any, *, duration_ms: int) -> dict:
    """Assign stable sentence IDs using source words and their real timestamps."""
    if not isinstance(result, dict):
        raise _invalid("Whisper did not return a transcription object.")
    language = result.get("language")
    if not isinstance(language, str) or not language.strip():
        raise _invalid("Whisper did not return the detected source language.")
    raw_segments = result.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise _invalid("Whisper did not return any speech segments.")
    segments = []
    for raw in raw_segments:
        if not isinstance(raw, dict) or not isinstance(raw.get("text"), str) or not raw["text"].strip():
            raise _invalid("Whisper returned an empty or invalid speech segment.")
        start_ms, end_ms = _milliseconds(raw.get("start")), _milliseconds(raw.get("end"))
        if end_ms <= start_ms or end_ms > duration_ms:
            raise _invalid("Whisper returned a segment outside the source media timeline.")
        speaker = raw.get("speaker_id", raw.get("speaker"))
        if speaker is not None:
            if not isinstance(speaker, str) or not speaker.strip():
                raise _invalid("Whisper returned an invalid speaker identifier.")
        for part in _sentence_parts(raw, start_ms=start_ms, end_ms=end_ms):
            segment = {"id": f"segment-{len(segments) + 1:06d}", **part}
            if speaker is not None:
                segment["speaker_id"] = speaker
            segments.append(segment)
    return Transcript.model_validate({"detected_language": language, "segments": segments}).model_dump(
        mode="json", exclude_none=True,
    )


def run(context: StageContext, progress: Callable[[float | None, str], None]) -> Completed:
    # media imports the Runtime catalog; defer this import so Runtime can query
    # checkpoint metadata without circular imports or loading model dependencies.
    from .media import _run_media

    context.check_cancel()
    selected = context.config.asr
    if selected.adapter != "whisper" or selected.device == "remote":
        raise ApiError(422, "INVALID_CONFIG", "ASR requires a local Whisper model and device.",
                       field="asr", stage="asr")
    if selected.model not in MODEL_NAMES:
        raise ApiError(503, "MODEL_NOT_READY", "The selected Whisper model is not supported.",
                       field="asr.model", stage="asr")
    checkpoint = model_directory() / f"{selected.model}.pt"
    if not checkpoint.is_file() or checkpoint.stat().st_size == 0:
        raise ApiError(503, "MODEL_NOT_READY", "The selected local Whisper checkpoint is missing or empty.",
                       field="asr.model", stage="asr")
    if selected.model.endswith(".en") and context.config.source_language not in {"auto", "en"}:
        raise ApiError(422, "UNSUPPORTED_LANGUAGE", "This Whisper checkpoint only supports English.",
                       field="source_language", stage="asr")
    audio = context.input_files.get("vocals", context.input_files.get("source_audio"))
    info_path = context.input_files.get("media_info")
    if audio is None or not audio.is_file() or audio.stat().st_size == 0:
        raise ApiError(500, "INPUT_MISSING", "The ASR input audio is missing or empty.", stage="asr")
    if info_path is None or not info_path.is_file():
        raise ApiError(500, "INPUT_MISSING", "Source media metadata is missing.", stage="asr")
    try:
        duration_ms = json.loads(info_path.read_text(encoding="utf-8"))["duration_ms"]
        if type(duration_ms) is not int or duration_ms <= 0:
            raise ValueError("invalid duration")
    except (ValueError, KeyError, TypeError) as exc:
        raise ApiError(500, "INVALID_MEDIA", "Source media duration is invalid.", stage="asr") from exc

    context.work_dir.mkdir(parents=True, exist_ok=True)
    raw_path = context.work_dir / "asr_raw.json"
    transcript_path = context.work_dir / "transcript.json"
    progress(None, "Transcribing source audio with Whisper")
    result = _run_media(
        [sys.executable, str(Path(__file__).with_name("asr_process.py")),
         "--model-path", str(checkpoint.resolve()), "--audio-path", str(audio.resolve()),
         "--output-path", str(raw_path.resolve()), "--device", selected.device,
         "--language", context.config.source_language,
         *(["--initial-prompt", selected.initial_prompt] if selected.initial_prompt else [])],
        check_cancel=context.check_cancel,
    )
    if result.returncode != 0:
        try:
            error = json.loads(result.stderr.strip().splitlines()[-1])
        except (ValueError, IndexError):
            error = {}
        known = {"MODEL_NOT_READY", "INPUT_MISSING", "INVALID_PROVIDER_RESULT"}
        if not isinstance(error, dict) or error.get("code") not in known or not isinstance(error.get("message"), str):
            error = {"code": "WORKER_EXITED", "message": f"Whisper process exited with code {result.returncode}."}
        status = 503 if error["code"] == "MODEL_NOT_READY" else 502
        raise ApiError(status, error["code"], error["message"], field=error.get("field"), stage="asr",
                       action="adjust_settings" if status == 503 else "retry") from RuntimeError(result.stderr)
    if not raw_path.is_file() or raw_path.stat().st_size == 0:
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "Whisper did not write the raw transcription.", stage="asr")
    try:
        raw_result = json.loads(raw_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise _invalid("Whisper wrote invalid transcription JSON.") from exc
    transcript = normalize_result(raw_result, duration_ms=duration_ms)
    context.check_cancel()
    transcript_path.write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    progress(1.0, "Source transcription is ready")
    return Completed(output_files={"asr_raw": raw_path, "transcript": transcript_path})

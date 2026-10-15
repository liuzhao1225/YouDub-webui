"""Local Whisper ASR with sentence postprocessing and source word timestamps."""

from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
from itertools import groupby
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .errors import ApiError
from .segments import Transcript
from .steps import Completed, StageContext
from ..paths import data_directory


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


def _english_sentences(transcript: Transcript) -> list[dict]:
    """Map pretrained Punkt boundaries onto whole Whisper words, without retiming."""
    try:
        from nltk.tokenize.punkt import PunktTokenizer

        tokenizer = PunktTokenizer("english")
    except (ImportError, LookupError, OSError) as exc:
        raise ApiError(503, "MODEL_NOT_READY", "English ASR postprocessing requires nltk and its punkt_tab data. "
                       "Install them in the backend Python environment.", field="asr", stage="asr") from exc

    sentences = []
    # Respect speaker metadata when supplied; ordinary Whisper needs no speaker ID.
    for speaker, group in groupby(transcript.segments, key=lambda segment: segment.speaker_id):
        words = []
        for segment in group:
            if segment.words is None:
                raise _invalid(f"English sentence postprocessing requires word timestamps: {segment.id}.")
            segment_words = list(segment.words)
            # ASR segments may omit separator whitespace. Normalize that boundary
            # in a copy so concatenation cannot turn two words into one.
            if words and not words[-1].text[-1].isspace() and not segment_words[0].text[0].isspace():
                segment_words[0] = segment_words[0].model_copy(update={"text": " " + segment_words[0].text})
            words.extend(segment_words)
        text = "".join(word.text for word in words)
        offsets, cursor = [], 0
        for word in words:
            offsets.append((cursor + len(word.text) - len(word.text.lstrip()),
                            cursor + len(word.text.rstrip())))
            cursor += len(word.text)

        index = 0
        for start, end in tokenizer.span_tokenize(text):
            first = index
            while index < len(words) and offsets[index][0] < end:
                if offsets[index][0] < start or offsets[index][1] > end:
                    raise _invalid("A sentence boundary falls inside one Whisper word; its timing cannot be split.")
                index += 1
            if first == index:
                raise _invalid("A detected sentence has no corresponding Whisper words.")
            selected = words[first:index]
            sentences.append({
                "id": f"segment-{len(sentences) + 1:06d}",
                "start_ms": selected[0].start_ms, "end_ms": selected[-1].end_ms,
                "text": "".join(word.text for word in selected),
                "words": [word.model_dump() for word in selected],
                **({"speaker_id": speaker} if speaker is not None else {}),
            })
        if index != len(words):
            raise _invalid("Sentence postprocessing did not account for every Whisper word.")
    return sentences


def normalize_result(result: Any, *, duration_ms: int) -> dict:
    """Validate raw ASR, then form English sentence units before translation.

    Raw provider data stays unchanged. English bounds come from the first/last
    word of each sentence; other languages retain the provider's segmentation.
    """
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
        segment = {"id": f"segment-{len(segments) + 1:06d}", "start_ms": start_ms,
                   "end_ms": end_ms, "text": raw["text"]}
        if speaker is not None:
            segment["speaker_id"] = speaker
        if raw.get("words") is not None:
            if not isinstance(raw["words"], list):
                raise _invalid("Whisper returned invalid word timestamps.")
            try:
                segment["words"] = [{"text": word["word"], "start_ms": _milliseconds(word["start"]),
                                     "end_ms": _milliseconds(word["end"])} for word in raw["words"]]
            except (KeyError, TypeError) as exc:
                raise _invalid("Whisper returned invalid word timestamps.") from exc
        segments.append(segment)
    try:
        transcript = Transcript.model_validate({"detected_language": language, "segments": segments})
        if language == "en":
            transcript = Transcript.model_validate({"detected_language": language,
                                                    "segments": _english_sentences(transcript)})
        return transcript.model_dump(mode="json", exclude_none=True)
    except ValidationError as exc:
        raise _invalid("Whisper word timing or text does not match its source utterance.") from exc


def run(context: StageContext, progress: Callable[[float | None, str], None]) -> Completed:
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

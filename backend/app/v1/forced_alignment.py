"""Qwen word timing for subtitle display on already adjusted, complete speech."""

from __future__ import annotations

import json
import math
import os
import sys
from collections.abc import Callable
from pathlib import Path

from .errors import ApiError
from .segments import Segment
from .steps import StageContext
from .storage import data_directory

MODEL_NAME = "Qwen3-ForcedAligner-0.6B-hf"
MAX_AUDIO_DURATION_MS = 300_000


def model_directory() -> Path:
    configured = os.getenv("YOUDUB_FORCED_ALIGNER_MODEL_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else data_directory() / "models" / "qwen3-forced-aligner" / MODEL_NAME


def available_models() -> list[str]:
    root = model_directory()
    required = ("config.json", "model.safetensors", "processor_config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja")
    return [MODEL_NAME] if all((root / name).is_file() and (root / name).stat().st_size > 0 for name in required) else []


def _invalid(message: str) -> ApiError:
    return ApiError(502, "INVALID_PROVIDER_RESULT", message, stage="export", action="retry")


def _letters(text: str) -> str:
    return "".join(char for char in text if char.isalnum()).casefold()


def word_cues(parts: list[str], words: object, start_ms: int, end_ms: int) -> list[tuple[int, int, str]]:
    """Map unchanged display text onto measured word boundaries, never split a word."""
    if not isinstance(words, list) or not words:
        raise _invalid("Qwen returned no aligned words.")
    normalized, timed, cursor = "", [], 0
    previous_end = 0
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get("text"), str):
            raise _invalid("Qwen returned an invalid aligned word.")
        values = (word.get("start_time"), word.get("end_time"))
        if any(type(value) not in {int, float} or not math.isfinite(value) for value in values):
            raise _invalid("Qwen returned an invalid word timestamp.")
        begin, end = [round(value * 1000) for value in values]
        letters = _letters(word["text"])
        if not letters or begin < previous_end or end < begin or end > end_ms - start_ms:
            raise _invalid("Qwen word timing lies outside the complete dubbed audio or is not monotonic.")
        timed.append((cursor, cursor + len(letters), begin, end))
        normalized += letters
        cursor += len(letters)
        previous_end = end
    if normalized != _letters("".join(parts)):
        raise _invalid("Qwen aligned text does not match the complete translation.")

    boundaries = {word[1]: index + 1 for index, word in enumerate(timed)}
    cues, pending, consumed, word_start = [], "", 0, 0
    for part in parts:
        pending += part
        consumed += len(_letters(part))
        word_end = boundaries.get(consumed)
        if word_end is None or word_end <= word_start:
            continue
        begin, end = timed[word_start][2], timed[word_end - 1][3]
        if end == begin:
            continue
        cues.append((start_ms + begin, start_ms + end, pending))
        word_start, pending = word_end, ""
    if pending:
        if not cues:
            raise _invalid("Qwen returned no positive-duration subtitle interval.")
        begin, end, text = cues[-1]
        cues[-1] = (begin, start_ms + timed[-1][3], text + pending)
    return cues


def align(
    context: StageContext, rows: list[tuple[Segment, str]], split_text: Callable[[str], list[str]],
    progress: Callable[[float | None, str], None],
) -> list[tuple[int, int, str]]:
    from .media import _run_media

    selection = context.config.subtitle_alignment
    if selection is None or selection.adapter != "qwen_forced_aligner" or selection.model != MODEL_NAME:
        raise ApiError(422, "INVALID_CONFIG", "Select the local Qwen forced aligner.", stage="export")
    if context.config.output_mode != "both" or selection.device == "remote":
        raise ApiError(422, "INVALID_CONFIG", "Qwen subtitle alignment requires local dubbed audio.", stage="export")
    if context.config.target_language not in {"en", "zh"}:
        raise ApiError(422, "UNSUPPORTED_LANGUAGE", "Qwen subtitle alignment currently supports English and Chinese.", stage="export")
    if not available_models():
        raise ApiError(503, "MODEL_NOT_READY", "Install the Qwen forced aligner in its local model directory.", stage="export")
    clips = []
    for index, (segment, text) in enumerate(rows, start=1):
        path = context.work_dir / "adjusted" / f"{index:04d}.wav"
        if not path.is_file():
            raise ApiError(500, "INPUT_MISSING", "The complete adjusted speech clip is missing.", stage="export")
        if segment.end_ms - segment.start_ms > MAX_AUDIO_DURATION_MS:
            raise ApiError(422, "UNSUPPORTED_MEDIA", "One Qwen alignment input must not exceed five minutes.", stage="export")
        clips.append({"segment_id": segment.id, "audio_path": str(path.resolve()), "text": text})
    folder = context.work_dir / "subtitle_alignment"
    folder.mkdir(exist_ok=True)
    request_path, output_path = folder / "request.json", folder / "words.json"
    request_path.write_text(json.dumps({"language": context.config.target_language, "clips": clips}, ensure_ascii=False, indent=2), encoding="utf-8")
    progress(None, "Aligning subtitle words to complete dubbed speech with Qwen")
    result = _run_media([
        sys.executable, str(Path(__file__).with_name("forced_alignment_process.py")),
        "--model-path", str(model_directory().resolve()), "--request-path", str(request_path.resolve()),
        "--output-path", str(output_path.resolve()), "--device", selection.device,
    ], check_cancel=context.check_cancel)
    if result.returncode:
        raise ApiError(502, "WORKER_EXITED", f"Qwen forced alignment exited with code {result.returncode}: {result.stderr[-1500:]}", stage="export", action="retry")
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        results = payload["clips"]
        if [item["segment_id"] for item in results] != [segment.id for segment, _ in rows]:
            raise ValueError("Alignment IDs differ")
        cues = []
        for (segment, text), result in zip(rows, results, strict=True):
            cues.extend(word_cues(split_text(text), result["words"], segment.start_ms, segment.end_ms))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise _invalid("The Qwen alignment output does not match the speech clips.") from exc
    (folder / "cues.json").write_text(json.dumps([
        {"start_ms": start, "end_ms": end, "text": text} for start, end, text in cues
    ], ensure_ascii=False, indent=2), encoding="utf-8")
    return cues

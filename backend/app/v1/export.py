"""Export the selected subtitles, dubbing or combined media on the source video."""

from __future__ import annotations

import json
import os
import platform
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import soundfile as sf

from ..adapters.ffmpeg import _srt_time, subtitle_style_for_orientation
from ..config import ffmpeg_binary
from . import media
from .audio_segments import read_alignment
from .errors import ApiError
from .segments import Segment, Transcript, Translation, read_transcript, read_translation
from .steps import Completed, StageContext


def _invalid(message: str) -> ApiError:
    return ApiError(500, "INVALID_PROVIDER_RESULT", message, stage="export", action="retry")


def _input_file(context: StageContext, name: str) -> Path:
    path = context.input_files.get(name)
    if path is None or not path.is_file():
        raise ApiError(500, "INPUT_MISSING", f"The {name} input is missing.", stage="export", action="retry")
    return path


def _read_json(context: StageContext, name: str) -> dict[str, Any]:
    path = _input_file(context, name)
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise _invalid(f"The {name} input is not valid JSON.") from exc
    if not isinstance(result, dict):
        raise _invalid(f"The {name} input must be an object.")
    return result


def _subtitle_rows(transcript: Transcript, translation: Translation, duration_ms: int) -> list[tuple[Segment, str]]:
    translations = translation.match(transcript)
    if any(item.end_ms > duration_ms for item in transcript.segments):
        raise _invalid("Transcript timestamps extend beyond the source video.")
    return [(item, translations[item.id]) for item in transcript.segments]


def _write_srt(path: Path, rows: list[tuple[Segment, str]], *, translated: bool) -> None:
    cues = []
    for segment, translation in rows:
        text = translation if translated else segment.text
        for start, end, part in _display_cues(text, segment.start_ms, segment.end_ms):
            display_text = " ".join(part.split())
            cues.append(f"{len(cues) + 1}\n{_srt_time(start)} --> {_srt_time(end)}\n{display_text}\n")
    path.write_text("\n".join(cues), encoding="utf-8", newline="\n")


def _display_parts(text: str) -> list[str]:
    """Split subtitle display text without changing a translation/TTS unit."""
    pairs = {"《": "》", "（": "）", "【": "】", "「": "」", "『": "』", "(": ")", "[": "]"}
    punctuation = frozenset("，,；;：:。?？!！、.")
    closing = frozenset("\"'”’」』》）】)]")
    stack, parts = [], []
    start = index = 0
    while index < len(text):
        char = text[index]
        if char in pairs:
            stack.append(pairs[char])
        elif stack and char == stack[-1]:
            stack.pop()
        elif not stack and char in punctuation:
            # Keep decimal numbers and dotted words together.
            if char == "." and index + 1 < len(text) and text[index + 1].isalnum():
                index += 1
                continue
            end = index + 1
            while end < len(text) and text[end] in closing | punctuation:
                end += 1
            parts.append(text[start:end])
            start = end
            index = end - 1
        index += 1
    if start < len(text):
        if text[start:].strip():
            parts.append(text[start:])
        elif parts:
            parts[-1] += text[start:]
    # Merge tiny display fragments while preserving punctuation and source text.
    merged, pending = [], ""
    for part in parts:
        pending += part
        if sum(char.isalnum() for char in pending) >= 5:
            merged.append(pending)
            pending = ""
    if pending:
        if merged:
            merged[-1] += pending
        else:
            merged.append(pending)
    return merged


def _display_cues(text: str, start_ms: int, end_ms: int) -> list[tuple[int, int, str]]:
    """Estimate display timing inside a whole utterance's source/dubbed span.

    This follows youdub-backend's character-weighted subtitle timing. These
    estimates do not change source ASR timestamps or split the synthesized audio.
    """
    parts = _display_parts(text)
    duration = end_ms - start_ms
    if not parts or duration < len(parts):
        raise _invalid("The subtitle interval cannot contain its display fragments.")
    weights = [max(1, sum(char.isalnum() for char in part)) for part in parts]
    total = sum(weights)
    result, elapsed, start = [], 0, start_ms
    for index, (part, weight) in enumerate(zip(parts, weights, strict=True)):
        elapsed += weight
        remaining = len(parts) - index - 1
        end = end_ms if not remaining else min(end_ms - remaining, max(start + 1, start_ms + round(duration * elapsed / total)))
        result.append((start, end, part))
        start = end
    return result


def _font(language: str) -> str:
    defaults = {
        "Darwin": {"zh": "Hiragino Sans GB", "ja": "Hiragino Sans"},
        "Windows": {"zh": "Microsoft YaHei", "ja": "Yu Gothic"},
        "Linux": {"zh": "Noto Sans CJK SC", "ja": "Noto Sans CJK JP"},
    }
    font = os.getenv("YOUDUB_SUBTITLE_FONT", "").strip() or defaults.get(platform.system(), {}).get(
        language, "sans-serif",
    )
    if any(character in font for character in "'\\,:;[]=\n\r"):
        raise ApiError(422, "INVALID_CONFIG", "YOUDUB_SUBTITLE_FONT must be a plain font family name.",
                       field="YOUDUB_SUBTITLE_FONT", stage="export")
    return font


def run(context: StageContext, progress: Callable[[float | None, str], None]) -> Completed:
    include_subtitles = context.config.output_mode in {"subtitles", "both"}
    include_dubbing = context.config.output_mode in {"dubbing", "both"}
    context.check_cancel()
    video = _input_file(context, "video")
    info = _read_json(context, "media_info")
    transcript = read_transcript(_input_file(context, "transcript"), stage="export")
    translation = read_translation(_input_file(context, "translation"), transcript, stage="export")
    if translation.target_language != context.config.target_language:
        raise _invalid("Translation language does not match the task configuration.")
    for key in ("duration_ms", "width", "height"):
        if type(info.get(key)) is not int or info[key] <= 0:
            raise _invalid(f"Source media {key} is invalid.")
    rows = _subtitle_rows(transcript, translation, info["duration_ms"])
    output = context.work_dir.parent / "output"
    output.mkdir(parents=True, exist_ok=True)
    source_srt, translated_srt = output / "source.srt", output / "translated.srt"
    final_video = output / "video.mp4"
    outputs = {"video": final_video}
    translated_rows = rows
    progress(0.0, "Preparing output media")
    if include_dubbing:
        alignment = read_alignment(_input_file(context, "alignment"), transcript, info["duration_ms"])
        aligned = alignment.match(transcript, info["duration_ms"])
        mixed_audio = _input_file(context, "mixed_audio")
        try:
            audio_info = sf.info(mixed_audio)
        except (OSError, RuntimeError) as exc:
            raise _invalid("The mixed WAV file could not be read.") from exc
        if (audio_info.format not in {"WAV", "WAVEX"}
                or audio_info.frames != round(info["duration_ms"] * audio_info.samplerate / 1000)):
            raise _invalid("The final WAV must cover exactly the source video duration.")
        final_audio = output / "audio.wav"
        shutil.copyfile(mixed_audio, final_audio)
        context.check_cancel()
        outputs["audio"] = final_audio
        translated_rows = [(segment.model_copy(update={
            "start_ms": aligned[segment.id].dubbed_start_ms, "end_ms": aligned[segment.id].dubbed_end_ms,
        }), text) for segment, text in rows]
    if include_subtitles:
        _write_srt(source_srt, rows, translated=False)
        _write_srt(translated_srt, translated_rows, translated=True)
        outputs.update(source_subtitles=source_srt, translated_subtitles=translated_srt)
    progress(None, "Rendering output video")
    command = [
        ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
        "-i", str(video.resolve()),
    ]
    if include_dubbing:
        command.extend(["-i", str(outputs["audio"].resolve())])
    if include_subtitles:
        orientation = "portrait" if info["height"] > info["width"] else "landscape"
        style = subtitle_style_for_orientation(orientation, _font(context.config.target_language),
                                              context.config.target_language)
        command.extend(["-vf", f"subtitles=filename=translated.srt:force_style='{style}'"])
    command.extend([
        "-map", "0:v:0", "-map", "1:a:0" if include_dubbing else "0:a:0", "-c:v", "libx264",
        "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
        str(final_video.resolve()),
    ])
    try:
        result = media._run_media(command, check_cancel=context.check_cancel, cwd=output.resolve())
    except FileNotFoundError as exc:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffmpeg is unavailable.", stage="export") from exc
    if result.returncode != 0:
        raise ApiError(500, "INTERNAL_ERROR", f"FFmpeg video export failed (exit {result.returncode}).",
                       stage="export", action="retry")
    if not final_video.is_file() or final_video.stat().st_size == 0:
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "The output video was not produced.",
                       stage="export", action="retry")
    progress(1.0, "Output media is ready")
    return Completed(output_files=outputs)

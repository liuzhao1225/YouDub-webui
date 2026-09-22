"""Render subtitles on the original video and publish the two source-timed SRTs."""

from __future__ import annotations

import json
import os
import platform
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..adapters.ffmpeg import _srt_time, subtitle_style_for_orientation
from ..config import ffmpeg_binary
from . import media
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
    for index, (segment, translation) in enumerate(rows, 1):
        text = translation if translated else segment.text
        cues.append(f"{index}\n{_srt_time(segment.start_ms)} --> {_srt_time(segment.end_ms)}\n{text}\n")
    path.write_text("\n".join(cues), encoding="utf-8", newline="\n")


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
    if context.config.output_mode != "subtitles":
        raise ApiError(503, "MODEL_NOT_READY", "Dubbing export has not been connected yet.", stage="export")
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
    orientation = "portrait" if info["height"] > info["width"] else "landscape"
    style = subtitle_style_for_orientation(orientation, _font(context.config.target_language),
                                          context.config.target_language)
    progress(0.0, "Writing source-timed subtitles")
    _write_srt(source_srt, rows, translated=False)
    _write_srt(translated_srt, rows, translated=True)
    progress(None, "Rendering translated subtitles")
    command = [
        ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
        "-i", str(video.resolve()), "-vf", f"subtitles=filename=translated.srt:force_style='{style}'",
        "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-movflags", "+faststart", str(final_video.resolve()),
    ]
    try:
        result = media._run_media(command, check_cancel=context.check_cancel, cwd=output.resolve())
    except FileNotFoundError as exc:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffmpeg is unavailable.", stage="export") from exc
    if result.returncode != 0:
        raise ApiError(500, "INTERNAL_ERROR", f"FFmpeg subtitle export failed (exit {result.returncode}).",
                       stage="export", action="retry")
    if not final_video.is_file() or final_video.stat().st_size == 0:
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "The subtitled video was not produced.",
                       stage="export", action="retry")
    progress(1.0, "Subtitle video and both SRT files are ready")
    return Completed(output_files={"video": final_video, "source_subtitles": source_srt,
                                   "translated_subtitles": translated_srt})

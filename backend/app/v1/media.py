"""Local media admission and the first v1 pipeline step."""

from __future__ import annotations

import json
import math
import subprocess
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path
from typing import Any

from ..config import ffmpeg_binary, ffprobe_binary
from .errors import ApiError
from .runtime import RUNTIME_LIMITS
from .steps import Completed, StageContext


def _invalid(message: str) -> ApiError:
    return ApiError(422, "INVALID_MEDIA", message, field="file", stage="prepare", action="none")


def _probe(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size == 0:
        raise _invalid("The input media file is missing or empty.")
    try:
        result = subprocess.run(
            [ffprobe_binary(), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path.resolve())],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError as exc:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffprobe is unavailable.", stage="prepare") from exc
    except subprocess.TimeoutExpired as exc:
        raise _invalid("Media inspection timed out.") from exc
    if result.returncode != 0:
        raise _invalid("ffprobe could not read the input media.")
    try:
        data = json.loads(result.stdout)
    except (ValueError, TypeError) as exc:
        raise _invalid("ffprobe returned invalid media information.") from exc
    if not isinstance(data, dict):
        raise _invalid("ffprobe returned invalid media information.")
    return data


def _positive_number(value: Any) -> float | None:
    try:
        number = float(Fraction(str(value)))
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _duration_ms(data: dict[str, Any], stream: dict[str, Any] | None = None) -> int:
    # MP4 commonly exposes stream duration; Matroska commonly exposes only the
    # container duration. Prefer the selected video stream when it is available.
    seconds = _positive_number(stream.get("duration")) if stream else None
    if seconds is None:
        container = data.get("format")
        seconds = _positive_number(container.get("duration")) if isinstance(container, dict) else None
    if seconds is None:
        raise _invalid("The media duration is missing or invalid.")
    return max(1, round(seconds * 1000))


def inspect_video(path: Path, limits: dict[str, Any]) -> dict[str, Any]:
    """Inspect the exact first video/audio streams later used by ffmpeg.

    The importer owns file-name and byte-count admission. This function also
    works for a temporary upload path without the original file extension.
    """
    data = _probe(path)
    streams = data.get("streams")
    if not isinstance(streams, list) or any(not isinstance(stream, dict) for stream in streams):
        raise _invalid("The media stream information is invalid.")
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if video is None or video.get("disposition", {}).get("attached_pic") == 1:
        raise _invalid("The input has no usable first video stream.")
    if audio is None:
        raise ApiError(422, "NO_AUDIO_TRACK", "The input video has no audio track.",
                       field="file", stage="prepare", action="none")
    width, height = video.get("width"), video.get("height")
    frame_rate = _positive_number(video.get("avg_frame_rate")) or _positive_number(video.get("r_frame_rate"))
    if (type(width) is not int or type(height) is not int or width <= 0 or height <= 0 or frame_rate is None):
        raise _invalid("The video dimensions or frame rate are invalid.")
    duration_ms = _duration_ms(data, video)
    info = {"duration_ms": duration_ms, "width": width, "height": height, "frame_rate": frame_rate,
            "video_codec": video.get("codec_name"), "audio_codec": audio.get("codec_name")}
    for field, limit in (("duration_ms", "max_video_duration_ms"), ("width", "max_video_width"),
                         ("height", "max_video_height"), ("frame_rate", "max_frame_rate")):
        if info[field] > limits[limit]:
            raise ApiError(415, "UNSUPPORTED_MEDIA", f"The video {field} exceeds {limits[limit]}.",
                           field="file", stage="prepare", action="none")
    if info["video_codec"] not in limits["video_codecs"] or info["audio_codec"] not in limits["audio_codecs"]:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "The first video or audio codec is unsupported.",
                       field="file", stage="prepare", action="none")
    return info


def probe_duration(path: Path) -> int:
    """Return the duration of a produced audio/video file in milliseconds."""
    return _duration_ms(_probe(path))


def prepare(context: StageContext, progress: Callable[[float | None, str], None]) -> Completed:
    """Extract the first audio stream without modifying or transcoding video."""
    source = context.input_files["video"]
    progress(0.0, "Inspecting source video")
    info = inspect_video(source, RUNTIME_LIMITS)
    context.work_dir.mkdir(parents=True, exist_ok=True)
    audio_path = context.work_dir / "source.wav"
    info_path = context.work_dir / "media.json"
    progress(None, "Extracting source audio")
    try:
        result = subprocess.run(
            [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
             "-i", str(source.resolve()), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(audio_path.resolve())],
            capture_output=True, text=True,
        )
    except FileNotFoundError as exc:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffmpeg is unavailable.", stage="prepare") from exc
    if result.returncode != 0:
        raise _invalid("ffmpeg could not decode the source audio.")
    if not audio_path.is_file() or audio_path.stat().st_size <= 44:
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "Source audio was not produced.", stage="prepare")
    info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    progress(1.0, "Source audio is ready")
    return Completed(output_files={"source_audio": audio_path, "media_info": info_path})

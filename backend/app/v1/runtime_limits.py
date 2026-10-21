"""Media admission limits shared by workers and the Host capability response."""
from typing import Any

# Media admission limits shared by the official prepare operation and Host.
RUNTIME_LIMITS: dict[str, Any] = {
    "max_file_bytes": 4 * 1024 * 1024 * 1024,
    "max_video_duration_ms": 600_000,
    "max_video_width": 1920,
    "max_video_height": 1920,
    "max_frame_rate": 60,
    "video_suffixes": [".mp4", ".mov", ".mkv", ".webm"],
    "video_codecs": ["h264", "hevc", "vp8", "vp9", "av1"],
    "audio_codecs": ["aac", "mp3", "pcm_s16le", "pcm_s24le", "pcm_f32le", "opus", "vorbis", "flac"],
}


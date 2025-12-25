import json
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Config:
    root_folder: str
    url: str

    num_videos: Optional[int] = None
    resolution: Optional[str] = None
    
    demucs_model: Optional[str] = None
    device: str = "auto"
    shifts: int = 0

    whisper_model: Optional[str] = "large-v2"
    whisper_download_root: str = "models/ASR/whisper"
    whisper_batch_size: int = 1
    whisper_diarization: bool = False
    whisper_min_speakers: Optional[int] = None
    whisper_max_speakers: Optional[int] = None

    translation_target_language: Optional[str] = None

    force_bytedance: bool = False
    subtitles: bool = False

    speed_up: bool = False
    fps: Optional[int] = None
    target_resolution: Optional[str] = None

    max_retries: int = 3
    auto_upload_video: bool = False
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ..config import ffmpeg_binary
from ..sanitize import sanitize_text
from ..sources import SourceConfig
from ..youtube import local_upload_task_id


def upload_dir(workfolder: Path, task_id: str) -> Path:
    return workfolder / "_uploads" / task_id


def remove_upload(workfolder: Path, task_id: str) -> None:
    target = upload_dir(workfolder, task_id)
    if target.exists():
        shutil.rmtree(target)


def _uploaded_video_file(workfolder: Path, task_id: str) -> Path:
    root = upload_dir(workfolder, task_id)
    if not root.exists():
        raise FileNotFoundError(f"Local upload is missing for task {task_id}.")

    files = sorted(path for path in root.iterdir() if path.is_file())
    if not files:
        raise FileNotFoundError(f"Local upload is missing for task {task_id}.")
    if len(files) > 1:
        raise RuntimeError(f"Local upload has multiple files for task {task_id}.")
    return files[0]


def _title_from_url(url: str, source_file: Path) -> str:
    query = parse_qs(urlparse(url.strip()).query)
    filename = (query.get("filename") or [""])[0].strip()
    if filename:
        return Path(filename).stem or source_file.stem
    return source_file.stem


def _session_path(workfolder: Path, task_id: str, title: str) -> Path:
    safe_title = sanitize_text(title) or "local-video"
    return workfolder / "local" / f"{safe_title}__{task_id}"


def _transcode_to_mp4(source_file: Path, video_file: Path) -> None:
    subprocess.run(
        [
            ffmpeg_binary(),
            "-y",
            "-i",
            str(source_file),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(video_file),
        ],
        check=True,
    )


def import_local_video(url: str, workfolder: Path, source: SourceConfig) -> tuple[Path, dict]:
    task_id = local_upload_task_id(url)
    if not task_id:
        raise ValueError("Invalid local upload URL.")

    source_file = _uploaded_video_file(workfolder, task_id)
    title = _title_from_url(url, source_file)
    session = _session_path(workfolder, task_id, title)
    media_dir = session / "media"
    metadata_dir = session / "metadata"
    media_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir.mkdir(parents=True, exist_ok=True)

    video_file = media_dir / "video_source.mp4"
    info = {
        "id": task_id,
        "title": title,
        "source": "local",
        "webpage_url": url,
        "original_path": str(source_file),
        "asr_language": source.asr_language,
        "target_language": source.target_language,
    }
    metadata_file = metadata_dir / "local_info.json"
    metadata_file.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    if video_file.exists() and video_file.stat().st_size > 0:
        return session, info

    _transcode_to_mp4(source_file, video_file)
    if not video_file.exists() or video_file.stat().st_size == 0:
        raise RuntimeError("ffmpeg finished without producing media/video_source.mp4")
    return session, info

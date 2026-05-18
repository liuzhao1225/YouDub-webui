from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from ..sanitize import sanitize_text


def _metadata_from_url(url: str) -> dict[str, str]:
    parsed = urlparse(url)
    task_id = parsed.path.strip("/").split("/", 1)[0]
    query = parse_qs(parsed.query)
    filename = unquote(query.get("filename", ["local-video"])[0])
    direction = query.get("direction", ["en-zh"])[0]
    return {
        "id": task_id,
        "title": Path(filename).stem or "local-video",
        "filename": filename,
        "direction": direction,
        "source": "local",
    }


def upload_dir(workfolder: Path, task_id: str) -> Path:
    return workfolder / "_uploads" / task_id


def remove_upload(workfolder: Path, task_id: str) -> None:
    directory = upload_dir(workfolder, task_id)
    if directory.exists():
        shutil.rmtree(directory)


def _input_file(workfolder: Path, task_id: str) -> Path:
    directory = upload_dir(workfolder, task_id)
    files = [path for path in directory.iterdir() if path.is_file()]
    if not files:
        raise FileNotFoundError(f"No uploaded local video found for task {task_id}.")
    return files[0]


def _prepare_video(input_file: Path, output_file: Path) -> None:
    if output_file.exists() and output_file.stat().st_size > 0:
        return
    output_file.parent.mkdir(parents=True, exist_ok=True)
    copy_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(output_file),
    ]
    result = subprocess.run(copy_cmd, capture_output=True, text=True)
    if result.returncode == 0 and output_file.exists() and output_file.stat().st_size > 0:
        return
    output_file.unlink(missing_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_file),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(output_file),
        ],
        check=True,
    )


def import_local_video(url: str, workfolder: Path) -> tuple[Path, dict[str, str]]:
    info = _metadata_from_url(url)
    task_id = info["id"]
    input_file = _input_file(workfolder, task_id)
    title = sanitize_text(info["title"])
    session = workfolder / "local" / f"{title}__{task_id}"
    media_dir = session / "media"
    metadata_dir = session / "metadata"
    media_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir.mkdir(parents=True, exist_ok=True)

    video_file = media_dir / "video_source.mp4"
    _prepare_video(input_file, video_file)
    metadata = {**info, "original_path": str(input_file), "webpage_url": url}
    (metadata_dir / "local_info.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return session, info

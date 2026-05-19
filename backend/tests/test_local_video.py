from __future__ import annotations

import json
import subprocess
from pathlib import Path

from backend.app.adapters import local_video
from backend.app.sources import detect_source


def test_import_local_video_transcodes_with_configured_ffmpeg(monkeypatch, tmp_path):
    task_id = "local-task"
    upload_dir = local_video.upload_dir(tmp_path, task_id)
    upload_dir.mkdir(parents=True)
    source_file = upload_dir / "demo.mov"
    source_file.write_bytes(b"video")
    commands: list[list[str]] = []

    def fake_run(cmd, check=False, **kwargs):
        commands.append(cmd)
        output = Path(cmd[-1])
        output.write_bytes(b"mp4")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setenv("FFMPEG_PATH", "/opt/bin/ffmpeg")
    monkeypatch.setattr(local_video.subprocess, "run", fake_run)

    session, info = local_video.import_local_video(
        f"local://upload/{task_id}?direction=zh-en&filename=demo.mov",
        tmp_path,
        detect_source("local://upload/local-task?direction=zh-en"),
    )

    assert session == tmp_path / "local" / f"demo__{task_id}"
    assert info["title"] == "demo"
    assert info["target_language"] == "en"
    assert commands
    assert commands[0][0] == "/opt/bin/ffmpeg"
    assert commands[0][-1] == str(session / "media" / "video_source.mp4")
    metadata = json.loads((session / "metadata" / "local_info.json").read_text(encoding="utf-8"))

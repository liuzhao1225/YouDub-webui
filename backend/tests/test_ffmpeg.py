from __future__ import annotations

import json
import subprocess
from pathlib import Path

from backend.app.adapters import ffmpeg


def test_video_orientation_uses_height_greater_than_width(monkeypatch):
    def fake_run(cmd, capture_output=False, text=False, **kwargs):
        return subprocess.CompletedProcess(cmd, 0, stdout="720,1280\n", stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)

    assert ffmpeg.get_video_orientation(Path("video.mp4")) == "portrait"


def test_video_orientation_defaults_to_landscape_when_probe_fails(monkeypatch):
    def fake_run(cmd, capture_output=False, text=False, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="ffprobe failed")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)

    assert ffmpeg.get_video_orientation(Path("video.mp4")) == "landscape"


def test_subtitle_styles_match_backend_orientation_rules():
    portrait = ffmpeg.subtitle_style_for_orientation("portrait", "Noto Sans CJK SC", "zh")
    landscape = ffmpeg.subtitle_style_for_orientation("landscape", "Noto Sans CJK SC", "zh")

    assert "FontSize=12" in portrait
    assert "MarginV=70" in portrait
    assert "FontSize=24" in landscape
    assert "MarginV=5" in landscape


def test_subtitle_styles_use_smaller_size_for_english():
    portrait_en = ffmpeg.subtitle_style_for_orientation("portrait", "Arial", "en")
    landscape_en = ffmpeg.subtitle_style_for_orientation("landscape", "Arial", "en")

    assert "FontSize=9" in portrait_en
    assert "FontSize=18" in landscape_en


def test_subtitle_filter_picks_chinese_font_for_zh_srt(monkeypatch, tmp_path):
    monkeypatch.setattr(ffmpeg, "get_video_orientation", lambda _: "landscape")
    sub_zh = tmp_path / "subtitles.zh.srt"
    sub_zh.write_text("", encoding="utf-8")
    assert "FontName=Noto Sans CJK SC" in ffmpeg.subtitle_filter(tmp_path / "v.mp4", sub_zh, tmp_path)
    sub_en = tmp_path / "subtitles.en.srt"
    sub_en.write_text("", encoding="utf-8")
    assert "FontName=Arial" in ffmpeg.subtitle_filter(tmp_path / "v.mp4", sub_en, tmp_path)


def test_merge_video_burns_portrait_subtitles(monkeypatch, tmp_path):
    session = tmp_path / "session"
    metadata_dir = session / "metadata"
    metadata_dir.mkdir(parents=True)
    timings = metadata_dir / "timings.json"
    timings.write_text(
        json.dumps(
            {
                "translation": [
                    {
                        "start_time": 0,
                        "end_time": 1200,
                        "actual_start_time": 0,
                        "actual_end_time": 1200,
                        "zh": "你好",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    commands: list[list[str]] = []
    cwd_values: list[Path | None] = []

    def fake_run(cmd, capture_output=False, text=False, check=False, **kwargs):
        commands.append(cmd)
        cwd_values.append(kwargs.get("cwd"))
        if cmd[0] == "ffprobe":
            return subprocess.CompletedProcess(cmd, 0, stdout="720,1280\n", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)

    final_video = ffmpeg.merge_video(
        tmp_path / "video.mp4",
        tmp_path / "dubbing.wav",
        tmp_path / "bgm.wav",
        timings,
        session,
    )

    assert final_video == session / "media" / "video_final.mp4"
    assert len(commands) == 3
    final_command = commands[-1]
    filter_arg = final_command[final_command.index("-vf") + 1]
    assert filter_arg.startswith("subtitles=filename='metadata/subtitles.zh.srt'")
    assert "FontSize=12" in filter_arg
    assert "MarginV=70" in filter_arg
    assert "-c:s" not in final_command
    assert cwd_values[-1] == session.resolve()


def test_merge_video_uses_absolute_media_paths_when_cwd_is_session(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    session = Path("workfolder") / "uploader" / "title__videoid"
    metadata_dir = session / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    timings = metadata_dir / "timings.json"
    timings.write_text(
        json.dumps(
            {
                "translation": [
                    {
                        "start_time": 0,
                        "end_time": 1200,
                        "actual_start_time": 0,
                        "actual_end_time": 1200,
                        "zh": "你好",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    commands: list[list[str]] = []
    cwd_values: list[Path | None] = []

    def fake_run(cmd, capture_output=False, text=False, check=False, **kwargs):
        commands.append(cmd)
        cwd_values.append(kwargs.get("cwd"))
        if cmd[0] == "ffprobe":
            return subprocess.CompletedProcess(cmd, 0, stdout="720,1280\n", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)

    ffmpeg.merge_video(
        session / "media" / "video_source.mp4",
        session / "tmp" / "audio_dubbing.wav",
        session / "media" / "audio_bgm.wav",
        timings,
        session,
    )

    mix_command = commands[0]
    final_command = commands[-1]
    assert Path(mix_command[mix_command.index("-i") + 1]).is_absolute()
    assert Path(mix_command[mix_command.index("-i", mix_command.index("-i") + 1) + 1]).is_absolute()
    assert Path(mix_command[-1]).is_absolute()
    assert Path(final_command[final_command.index("-i") + 1]).is_absolute()
    assert Path(final_command[final_command.index("-i", final_command.index("-i") + 1) + 1]).is_absolute()
    assert Path(final_command[-1]).is_absolute()
    assert cwd_values[-1] == session.resolve()


def test_split_subtitle_text_breaks_on_punctuation_and_keeps_protected():
    out = ffmpeg.split_subtitle_text("我们今天讨论一下宇宙的边界，那是一个神秘话题；不过别担心，我会详细解释。")
    assert len(out) >= 3
    assert all(len(s) >= 2 for s in out)
    protected = ffmpeg.split_subtitle_text("他说《三体，黑暗森林》是经典，必读。")
    assert any("《三体，黑暗森林》" in s for s in protected)


def test_write_srt_splits_long_sentence_into_multiple_entries(tmp_path):
    session = tmp_path / "session"
    metadata_dir = session / "metadata"
    metadata_dir.mkdir(parents=True)
    timings = metadata_dir / "timings.json"
    timings.write_text(
        json.dumps(
            {
                "translation": [
                    {
                        "start_time": 0,
                        "end_time": 6000,
                        "actual_start_time": 0,
                        "actual_end_time": 6000,
                        "zh": "我们今天讨论宇宙的边界，那是一个神秘话题；不过别担心，我会详细解释",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    srt = ffmpeg.write_srt(timings, session)
    content = srt.read_text(encoding="utf-8")
    blocks = [b for b in content.strip().split("\n\n") if b.strip()]
    assert len(blocks) >= 3
    assert all("-->" in b for b in blocks)


def test_probe_video_size_uses_configured_ffprobe(monkeypatch):
    commands: list[list[str]] = []

    def fake_run(cmd, capture_output=False, text=False, **kwargs):
        commands.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="1920,1080\n", stderr="")

    monkeypatch.setenv("FFPROBE_PATH", "/opt/bin/ffprobe")
    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)

    assert ffmpeg.probe_video_size(Path("video.mp4")) == (1920, 1080)
    assert commands[0][0] == "/opt/bin/ffprobe"

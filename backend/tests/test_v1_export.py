from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from backend.app.v1 import export, media
from backend.app.v1.contracts import ErrorEnvelope, TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.steps import StageCancelled, StageContext


@pytest.fixture
def context(tmp_path):
    root = tmp_path / "中文 task's folder"
    work = root / "work"
    work.mkdir(parents=True)
    files = {name: work / f"{name}.json" for name in ("media_info", "transcript", "translation")}
    files["video"] = root / "source.mp4"
    files["video"].write_bytes(b"source-video")
    files["media_info"].write_text(json.dumps({"duration_ms": 1000, "width": 320, "height": 180}))
    files["transcript"].write_text(json.dumps({"detected_language": "en", "segments": [
        {"id": "first", "start_ms": 0, "end_ms": 400, "text": "  Hello,\nworld!  "},
        {"id": "last", "start_ms": 650, "end_ms": 1000, "text": "End of the clip."},
    ]}))
    # Deliberately reversed: joining translations must use IDs, not list order.
    files["translation"].write_text(json.dumps({"source_language": "en", "target_language": "zh", "segments": [
        {"segment_id": "last", "text": "结束了。"}, {"segment_id": "first", "text": "  你好，世界！  "},
    ]}))
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "small", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": None, "separation": None,
    })
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1,
                        stage="export", config=config, input_files=files, work_dir=work)


def test_srt_preserves_original_text_order_and_timing_and_joins_translation_by_id(monkeypatch, context):
    original = {name: path.read_bytes() for name, path in context.input_files.items()}
    commands = []

    def render(command, **kwargs):
        commands.append((command, kwargs))
        Path(command[-1]).write_bytes(b"rendered-video")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", render)
    result = export.run(context, lambda value, message: None)
    assert result.output_files["source_subtitles"].read_text() == (
        "1\n00:00:00,000 --> 00:00:00,400\n  Hello,\nworld!  \n\n"
        "2\n00:00:00,650 --> 00:00:01,000\nEnd of the clip.\n"
    )
    assert result.output_files["translated_subtitles"].read_text() == (
        "1\n00:00:00,000 --> 00:00:00,400\n  你好，世界！  \n\n"
        "2\n00:00:00,650 --> 00:00:01,000\n结束了。\n"
    )
    assert {name: path.read_bytes() for name, path in context.input_files.items()} == original
    command, options = commands[0]
    assert [command[index + 1] for index, value in enumerate(command) if value == "-map"] == ["0:v:0", "0:a:0"]
    assert "-shortest" not in command
    assert options["cwd"] == (context.work_dir.parent / "output").resolve()
    assert "filename=translated.srt" in command[command.index("-vf") + 1]
    assert all(path.parent == context.work_dir.parent / "output" for path in result.output_files.values())


@pytest.mark.parametrize("change", [
    lambda data: data["segments"].pop(),
    lambda data: data["segments"].append(data["segments"][0].copy()),
    lambda data: data["segments"][0].update(segment_id="unknown"),
    lambda data: data["segments"][0].update(text=" "),
    lambda data: data.update(target_language="en"),
])
def test_invalid_translation_is_rejected_before_rendering(monkeypatch, context, change):
    path = context.input_files["translation"]
    data = json.loads(path.read_text())
    change(data)
    path.write_text(json.dumps(data))
    monkeypatch.setattr(media, "_run_media", lambda *args, **kwargs: pytest.fail("invalid input reached FFmpeg"))
    with pytest.raises(ApiError) as error:
        export.run(context, lambda value, message: None)
    assert ErrorEnvelope.model_validate(error.value.content).error.code == "INVALID_PROVIDER_RESULT"


def test_cue_past_video_end_fails_instead_of_silently_truncating_tail(context):
    path = context.input_files["transcript"]
    data = json.loads(path.read_text())
    data["segments"][-1]["end_ms"] = 1500
    path.write_text(json.dumps(data))
    with pytest.raises(ApiError, match="extend beyond"):
        export.run(context, lambda value, message: None)


@pytest.mark.parametrize("mode", ["dubbing", "both"])
def test_unconnected_dubbing_export_is_explicit(context, mode):
    context = replace(context, config=context.config.model_copy(update={"output_mode": mode}))
    with pytest.raises(ApiError) as error:
        export.run(context, lambda value, message: None)
    assert error.value.status_code == 503
    assert error.value.content["error"]["code"] == "MODEL_NOT_READY"


@pytest.mark.parametrize("returncode,code", [(1, "INTERNAL_ERROR"), (0, "STAGE_OUTPUT_MISSING")])
def test_render_failure_is_not_reported_as_completion(monkeypatch, context, returncode, code):
    monkeypatch.setattr(media, "_run_media", lambda command, **kwargs:
                        subprocess.CompletedProcess(command, returncode, "", "private/path/source.mp4"))
    with pytest.raises(ApiError) as error:
        export.run(context, lambda value, message: None)
    assert error.value.content["error"]["code"] == code
    assert error.value.content["error"]["stage"] == "export"
    assert "private/path" not in str(error.value)


def test_cancelling_export_reaps_child_before_returning(monkeypatch, context):
    real_popen = subprocess.Popen
    processes = []
    running_checks = 0

    def slow_process(command, **kwargs):
        process = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        processes.append(process)
        return process

    def check_cancel():
        nonlocal running_checks
        if processes and processes[0].poll() is None:
            running_checks += 1
            if running_checks == 2:
                raise StageCancelled()

    monkeypatch.setattr(media.subprocess, "Popen", slow_process)
    with pytest.raises(StageCancelled):
        export.run(replace(context, check_cancel=check_cancel), lambda value, message: None)
    assert processes[0].returncode is not None
    assert processes[0].wait(timeout=0) != 0


@pytest.mark.parametrize("system,font", [
    ("Windows", "Microsoft YaHei"), ("Darwin", "Hiragino Sans GB"), ("Linux", "Noto Sans CJK SC"),
])
def test_font_family_is_platform_specific_and_configurable(monkeypatch, system, font):
    monkeypatch.setattr(export.platform, "system", lambda: system)
    monkeypatch.delenv("YOUDUB_SUBTITLE_FONT", raising=False)
    assert export._font("zh") == font
    monkeypatch.setenv("YOUDUB_SUBTITLE_FONT", "A Custom Font")
    assert export._font("zh") == "A Custom Font"


def test_real_export_preserves_video_tail_and_first_audio_and_burns_tail_subtitle(context):
    if not shutil.which(media.ffmpeg_binary()) or not shutil.which(media.ffprobe_binary()):
        pytest.skip("Local ffmpeg and ffprobe are required for the real export check")
    source = context.input_files["video"]
    subprocess.run([
        media.ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x180:r=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-t", "1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
    ], check=True, capture_output=True)
    digest = hashlib.sha256(source.read_bytes()).digest()
    result = export.run(context, lambda value, message: None)
    video = result.output_files["video"]
    output_info = json.loads(subprocess.run([
        media.ffprobe_binary(), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video),
    ], check=True, capture_output=True, text=True).stdout)
    assert [stream["codec_name"] for stream in output_info["streams"]] == ["h264", "aac"]
    assert float(output_info["streams"][0]["duration"]) == pytest.approx(1.0, abs=0.04)
    assert hashlib.sha256(source.read_bytes()).digest() == digest

    def audio_samples(path):
        raw = subprocess.run([
            media.ffmpeg_binary(), "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1",
            "-ar", "16000", "-f", "f32le", "-",
        ], check=True, capture_output=True).stdout
        return np.frombuffer(raw, dtype="<f4")

    for path in (source, video):
        samples = audio_samples(path)[1600:14400]
        spectrum = np.abs(np.fft.rfft(samples))
        frequency = np.fft.rfftfreq(len(samples), d=1 / 16000)[np.argmax(spectrum)]
        assert frequency == pytest.approx(440, abs=2)

    def final_frame(path):
        return subprocess.run([
            media.ffmpeg_binary(), "-v", "error", "-ss", "0.92", "-i", str(path), "-frames:v", "1",
            "-pix_fmt", "gray", "-f", "rawvideo", "-",
        ], check=True, capture_output=True).stdout

    source_frame, output_frame = final_frame(source), final_frame(video)
    assert len(source_frame) == len(output_frame) == 320 * 180
    # A nonempty last frame with changed pixels proves the last cue was burned
    # through the end of the clip, beyond merely writing a valid SRT file.
    assert sum(output_frame) > sum(source_frame) + 200
    assert "00:00:01,000\n结束了。" in result.output_files["translated_subtitles"].read_text()

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import wave
from copy import deepcopy
from pathlib import Path

import pytest

from backend.app.v1 import media
from backend.app.v1.contracts import ErrorEnvelope, TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.runtime import RUNTIME_LIMITS
from backend.app.v1.steps import StageContext


@pytest.fixture
def probe_data():
    return {"streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 320, "height": 180,
         "avg_frame_rate": "30000/1001", "duration": "1.001"},
        {"codec_type": "audio", "codec_name": "aac"},
    ], "format": {"duration": "1.05"}}


def context_for(source: Path, work_dir: Path) -> StageContext:
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "small", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": None, "separation": None,
    })
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1,
                        stage="prepare", config=config, input_files={"video": source}, work_dir=work_dir)


def test_inspection_reads_first_streams_and_fractional_frame_rate(monkeypatch, tmp_path, probe_data):
    source = tmp_path / "upload.tmp"
    source.write_bytes(b"test-media")
    probe_data["streams"].extend([
        {"codec_type": "video", "codec_name": "unsupported", "width": 9999},
        {"codec_type": "audio", "codec_name": "unsupported"},
    ])
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, json.dumps(probe_data), "")

    monkeypatch.setattr(media.subprocess, "run", run)
    monkeypatch.setattr(media, "ffprobe_binary", lambda: "/configured/ffprobe")
    info = media.inspect_video(source, RUNTIME_LIMITS)
    assert info == {"duration_ms": 1001, "width": 320, "height": 180,
                    "frame_rate": pytest.approx(29.97003), "video_codec": "h264", "audio_codec": "aac"}
    assert commands[0][0] == "/configured/ffprobe"
    assert commands[0][-1] == str(source.resolve())


def test_container_duration_and_nominal_frame_rate_when_stream_fields_are_unavailable(monkeypatch, probe_data):
    probe_data["streams"][0].update(duration="N/A", avg_frame_rate="0/0", r_frame_rate="25/1")
    monkeypatch.setattr(media, "_probe", lambda path: probe_data)
    info = media.inspect_video(Path("source.mkv"), RUNTIME_LIMITS)
    assert info["duration_ms"] == 1050
    assert info["frame_rate"] == 25


@pytest.mark.parametrize("change,code,status", [
    (lambda data: data["streams"].pop(), "NO_AUDIO_TRACK", 422),
    (lambda data: data["streams"].pop(0), "INVALID_MEDIA", 422),
    (lambda data: data["streams"][0].update(disposition={"attached_pic": 1}), "INVALID_MEDIA", 422),
    (lambda data: data["streams"][0].update(width=0), "INVALID_MEDIA", 422),
    (lambda data: data["streams"][0].update(avg_frame_rate="0/0"), "INVALID_MEDIA", 422),
    (lambda data: data.update(format={}, streams=[dict(data["streams"][0], duration="NaN"), data["streams"][1]]),
     "INVALID_MEDIA", 422),
    (lambda data: data["streams"][0].update(codec_name="mpeg4"), "UNSUPPORTED_MEDIA", 415),
    (lambda data: data["streams"][1].update(codec_name="ac3"), "UNSUPPORTED_MEDIA", 415),
])
def test_rejected_media_has_contract_error(monkeypatch, probe_data, change, code, status):
    change(probe_data)
    monkeypatch.setattr(media, "_probe", lambda path: probe_data)
    with pytest.raises(ApiError) as error:
        media.inspect_video(Path("source.mp4"), RUNTIME_LIMITS)
    assert error.value.status_code == status
    assert ErrorEnvelope.model_validate(error.value.content).error.code == code


@pytest.mark.parametrize("key,value", [
    ("max_video_duration_ms", 1000), ("max_video_width", 319),
    ("max_video_height", 179), ("max_frame_rate", 29),
])
def test_runtime_admission_limits_are_enforced(monkeypatch, probe_data, key, value):
    monkeypatch.setattr(media, "_probe", lambda path: probe_data)
    limits = deepcopy(RUNTIME_LIMITS)
    limits[key] = value
    with pytest.raises(ApiError) as error:
        media.inspect_video(Path("source.mp4"), limits)
    assert error.value.status_code == 415
    assert error.value.content["error"]["code"] == "UNSUPPORTED_MEDIA"


@pytest.mark.parametrize("returncode,stdout", [(1, ""), (0, "not-json"), (0, "[]")])
def test_probe_failure_does_not_expose_process_output(monkeypatch, tmp_path, returncode, stdout):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"invalid")
    monkeypatch.setattr(media.subprocess, "run", lambda command, **kwargs:
                        subprocess.CompletedProcess(command, returncode, stdout, "private/source/file"))
    with pytest.raises(ApiError) as error:
        media.inspect_video(source, RUNTIME_LIMITS)
    assert error.value.content["error"]["code"] == "INVALID_MEDIA"
    assert "private" not in str(error.value)


def test_missing_probe_is_runtime_error(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"test")

    def missing(*args, **kwargs):
        raise FileNotFoundError("binary is missing")

    monkeypatch.setattr(media.subprocess, "run", missing)
    with pytest.raises(ApiError) as error:
        media.inspect_video(source, RUNTIME_LIMITS)
    assert error.value.status_code == 503
    assert error.value.content["error"]["code"] == "RUNTIME_UNAVAILABLE"


def test_prepare_decode_failure_propagates_and_does_not_publish_metadata(monkeypatch, tmp_path):
    context = context_for(tmp_path / "source.mp4", tmp_path / "prepare")
    monkeypatch.setattr(media, "inspect_video", lambda path, limits: {"duration_ms": 1000})
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 1, "", "decoder failure")

    monkeypatch.setattr(media.subprocess, "run", run)
    with pytest.raises(ApiError) as error:
        media.prepare(context, lambda progress, message: None)
    assert error.value.content["error"]["code"] == "INVALID_MEDIA"
    assert commands[0][commands[0].index("-map") + 1] == "0:a:0"
    assert "-xerror" in commands[0]
    assert not (context.work_dir / "media.json").exists()


def test_real_video_probe_and_prepare_preserve_source_and_extract_asr_audio(tmp_path):
    if not shutil.which(media.ffmpeg_binary()) or not shutil.which(media.ffprobe_binary()):
        pytest.skip("Local ffmpeg and ffprobe are required for the real-media check")
    source = tmp_path / "source.mp4"
    subprocess.run([
        media.ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", str(source),
    ], check=True, capture_output=True, text=True)
    source_hash = hashlib.sha256(source.read_bytes()).digest()
    inspected = media.inspect_video(source, RUNTIME_LIMITS)
    progress = []
    result = media.prepare(context_for(source, tmp_path / "prepare"), lambda value, message: progress.append(value))

    assert result.state == "completed"
    assert inspected == {"duration_ms": 1000, "width": 320, "height": 180,
                         "frame_rate": 25, "video_codec": "h264", "audio_codec": "aac"}
    assert json.loads(result.output_files["media_info"].read_text()) == inspected
    assert hashlib.sha256(source.read_bytes()).digest() == source_hash
    with wave.open(str(result.output_files["source_audio"]), "rb") as audio:
        assert (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) == (1, 16000, 2)
        assert 15000 < audio.getnframes() < 18000
        assert any(audio.readframes(audio.getnframes()))
    assert 900 <= media.probe_duration(result.output_files["source_audio"]) <= 1100
    assert progress == [0.0, None, 1.0]

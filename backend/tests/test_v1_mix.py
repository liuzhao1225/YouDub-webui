from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.app.v1 import media, mix
from backend.app.v1.audio_segments import Alignment, SpeechClip, SpeechClips
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.steps import StageCancelled, StageContext


def write_tone(path: Path, duration_ms: int, frequency: int, *, rate: int = 22050):
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = 0.2 * np.sin(2 * np.pi * frequency * np.arange(round(duration_ms * rate / 1000)) / rate)
    sf.write(path, samples, rate, subtype="PCM_16")


def write_manifest(context: StageContext):
    clips = []
    for index, identifier in enumerate(("first", "last"), 1):
        name = f"tts/{index:06d}.wav"
        info = sf.info(context.work_dir / name)
        clips.append(SpeechClip(segment_id=identifier, path=name, duration_ms=round(info.frames * 1000 / info.samplerate),
                                sample_rate_hz=info.samplerate, channels=info.channels))
    context.input_files["speech_clips"].write_text(SpeechClips(clips=clips).model_dump_json())


@pytest.fixture
def context(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    files = {name: work / f"{name}.json" for name in ("transcript", "media_info", "speech_clips")}
    files["source_audio"], files["background"] = work / "original.wav", work / "background.wav"
    files["transcript"].write_text(json.dumps({"detected_language": "en", "segments": [
        {"id": "first", "start_ms": 500, "end_ms": 1000, "text": "First."},
        {"id": "last", "start_ms": 1100, "end_ms": 1700, "text": "Last."},
    ]}))
    files["media_info"].write_text(json.dumps({"duration_ms": 5000, "width": 320, "height": 180}))
    write_tone(work / "tts/000001.wav", 1400, 440)
    write_tone(work / "tts/000002.wav", 500, 660)
    write_tone(files["source_audio"], 5000, 3000)
    write_tone(files["background"], 5000, 880)
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "both", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "small", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": {"adapter": "voxcpm", "model": "test-model", "device": "cpu", "voice": {"mode": "source_clone"}},
        "separation": {"adapter": "demucs", "model": "htdemucs", "device": "cpu"},
    })
    context = StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1,
                           stage="mix", config=config, input_files=files, work_dir=work)
    write_manifest(context)
    return context


def require_ffmpeg():
    if not shutil.which(media.ffmpeg_binary()):
        pytest.skip("Local ffmpeg is required for the real mixing check")


def test_real_mix_preserves_source_times_and_positions_complete_adjusted_clips(context):
    require_ffmpeg()
    original_transcript = context.input_files["transcript"].read_bytes()
    original_clips = [(context.work_dir / f"tts/{index:06d}.wav").read_bytes() for index in (1, 2)]
    result = mix.run(context, lambda value, message: None)
    timeline = Alignment.model_validate_json(result.output_files["alignment"].read_bytes())
    samples, rate = sf.read(result.output_files["mixed_audio"], dtype="float32", always_2d=True)
    assert samples.shape == (5 * 48000, 2)
    assert rate == 48000
    assert context.input_files["transcript"].read_bytes() == original_transcript
    assert [(context.work_dir / f"tts/{index:06d}.wav").read_bytes() for index in (1, 2)] == original_clips
    assert [(item.source_start_ms, item.source_end_ms) for item in timeline.segments] == [(500, 1000), (1100, 1700)]
    assert timeline.segments[0].dubbed_start_ms == 500
    assert timeline.segments[1].dubbed_start_ms == timeline.segments[0].dubbed_end_ms
    assert timeline.segments[1].dubbed_start_ms > 1100
    previous_end = 0
    for index, source_start_ms in enumerate((500, 1100), 1):
        processed, processed_rate = sf.read(context.work_dir / f"adjusted/{index:04d}.wav", always_2d=True)
        start = max(source_start_ms * 48, previous_end)
        end = start + len(processed)
        assert processed_rate == rate
        assert np.allclose(samples[start:end], processed, atol=1 / 32768)
        assert timeline.segments[index - 1].dubbed_end_ms == round(end / 48)
        previous_end = end
    assert not samples[:500 * 48].any()
    assert not samples[previous_end:].any()


def test_real_mix_uses_only_separated_background_and_keeps_its_tail(context):
    require_ffmpeg()
    context = replace(context, config=context.config.model_copy(update={"keep_background": True}))
    result = mix.run(context, lambda value, message: None)
    samples, rate = sf.read(result.output_files["mixed_audio"], always_2d=True)
    tail = samples[3 * rate:4 * rate, 0]
    spectrum = np.abs(np.fft.rfft(tail))
    frequencies = np.fft.rfftfreq(len(tail), 1 / rate)
    assert frequencies[np.argmax(spectrum)] == pytest.approx(880, abs=1)
    assert spectrum[np.argmin(abs(frequencies - 3000))] < max(spectrum) * 0.01
    assert np.max(abs(samples)) < 1


def test_real_mix_fails_on_speech_overflow_without_trimming(context):
    require_ffmpeg()
    write_tone(context.work_dir / "tts/000001.wav", 9000, 440)
    write_manifest(context)
    with pytest.raises(ApiError) as error:
        mix.run(context, lambda value, message: None)
    assert error.value.content["error"]["code"] == "AUDIO_EXCEEDS_VIDEO"
    processed = sf.info(context.work_dir / "adjusted/0001.wav")
    assert processed.frames / processed.samplerate > 5
    assert not (context.work_dir / "mixed.wav").exists()
    assert not (context.work_dir / "alignment.json").exists()


def test_real_mix_borrows_earlier_silence_to_keep_the_complete_tail(context):
    require_ffmpeg()
    context.input_files["media_info"].write_text(json.dumps({"duration_ms": 1700, "width": 320, "height": 180}))
    write_tone(context.work_dir / "tts/000001.wav", 1000, 440)
    write_tone(context.work_dir / "tts/000002.wav", 1400, 660)
    write_manifest(context)
    original_transcript = context.input_files["transcript"].read_bytes()
    original_clips = [(context.work_dir / f"tts/{index:06d}.wav").read_bytes() for index in (1, 2)]

    result = mix.run(context, lambda value, message: None)

    timeline = Alignment.model_validate_json(result.output_files["alignment"].read_bytes())
    samples, rate = sf.read(result.output_files["mixed_audio"], dtype="float32", always_2d=True)
    assert rate == 48000 and samples.shape == (1700 * 48, 2)
    adjusted = [sf.read(context.work_dir / f"adjusted/{index:04d}.wav", always_2d=True)[0] for index in (1, 2)]
    # The preferred source start plus these complete clips overflows. Their
    # combined audio fits when the earlier silent portion is used.
    total_speech_frames = sum(len(clip) for clip in adjusted)
    assert total_speech_frames < len(samples) < 500 * 48 + total_speech_frames
    start = len(samples) - total_speech_frames
    assert not samples[:start].any()
    for item, clip in zip(timeline.segments, adjusted, strict=True):
        end = start + len(clip)
        assert np.allclose(samples[start:end], clip, atol=1 / 32768)
        assert (item.dubbed_start_ms, item.dubbed_end_ms) == (round(start / 48), round(end / 48))
        start = end
    assert start == len(samples)
    assert timeline.segments[0].dubbed_start_ms < 500
    assert timeline.segments[1].dubbed_start_ms < 1100
    assert timeline.segments[-1].dubbed_end_ms == 1700
    assert [(item.source_start_ms, item.source_end_ms) for item in timeline.segments] == [(500, 1000), (1100, 1700)]
    assert context.input_files["transcript"].read_bytes() == original_transcript
    assert [(context.work_dir / f"tts/{index:06d}.wav").read_bytes() for index in (1, 2)] == original_clips


def test_real_mix_fails_when_combined_complete_clips_exceed_all_available_time(context):
    require_ffmpeg()
    context.input_files["media_info"].write_text(json.dumps({"duration_ms": 1700, "width": 320, "height": 180}))
    write_tone(context.work_dir / "tts/000001.wav", 1000, 440)
    write_tone(context.work_dir / "tts/000002.wav", 2000, 660)
    write_manifest(context)

    with pytest.raises(ApiError) as error:
        mix.run(context, lambda value, message: None)

    assert error.value.content["error"]["code"] == "AUDIO_EXCEEDS_VIDEO"
    adjusted = [sf.info(context.work_dir / f"adjusted/{index:04d}.wav") for index in (1, 2)]
    assert all(clip.frames < 1700 * 48 for clip in adjusted)
    assert sum(clip.frames for clip in adjusted) > 1700 * 48
    assert not (context.work_dir / "mixed.wav").exists()
    assert not (context.work_dir / "alignment.json").exists()


def test_overlapping_source_speech_is_explicitly_unsupported(monkeypatch, context):
    path = context.input_files["transcript"]
    payload = json.loads(path.read_text())
    payload["segments"][1]["start_ms"] = 900
    path.write_text(json.dumps(payload))
    monkeypatch.setattr(media, "_run_media", lambda *args, **kwargs: pytest.fail("overlap reached FFmpeg"))
    with pytest.raises(ApiError) as error:
        mix.run(context, lambda value, message: None)
    assert error.value.content["error"]["code"] == "UNSUPPORTED_OVERLAPPING_SPEECH"


@pytest.mark.parametrize("change", [
    lambda data: data["clips"].append(data["clips"][0].copy()),
    lambda data: data["clips"][0].update(duration_ms=1401),
    lambda data: data["clips"][0].update(path="../outside.wav"),
])
def test_clip_identity_and_actual_file_metadata_must_match(context, change):
    path = context.input_files["speech_clips"]
    payload = json.loads(path.read_text())
    change(payload)
    path.write_text(json.dumps(payload))
    with pytest.raises(ApiError) as error:
        mix.run(context, lambda value, message: None)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"


def test_missing_background_is_not_replaced_by_original_audio(context):
    context = replace(context, config=context.config.model_copy(update={"keep_background": True}))
    context.input_files["background"].unlink()
    with pytest.raises(ApiError) as error:
        mix.run(context, lambda value, message: None)
    assert error.value.content["error"]["code"] == "INPUT_MISSING"
    assert "background" in str(error.value)


def test_cancelling_mix_reaps_ffmpeg_before_returning(monkeypatch, context):
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
        mix.run(replace(context, check_cancel=check_cancel), lambda value, message: None)
    assert processes[0].returncode is not None
    assert processes[0].wait(timeout=0) != 0
    assert not (context.work_dir / "mixed.wav").exists()

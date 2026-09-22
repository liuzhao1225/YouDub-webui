from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from backend.app.v1 import media, tts, tts_process
from backend.app.v1.audio_segments import read_speech_clips
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.segments import Transcript
from backend.app.v1.steps import StageCancelled, StageContext


@pytest.fixture
def context(tmp_path, monkeypatch):
    models = tmp_path / "VoxCPM2"
    models.mkdir()
    for name in ("tokenizer_config.json", "tokenizer.json", "model.safetensors", "audiovae.safetensors"):
        (models / name).write_bytes(b"test asset metadata")
    (models / "config.json").write_text('{"architecture":"voxcpm2"}')
    monkeypatch.setenv("YOUDUB_VOXCPM_MODEL_DIR", str(models))
    samples = np.arange(4 * 16000) / 16000
    source = tmp_path / "vocals.wav"
    sf.write(source, np.sin(2 * np.pi * 220 * samples) * 0.25, 16000, subtype="PCM_16")
    transcript = {"detected_language": "en", "segments": [
        {"id": "one", "start_ms": 0, "end_ms": 1000, "text": "Original A1", "speaker_id": "speaker-a"},
        {"id": "two", "start_ms": 1000, "end_ms": 2000, "text": "Original B", "speaker_id": "speaker-b"},
        {"id": "three", "start_ms": 2000, "end_ms": 3500, "text": "Original A2", "speaker_id": "speaker-a"},
    ]}
    transcript_path, translation_path = tmp_path / "transcript.json", tmp_path / "translation.json"
    transcript_path.write_text(json.dumps(transcript))
    translation_path.write_text(json.dumps({"source_language": "en", "target_language": "zh", "segments": [
        {"segment_id": "three", "text": " 第三段。 "}, {"segment_id": "one", "text": " 第一段。\n"},
        {"segment_id": "two", "text": "第二段。"},
    ]}, ensure_ascii=False))
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "both", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": {"adapter": "voxcpm", "model": "VoxCPM2", "device": "cpu", "voice": {"mode": "source_clone"}},
        "separation": {"adapter": "demucs", "model": "htdemucs", "device": "cpu"},
    })
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1, stage="tts", config=config,
                        input_files={"transcript": transcript_path, "translation": translation_path, "vocals": source},
                        work_dir=tmp_path / "work")


@pytest.fixture
def model_process(monkeypatch):
    real_run = media._run_media
    state = SimpleNamespace(commands=[], clips=[], output=True, invalid=False)

    def run(command, **kwargs):
        if len(command) < 2 or not command[1].endswith("tts_process.py"):
            return real_run(command, **kwargs)
        kwargs["check_cancel"]()
        state.commands.append(command)
        request_path = Path(command[command.index("--request-path") + 1])
        state.clips = json.loads(request_path.read_text())["clips"]
        for index, clip in enumerate(state.clips):
            if state.invalid:
                Path(clip["output_path"]).write_bytes(b"invalid WAV")
            elif state.output:
                rate = 24000 if index % 2 == 0 else 48000
                sf.write(clip["output_path"], np.full(rate // 4, 0.1), rate, subtype="PCM_16")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", run)
    return state


def test_model_inventory_requires_local_nonempty_asset_groups_only(context, monkeypatch):
    monkeypatch.setitem(sys.modules, "voxcpm", None)
    assert tts.available_models() == ["VoxCPM2"]
    root = tts.model_directory()
    (root / "model.safetensors").rename(root / "pytorch_model.bin")
    (root / "audiovae.safetensors").rename(root / "audiovae.pth")
    (root / "tokenizer.json").rename(root / "tokenizer.model")
    assert tts.available_models() == ["VoxCPM2"]
    (root / "audiovae.pth").write_bytes(b"")
    assert tts.available_models() == []
    monkeypatch.delenv("YOUDUB_VOXCPM_MODEL_DIR")
    assert tts.model_directory().parts[-3:] == ("models", "voxcpm", "VoxCPM2")


def test_tts_preserves_source_and_translation_and_uses_each_speakers_longest_reference(context, model_process):
    before = {name: context.input_files[name].read_bytes() for name in ("transcript", "translation")}
    result = tts.run(context, lambda *args: None)
    assert {name: context.input_files[name].read_bytes() for name in before} == before
    clips = model_process.clips
    assert [clip["segment_id"] for clip in clips] == ["one", "two", "three"]
    assert [clip["text"] for clip in clips] == [" 第一段。\n", "第二段。", " 第三段。 "]
    assert [clip["reference_text"] for clip in clips] == ["Original A2", "Original B", "Original A2"]
    assert clips[0]["reference_path"] == clips[2]["reference_path"] != clips[1]["reference_path"]
    source, rate = sf.read(context.input_files["vocals"])
    reference_a, reference_rate = sf.read(clips[0]["reference_path"])
    reference_b, _ = sf.read(clips[1]["reference_path"])
    assert reference_rate == rate == 16000
    assert np.array_equal(reference_a, source[2 * rate:3500 * rate // 1000])
    assert np.array_equal(reference_b, source[rate:2 * rate])
    transcript = Transcript.model_validate_json(before["transcript"])
    payload = read_speech_clips(result.output_files["speech_clips"], transcript)
    assert [clip.path for clip in payload.clips] == ["tts/000001.wav", "tts/000002.wav", "tts/000003.wav"]
    assert [clip.sample_rate_hz for clip in payload.clips] == [24000, 48000, 24000]
    assert all(clip.duration_ms == 250 and clip.channels == 1 for clip in payload.clips)
    command = model_process.commands[0]
    assert command[command.index("--model-path") + 1] == str(tts.model_directory().resolve())
    assert command[command.index("--device") + 1] == "cpu"


def test_unknown_speaker_group_does_not_reuse_a_named_speakers_reference(context, model_process):
    payload = json.loads(context.input_files["transcript"].read_text())
    payload["segments"][0].pop("speaker_id")
    context.input_files["transcript"].write_text(json.dumps(payload))
    tts.run(context, lambda *args: None)
    assert len({clip["reference_path"] for clip in model_process.clips}) == 3


def test_contiguous_sentences_share_a_complete_reference_window_and_matching_source_text(context, model_process):
    payload = json.loads(context.input_files["transcript"].read_text())
    for segment in payload["segments"]:
        segment["speaker_id"] = "speaker-a"
    context.input_files["transcript"].write_text(json.dumps(payload))
    tts.run(context, lambda *args: None)
    assert len({clip["reference_path"] for clip in model_process.clips}) == 1
    assert all(clip["reference_text"] == "Original A1 Original B Original A2" for clip in model_process.clips)
    reference, rate = sf.read(model_process.clips[0]["reference_path"])
    source, _ = sf.read(context.input_files["vocals"])
    assert np.array_equal(reference, source[:3500 * rate // 1000])


def test_reference_window_does_not_cut_a_sentence_at_ten_seconds(context, model_process):
    payload = json.loads(context.input_files["transcript"].read_text())
    for index, segment in enumerate(payload["segments"]):
        segment.update(speaker_id="speaker-a", start_ms=index * 4000, end_ms=(index + 1) * 4000)
    context.input_files["transcript"].write_text(json.dumps(payload))
    sf.write(context.input_files["vocals"], np.full(16000 * 12, 0.1), 16000, subtype="PCM_16")
    tts.run(context, lambda *args: None)
    assert sf.info(model_process.clips[0]["reference_path"]).duration == 8
    assert model_process.clips[0]["reference_text"] == "Original A1 Original B"


def test_reference_window_prefers_speech_duration_over_silent_span():
    transcript = Transcript.model_validate({"detected_language": "en", "segments": [
        {"id": "one", "start_ms": 0, "end_ms": 1000, "text": "One.", "speaker_id": "a"},
        {"id": "two", "start_ms": 9000, "end_ms": 10_000, "text": "Two.", "speaker_id": "a"},
        {"id": "three", "start_ms": 10_000, "end_ms": 14_000, "text": "Three.", "speaker_id": "a"},
    ]})
    reference = tts.speaker_references(transcript)["a"]
    assert [segment.id for segment in reference] == ["two", "three"]


@pytest.mark.parametrize("duration_ms, expected_text, expected_duration", [
    (10_000, "Original A2", 10), (10_001, "Original A1", 1), (13_000, "Original A1", 1),
])
def test_reference_uses_a_complete_utterance_within_ten_seconds(
    context, model_process, duration_ms, expected_text, expected_duration,
):
    payload = json.loads(context.input_files["transcript"].read_text())
    payload["segments"][2].update(start_ms=2000, end_ms=2000 + duration_ms)
    context.input_files["transcript"].write_text(json.dumps(payload))
    sf.write(context.input_files["vocals"], np.full(16000 * 16, 0.1), 16000, subtype="PCM_16")
    tts.run(context, lambda *args: None)
    assert sf.info(model_process.clips[0]["reference_path"]).duration == expected_duration
    assert model_process.clips[0]["reference_text"] == expected_text


def test_missing_complete_reference_for_one_speaker_fails_before_extraction_or_inference(context, model_process):
    payload = json.loads(context.input_files["transcript"].read_text())
    payload["segments"][1].update(start_ms=1000, end_ms=11_001)
    payload["segments"][2].update(start_ms=11_001, end_ms=12_501)
    context.input_files["transcript"].write_text(json.dumps(payload))
    sf.write(context.input_files["vocals"], np.full(16000 * 13, 0.1), 16000, subtype="PCM_16")
    with pytest.raises(ApiError) as error:
        tts.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == "INVALID_MEDIA"
    assert "complete" in error.value.content["error"]["message"]
    assert not model_process.commands
    assert not (context.work_dir / "tts").exists()


@pytest.mark.parametrize("invalid", ["preset", "missing-vocals", "wrong-target", "missing-translation-id"])
def test_invalid_inputs_are_rejected_before_any_inference(context, model_process, invalid):
    if invalid == "preset":
        config = context.config.model_dump(mode="json")
        config["tts"]["voice"] = {"mode": "preset", "id": "unavailable"}
        config["separation"] = None
        context = replace(context, config=TaskConfig.model_validate(config))
    elif invalid == "missing-vocals":
        context.input_files["vocals"].unlink()
    else:
        payload = json.loads(context.input_files["translation"].read_text())
        if invalid == "wrong-target":
            payload["target_language"] = "ja"
        else:
            payload["segments"].pop()
        context.input_files["translation"].write_text(json.dumps(payload))
    with pytest.raises(ApiError):
        tts.run(context, lambda *args: None)
    assert not model_process.commands
    assert not (context.work_dir / "speech_clips.json").exists()


@pytest.mark.parametrize("invalid", [False, True])
def test_missing_or_invalid_generated_wav_cannot_publish_clip_manifest(context, model_process, invalid):
    model_process.output = False
    model_process.invalid = invalid
    with pytest.raises(ApiError) as error:
        tts.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == ("INVALID_PROVIDER_RESULT" if invalid else "STAGE_OUTPUT_MISSING")
    assert not (context.work_dir / "speech_clips.json").exists()


def test_cancel_terminates_and_reaps_actual_tts_process(context, monkeypatch):
    real_popen = subprocess.Popen
    children = []
    checks = 0

    def popen(command, **kwargs):
        if len(command) > 1 and command[1].endswith("tts_process.py"):
            process = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
            children.append(process)
            return process
        return real_popen(command, **kwargs)

    def cancel():
        nonlocal checks
        if children:
            checks += 1
            if checks == 2:
                raise StageCancelled()

    monkeypatch.setattr(media.subprocess, "Popen", popen)
    with pytest.raises(StageCancelled):
        tts.run(replace(context, check_cancel=cancel), lambda *args: None)
    assert len(children) == 1 and children[0].poll() is not None
    assert not (context.work_dir / "speech_clips.json").exists()


def child_request(context):
    clips = [{"segment_id": str(index), "text": text, "reference_path": str(context.input_files["vocals"]),
              "reference_text": " Source reference transcript.\n",
              "output_path": str(context.work_dir.parent / f"child-{index}.wav")}
             for index, text in enumerate([" 精确译文。\n", "Second exact text."])]
    path = context.work_dir.parent / "request.json"
    path.write_text(json.dumps({"clips": clips}, ensure_ascii=False))
    return clips, ["--model-path", str(tts.model_directory()), "--request-path", str(path), "--device", "cpu"]


def test_child_loads_local_model_once_and_calls_generate_once_per_exact_text(context, monkeypatch):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    loaded, generated = [], []

    def generate(**kwargs):
        generated.append(kwargs)
        return np.full(4800, 0.25)

    def load(*args, **kwargs):
        loaded.append((args, kwargs))
        return SimpleNamespace(tts_model=SimpleNamespace(sample_rate=48000), generate=generate)

    monkeypatch.setitem(sys.modules, "voxcpm", SimpleNamespace(VoxCPM=SimpleNamespace(from_pretrained=load)))
    clips, arguments = child_request(context)
    assert tts_process.main(arguments) == 0
    assert loaded == [((str(tts.model_directory().resolve()),), {
        "local_files_only": True, "load_denoiser": False, "optimize": False, "device": "cpu",
    })]
    assert generated == [{"text": clip["text"], "reference_wav_path": clip["reference_path"],
                          "prompt_wav_path": clip["reference_path"], "prompt_text": clip["reference_text"],
                          "normalize": False, "denoise": False, "retry_badcase": False} for clip in clips]
    assert all(sf.info(clip["output_path"]).samplerate == 48000 for clip in clips)
    assert all(sf.info(clip["output_path"]).frames == 4800 for clip in clips)


@pytest.mark.parametrize("reference_text", [None, "", " \n", 12])
def test_child_rejects_missing_reference_transcript_before_model_loading(context, monkeypatch, capsys, reference_text):
    loaded = []
    monkeypatch.setitem(sys.modules, "voxcpm", SimpleNamespace(VoxCPM=SimpleNamespace(
        from_pretrained=lambda *args, **kwargs: loaded.append(True))))
    clips, arguments = child_request(context)
    clips[0]["reference_text"] = reference_text
    request_path = Path(arguments[arguments.index("--request-path") + 1])
    request_path.write_text(json.dumps({"clips": clips}))
    assert tts_process.main(arguments) == 1
    assert json.loads(capsys.readouterr().err.strip().splitlines()[-1])["code"] == "INPUT_MISSING"
    assert not loaded
    assert not any(Path(clip["output_path"]).exists() for clip in clips)


def test_child_missing_model_package_is_explicit(context, monkeypatch, capsys):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    monkeypatch.setitem(sys.modules, "voxcpm", None)
    clips, arguments = child_request(context)
    assert tts_process.main(arguments) == 1
    assert json.loads(capsys.readouterr().err.strip().splitlines()[-1])["code"] == "MODEL_NOT_READY"
    assert not any(Path(clip["output_path"]).exists() for clip in clips)


@pytest.mark.parametrize("waveform", [np.array([]), np.array([float("nan")]), np.array([1.1]), np.zeros((2, 100))])
def test_child_invalid_model_output_is_not_retried(context, monkeypatch, capsys, waveform):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "0")
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return waveform

    monkeypatch.setitem(sys.modules, "voxcpm", SimpleNamespace(VoxCPM=SimpleNamespace(
        from_pretrained=lambda *args, **kwargs: SimpleNamespace(tts_model=SimpleNamespace(sample_rate=48000), generate=generate))))
    clips, arguments = child_request(context)
    assert tts_process.main(arguments) == 1
    assert json.loads(capsys.readouterr().err.strip().splitlines()[-1])["code"] == "INVALID_PROVIDER_RESULT"
    assert len(calls) == 1
    assert not any(Path(clip["output_path"]).exists() for clip in clips)

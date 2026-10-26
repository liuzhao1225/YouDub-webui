from __future__ import annotations

import pytest
from pydantic import ValidationError
from backend.app.v1.contracts import TaskConfig


@pytest.fixture
def config():
    return {"source_language": "en", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
            "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
            "translation": {"adapter": "openai", "model": "model", "device": "remote"}, "tts": None, "separation": None}


@pytest.mark.parametrize(
    "change",
    [
        {"target_language": "auto"},
        {"keep_background": True},
        {"output_mode": "dubbing"},
        {"output_mode": "both"},
        {"keep_background": "false"},
        {"api_key": "must-not-be-a-task-field"},
        {"translation": {"adapter": "demo", "model": "llm", "device": "unknown-device"}},
    ],
)
def test_reject_invalid_task_configuration(config, change):
    with pytest.raises(ValidationError):
        TaskConfig.model_validate(config | change)


def test_clone_and_background_require_separation(config):
    config.update(
        output_mode="dubbing",
        tts={"adapter": "tts", "model": "tts-model", "device": "cpu", "voice": {"mode": "source_clone"}},
    )
    with pytest.raises(ValidationError, match="require separation"):
        TaskConfig.model_validate(config)
    config["separation"] = {"adapter": "sep", "model": "sep-model", "device": "cpu"}
    assert TaskConfig.model_validate(config).tts.voice.mode == "source_clone"
    config["tts"]["voice"] = {"mode": "preset", "id": "voice-1"}
    with pytest.raises(ValidationError, match="not used"):
        TaskConfig.model_validate(config)
    config["keep_background"] = True
    assert TaskConfig.model_validate(config).keep_background
    config["tts"]["voice"] = {"mode": "source_clone", "id": "/arbitrary/file.wav"}
    with pytest.raises(ValidationError):
        TaskConfig.model_validate(config)


def test_optional_subtitle_alignment_preserves_existing_configs(config):
    assert TaskConfig.model_validate(config).subtitle_alignment is None
    assert TaskConfig.model_validate(config | {"subtitle_alignment": None}).subtitle_alignment is None


@pytest.mark.parametrize("mode", ["subtitles", "dubbing", "both"])
def test_subtitle_alignment_requires_complete_dubbed_audio_and_subtitle_output(config, mode):
    config.update(output_mode=mode, subtitle_alignment={
        "adapter": "qwen_forced_aligner", "model": "Qwen3-ForcedAligner-0.6B-hf", "device": "cpu",
    })
    if mode != "subtitles":
        config["tts"] = {"adapter": "test", "model": "voice", "device": "cpu", "voice": {"mode": "preset", "id": "voice"}}
    if mode == "both":
        assert TaskConfig.model_validate(config).subtitle_alignment.adapter == "qwen_forced_aligner"
    else:
        with pytest.raises(ValidationError, match="subtitle_alignment requires both"):
            TaskConfig.model_validate(config)

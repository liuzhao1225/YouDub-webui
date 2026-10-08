from __future__ import annotations

import pytest
from pydantic import ValidationError
from backend.app.v1.contracts import ConnectionPatch, SettingsPatch, TaskConfig


@pytest.fixture
def config():
    return {"source_language": "en", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
            "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
            "translation": {"adapter": "openai", "model": "model", "device": "remote"}, "tts": None, "separation": None}


@pytest.mark.parametrize(
    "change",
    [
        {"source_language": "zh"},
        {"target_language": "auto"},
        {"keep_background": True},
        {"output_mode": "dubbing"},
        {"output_mode": "both"},
        {"keep_background": "false"},
        {"api_key": "must-not-be-a-task-field"},
        {"translation": {"adapter": "demo", "model": "llm", "device": "mps"}},
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


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"ui_language": "zh", "defaults": None},
        {"ui_language": "zh", "connection": {"adapter": "demo", "api_key": None}},
        {"ui_language": None},
        {"defaults": None},
        {"connection": None},
        {"connection": {"adapter": "demo"}},
        {"connection": {"adapter": "demo", "base_url": None}},
        {"connection": {"adapter": "demo", "api_key": ""}},
    ],
)
def test_settings_patch_requires_one_non_null_group(payload):
    with pytest.raises(ValidationError):
        SettingsPatch.model_validate(payload)


def test_api_key_preserve_replace_clear_are_distinct():
    preserve = ConnectionPatch(adapter="demo", base_url="http://localhost:8080/v1")
    replace = ConnectionPatch(adapter="demo", api_key="a-real-secret")
    clear = ConnectionPatch(adapter="demo", api_key=None)
    assert "api_key" not in preserve.model_fields_set
    assert replace.api_key.get_secret_value() == "a-real-secret"
    assert "a-real-secret" not in repr(replace)
    assert "a-real-secret" not in replace.model_dump_json()
    assert clear.model_dump(exclude_unset=True) == {"adapter": "demo", "api_key": None}


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@example.org/v1",
        "https://example.org/v1?key=secret",
        "https://example.org/v1#secret",
        "https://example.org/v1?",
        "https://example.org:99999/v1",
        "https://example.org/white space",
        "file:///tmp/key.txt",
        "https:///missing-host",
    ],
)
def test_connection_urls_cannot_carry_secrets_or_non_http_paths(url):
    with pytest.raises(ValidationError):
        ConnectionPatch(adapter="demo", base_url=url)


@pytest.mark.parametrize("url", ["http://127.0.0.1:8000/v1", "http://[::1]:8000/v1", "https://example.org/v1/"])
def test_http_connection_urls_remain_unmodified(url):
    assert ConnectionPatch(adapter="demo", base_url=url).base_url == url

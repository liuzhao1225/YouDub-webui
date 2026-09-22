from __future__ import annotations

import sys
from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend.app.v1 import runtime


@pytest.fixture
def catalogue():
    """Explicit test capabilities; these are never production registrations."""
    capabilities = []
    for kind, adapter, device in (("asr", "whisper", "cpu"), ("translation", "openai", "remote"),
                                 ("tts", "voxcpm", "cpu"), ("separation", "demucs", "cpu")):
        capabilities.append({
            "adapter": adapter, "capability": kind, "execution": "remote" if device == "remote" else "local",
            "available": True, "unavailable_reason": None, "requires_api_key": device == "remote",
            "models": [{
                "id": f"test-{adapter}", "devices": [device], "source_languages": ["en"],
                "target_languages": ["zh"], "voice_modes": ["source_clone"] if kind == "tts" else [],
                "voices": [], "input_limits": {
                    "max_audio_duration_ms": None, "max_text_chars": None, "max_reference_duration_ms": None,
                },
            }],
        })
    return {"capabilities": capabilities, "devices": [{"id": "cpu", "available": True}]}


@pytest.fixture
def config():
    return {
        "source_language": "en", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "test-whisper", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-openai", "device": "remote"},
        "tts": None, "separation": None,
    }


def test_catalogue_does_not_advertise_legacy_models_or_load_them(monkeypatch):
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(runtime.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(runtime.platform, "machine", lambda: "arm64")
    result = runtime.build_runtime(
        connections=[{"adapter": "openai", "base_url": "https://example.test/v1", "has_api_key": True}],
        translation_model="configured-but-unwired",
    )
    assert result["status"] == "degraded"
    assert result["platform"] == "macos"
    assert result["arch"] == "arm64"
    assert [item["id"] for item in result["devices"]] == ["cpu"]
    assert {item["adapter"] for item in result["capabilities"]} == {"whisper", "openai", "voxcpm", "demucs"}
    assert all(not item["available"] and item["unavailable_reason"] and not item["models"]
               for item in result["capabilities"])
    assert result["instance_id"] == runtime.build_runtime()["instance_id"]
    assert "voxcpm" not in sys.modules
    assert "whisper" not in sys.modules


def test_cuda_catalogue_queries_devices_without_loading_models(monkeypatch):
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(
        is_available=lambda: True, device_count=lambda: 2,
        get_device_name=lambda index: f"Test GPU {index}",
    )))
    assert [item["id"] for item in runtime._detect_devices()] == ["cpu", "cuda:0", "cuda:1"]


def test_runtime_limits_are_independent_and_invalid_configuration_is_visible(monkeypatch):
    monkeypatch.setattr(runtime, "_detect_devices", lambda: [])
    monkeypatch.setenv("LOCAL_UPLOAD_MAX_BYTES", "123456")
    result = runtime.build_runtime()
    assert result["limits"]["max_file_bytes"] == 123456
    result["limits"]["video_suffixes"].clear()
    assert runtime.build_runtime()["limits"]["video_suffixes"]
    monkeypatch.setenv("LOCAL_UPLOAD_MAX_BYTES", "0")
    with pytest.raises(ValueError, match="positive integer"):
        runtime.build_runtime()


def test_valid_subtitles_selection_and_public_connection_pass(config, catalogue):
    runtime.validate_config_capabilities(config, catalogue, connections=[
        {"adapter": "openai", "base_url": "https://example.test/v1", "has_api_key": True},
    ])


@pytest.mark.parametrize("change,code,field", [
    (lambda c, r: c["asr"].update(adapter="invented"), "MODEL_NOT_READY", "asr.adapter"),
    (lambda c, r: c["asr"].update(model="unregistered"), "MODEL_NOT_READY", "asr.model"),
    (lambda c, r: r["capabilities"][0].update(available=False, unavailable_reason="Model assets are missing."),
     "MODEL_NOT_READY", "asr.adapter"),
    (lambda c, r: c["asr"].update(device="cuda:0"), "MODEL_NOT_READY", "asr.device"),
    (lambda c, r: c["translation"].update(device="cpu"), "MODEL_NOT_READY", "translation.device"),
    (lambda c, r: r["devices"][0].update(available=False), "MODEL_NOT_READY", "asr.device"),
    (lambda c, r: c.update(source_language="ja"), "UNSUPPORTED_LANGUAGE", "source_language"),
    (lambda c, r: c.update(target_language="ja"), "UNSUPPORTED_LANGUAGE", "target_language"),
    (lambda c, r: c.update(target_language="en"), "INVALID_CONFIG", "target_language"),
])
def test_unavailable_selection_fails_with_contract_error_location(config, catalogue, change, code, field):
    change(config, catalogue)
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, catalogue)
    assert error.value.code == code
    assert error.value.field == field


@pytest.mark.parametrize("connection", [
    None,
    {"adapter": "openai", "base_url": "https://example.test/v1", "has_api_key": False},
    {"adapter": "openai", "base_url": "file:///private/key", "has_api_key": True},
    {"adapter": "openai", "base_url": "https://user:secret@example.test/v1", "has_api_key": True},
])
def test_unconfigured_remote_connection_is_rejected_without_exposing_value(config, catalogue, connection):
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, catalogue, connections=[] if connection is None else [connection])
    assert error.value.code == "MODEL_NOT_READY"
    assert error.value.field == "translation.adapter"
    assert "secret" not in str(error.value)
    assert "/private" not in str(error.value)


def test_source_clone_is_supported_but_voxcpm_preset_is_not(config, catalogue):
    config.update(output_mode="dubbing", tts={
        "adapter": "voxcpm", "model": "test-voxcpm", "device": "cpu", "voice": {"mode": "source_clone"},
    }, separation={"adapter": "demucs", "model": "test-demucs", "device": "cpu"})
    runtime.validate_config_capabilities(config, catalogue)
    config["tts"]["voice"] = {"mode": "preset", "id": "invented"}
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, catalogue)
    assert error.value.field == "tts.voice.mode"


def test_preset_requires_registered_voice_and_target_language(config, catalogue):
    config.update(output_mode="dubbing", tts={
        "adapter": "voxcpm", "model": "test-voxcpm", "device": "cpu", "voice": {"mode": "preset", "id": "voice1"},
    })
    # This synthetic provider models a future preset adapter, not VoxCPM support.
    model = catalogue["capabilities"][2]["models"][0]
    model["voice_modes"] = ["preset"]
    model["voices"] = [{"id": "voice1", "name": "Voice 1", "languages": ["zh"]}]
    runtime.validate_config_capabilities(config, catalogue)
    model["voices"][0]["languages"] = ["en"]
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, catalogue)
    assert error.value.field == "tts.voice.id"


def test_auto_requires_asr_support_and_defers_detected_language(config, catalogue):
    config["source_language"] = "auto"
    with pytest.raises(runtime.CapabilityError, match="auto"):
        runtime.validate_config_capabilities(config, catalogue)
    catalogue["capabilities"][0]["models"][0]["source_languages"].append("auto")
    runtime.validate_config_capabilities(config, catalogue)
    resolved = deepcopy(config)
    resolved["source_language"] = "ja"
    catalogue["capabilities"][0]["models"][0]["source_languages"].append("ja")
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(resolved, catalogue)
    assert error.value.code == "UNSUPPORTED_LANGUAGE"

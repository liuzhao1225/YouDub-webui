from __future__ import annotations

import sys
from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend.app.v1 import runtime
from backend.app.v1.contracts import Runtime


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


@pytest.fixture
def installed_runtime(monkeypatch, tmp_path):
    models = tmp_path / "whisper-models"
    models.mkdir()
    (models / "tiny.pt").write_bytes(b"metadata-only test checkpoint")
    (models / "small.en.pt").write_bytes(b"metadata-only English checkpoint")
    (models / "large-v3.pt").touch()
    monkeypatch.setenv("YOUDUB_WHISPER_MODELS_DIR", str(models))
    monkeypatch.delenv("YOUDUB_TRANSLATION_MODELS", raising=False)
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(runtime, "_detect_devices", lambda: [
        {"id": "cpu", "name": "CPU", "available": True, "unavailable_reason": None},
        {"id": "cuda:0", "name": "Test GPU", "available": True, "unavailable_reason": None},
    ])
    monkeypatch.setattr(runtime, "ffmpeg_binary", lambda: "ffmpeg")
    monkeypatch.setattr(runtime, "ffprobe_binary", lambda: "ffprobe")
    monkeypatch.setattr(runtime.shutil, "which", lambda name: f"/test/bin/{name}")
    return [{"adapter": "openai", "base_url": "https://provider.invalid/v1", "has_api_key": True}]


def test_real_catalogue_reads_local_metadata_and_remote_config_without_model_or_network(installed_runtime, monkeypatch):
    import socket

    from backend.app.v1 import asr

    def forbidden(*args, **kwargs):
        pytest.fail("Runtime must not load a model, instantiate a provider, or connect to the network")

    monkeypatch.setattr(asr, "run", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setitem(sys.modules, "whisper", SimpleNamespace(load_model=forbidden))
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=forbidden))
    result = runtime.build_runtime(connections=installed_runtime)
    Runtime.model_validate(result)
    assert result["status"] == "degraded"  # TTS and separation remain unconnected.
    whisper, translation, tts, separation = result["capabilities"]
    assert whisper["available"] and whisper["unavailable_reason"] is None
    assert [model["id"] for model in whisper["models"]] == ["tiny", "small.en"]
    assert whisper["models"][0]["source_languages"] == ["auto", "en", "zh", "ja"]
    assert whisper["models"][1]["source_languages"] == ["auto", "en"]
    assert all(model["devices"] == ["cpu", "cuda:0"] for model in whisper["models"])
    assert all(model["input_limits"] == {"max_audio_duration_ms": 600000,
                                         "max_text_chars": None, "max_reference_duration_ms": None}
               for model in whisper["models"])
    assert whisper["data_sent"] == [] and whisper["remote_operations"] is None
    assert translation["available"] and translation["unavailable_reason"] is None
    assert [model["id"] for model in translation["models"]] == ["gpt-4.1-mini"]
    assert translation["data_sent"] == ["text"]
    assert translation["remote_operations"] == {"submit_mode": "sync", "can_poll": False,
                                                 "can_cancel": False, "can_lookup_request_key": False}
    assert not tts["available"] and not separation["available"]
    assert tts["models"] == separation["models"] == []


def test_translation_models_use_configured_candidates_and_preserve_saved_default(installed_runtime, monkeypatch):
    monkeypatch.setenv("YOUDUB_TRANSLATION_MODELS", " custom-one, custom-two, custom-one, ")
    result = runtime.build_runtime(connections=installed_runtime, translation_model="saved-default")
    capability = result["capabilities"][1]
    assert [model["id"] for model in capability["models"]] == ["custom-one", "custom-two", "saved-default"]
    assert all(model["devices"] == ["remote"] and model["source_languages"] == ["en", "zh", "ja"]
               and model["target_languages"] == ["en", "zh", "ja"] for model in capability["models"])
    monkeypatch.setenv("YOUDUB_TRANSLATION_MODELS", " , ")
    capability = runtime.build_runtime(connections=installed_runtime)["capabilities"][1]
    assert not capability["available"] and capability["models"] == []
    assert "YOUDUB_TRANSLATION_MODELS" in capability["unavailable_reason"]


@pytest.mark.parametrize("missing", ["whisper", "torch", "ffmpeg", "ffprobe", "checkpoint"])
def test_whisper_is_unavailable_when_a_real_local_prerequisite_is_missing(installed_runtime, monkeypatch, tmp_path, missing):
    if missing in {"whisper", "torch"}:
        monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: None if name == missing else object())
    elif missing in {"ffmpeg", "ffprobe"}:
        monkeypatch.setattr(runtime.shutil, "which", lambda name: None if name == missing else f"/test/bin/{name}")
    else:
        monkeypatch.setenv("YOUDUB_WHISPER_MODELS_DIR", str(tmp_path / "missing-models"))
    capability = runtime.build_runtime(connections=installed_runtime)["capabilities"][0]
    assert not capability["available"] and capability["unavailable_reason"] and capability["models"] == []


def test_configured_ffmpeg_without_path_ffmpeg_does_not_advertise_whisper(installed_runtime, monkeypatch):
    monkeypatch.setattr(runtime, "ffmpeg_binary", lambda: "/configured/ffmpeg")
    monkeypatch.setattr(runtime.shutil, "which", lambda name: None if name == "ffmpeg" else "/test/executable")
    capability = runtime.build_runtime(connections=installed_runtime)["capabilities"][0]
    assert not capability["available"]
    assert "Whisper ASR" in capability["unavailable_reason"]
    assert "PATH" in capability["unavailable_reason"]


@pytest.mark.parametrize("missing", ["sdk", "connection", "key", "url"])
def test_translation_is_unavailable_without_sdk_and_valid_public_connection(installed_runtime, monkeypatch, missing):
    connections = deepcopy(installed_runtime)
    if missing == "sdk":
        monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: None if name == "openai" else object())
    elif missing == "connection":
        connections = []
    elif missing == "key":
        connections[0]["has_api_key"] = False
    else:
        connections[0]["base_url"] = "https://username:private-password@provider.invalid/v1"
    capability = runtime.build_runtime(connections=connections)["capabilities"][1]
    assert not capability["available"] and capability["unavailable_reason"] and capability["models"] == []
    assert "private-password" not in capability["unavailable_reason"]


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

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
    assert {item["adapter"] for item in result["capabilities"]} == {"whisper", "openai", "voxcpm", "demucs", "qwen_forced_aligner"}
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
    monkeypatch.setenv("YOUDUB_VOXCPM_MODEL_DIR", str(tmp_path / "VoxCPM2"))
    monkeypatch.setenv("YOUDUB_DEMUCS_MODELS_DIR", str(tmp_path / "demucs"))
    monkeypatch.delenv("YOUDUB_TRANSLATION_MODELS", raising=False)
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(runtime.importlib.metadata, "version", lambda name: "2.0.3")
    monkeypatch.setattr(runtime, "PathFinder", SimpleNamespace(find_spec=lambda name, path: object()))
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
    assert result["status"] == "degraded"  # TTS and separation have no assets in this fixture.
    whisper, translation, tts, separation = result["capabilities"][:4]
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


@pytest.fixture
def all_model_assets(installed_runtime, tmp_path):
    root = tmp_path / "VoxCPM2"
    root.mkdir()
    for name in ("config.json", "tokenizer_config.json", "tokenizer.json", "model.safetensors", "audiovae.safetensors"):
        (root / name).write_bytes(b"metadata-only fixture asset")
    root = tmp_path / "demucs"
    root.mkdir()
    (root / "955717e8-8726e21a.th").write_bytes(b"metadata-only fixture checkpoint")
    return installed_runtime


def test_all_capabilities_ready_reads_assets_without_loading_models_or_network(all_model_assets, monkeypatch):
    import socket

    from backend.app.v1 import separate, tts

    def forbidden(*args, **kwargs):
        pytest.fail("Runtime must only read package and asset metadata")

    monkeypatch.setattr(tts, "run", forbidden)
    monkeypatch.setattr(separate, "run", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setitem(sys.modules, "voxcpm", SimpleNamespace(VoxCPM=SimpleNamespace(from_pretrained=forbidden)))
    monkeypatch.setitem(sys.modules, "demucs", SimpleNamespace(load_model=forbidden))
    result = runtime.build_runtime(connections=all_model_assets)
    Runtime.model_validate(result)
    assert result["status"] == "ready"
    assert all(item["available"] and item["unavailable_reason"] is None for item in result["capabilities"][:4])
    tts_capability, separation = result["capabilities"][2:4]
    assert tts_capability["models"] == [{
        "id": "VoxCPM2", "devices": ["cpu", "cuda:0"], "source_languages": ["en", "zh", "ja"],
        "target_languages": ["en", "zh", "ja"], "voice_modes": ["source_clone"], "voices": [],
        "input_limits": {"max_audio_duration_ms": None, "max_text_chars": None, "max_reference_duration_ms": 10000},
    }]
    assert separation["models"] == [{
        "id": "htdemucs", "devices": ["cpu", "cuda:0"], "source_languages": [], "target_languages": [],
        "voice_modes": [], "voices": [],
        "input_limits": {"max_audio_duration_ms": 600000, "max_text_chars": None, "max_reference_duration_ms": None},
    }]
    assert all(item["data_sent"] == [] and item["remote_operations"] is None and not item["requires_api_key"]
               for item in (tts_capability, separation))


@pytest.mark.parametrize("version", ["1.5.0", "2.0.2", "2.0.3rc1", "not-a-version", None])
def test_voxcpm_requires_distribution_version_with_explicit_device_support(all_model_assets, monkeypatch, version):
    def installed_version(name):
        if name == "transformers":
            return "5.16.0"
        assert name == "voxcpm"
        if version is None:
            raise runtime.importlib.metadata.PackageNotFoundError(name)
        return version

    monkeypatch.setattr(runtime.importlib.metadata, "version", installed_version)
    result = runtime.build_runtime(connections=all_model_assets)
    capability = result["capabilities"][2]
    assert not capability["available"] and capability["models"] == []
    assert "voxcpm>=2.0.3" in capability["unavailable_reason"]
    assert result["status"] == "degraded"
    assert result["capabilities"][3]["available"]


@pytest.mark.parametrize("missing,capability_index", [
    ("voxcpm", 2), ("transformers", 2), ("librosa", 2), ("safetensors", 2), ("huggingface_hub", 2),
    ("torch", 2), ("torchaudio", 2), ("soundfile", 2), ("numpy", 2),
    ("torch", 3), ("torchaudio", 3), ("soundfile", 3), ("julius", 3), ("dora", 3),
    ("omegaconf", 3), ("einops", 3), ("openunmix", 3),
])
def test_local_capability_requires_its_runtime_dependencies(all_model_assets, monkeypatch, missing, capability_index):
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda name: None if name == missing else object())
    result = runtime.build_runtime(connections=all_model_assets)
    capability = result["capabilities"][capability_index]
    assert not capability["available"] and capability["models"] == []
    assert missing in capability["unavailable_reason"]
    assert result["status"] == "degraded"


@pytest.mark.parametrize("missing", ["ffmpeg", "ffprobe"])
def test_tts_and_separation_require_media_binaries(all_model_assets, monkeypatch, missing):
    monkeypatch.setattr(runtime.shutil, "which", lambda name: None if name == missing else f"/test/bin/{name}")
    result = runtime.build_runtime(connections=all_model_assets)
    assert all(not item["available"] and "FFmpeg" in item["unavailable_reason"] for item in result["capabilities"][2:4])


def test_demucs_uses_childs_vendored_source_path_without_importing_it(all_model_assets, monkeypatch):
    calls = []

    def locate(name, paths):
        calls.append((name, paths))
        return None

    monkeypatch.setattr(runtime, "PathFinder", SimpleNamespace(find_spec=locate))
    capability = runtime.build_runtime(connections=all_model_assets)["capabilities"][3]
    assert not capability["available"] and "子模块" in capability["unavailable_reason"]
    assert calls == [("demucs", [str(runtime.Path(runtime.__file__).resolve().parents[3] / "submodule" / "demucs")])]


@pytest.mark.parametrize("relative_path,capability_index", [
    ("VoxCPM2/tokenizer.json", 2), ("VoxCPM2/audiovae.safetensors", 2),
    ("demucs/955717e8-8726e21a.th", 3),
])
def test_incomplete_local_assets_are_not_selectable(all_model_assets, tmp_path, relative_path, capability_index):
    (tmp_path / relative_path).write_bytes(b"")
    capability = runtime.build_runtime(connections=all_model_assets)["capabilities"][capability_index]
    assert not capability["available"] and capability["unavailable_reason"] and capability["models"] == []


def test_real_catalogue_accepts_source_clone_and_rejects_unregistered_presets(all_model_assets):
    result = runtime.build_runtime(connections=all_model_assets)
    config = {
        "source_language": "auto", "target_language": "ja", "output_mode": "both", "keep_background": True,
        "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "gpt-4.1-mini", "device": "remote"},
        "tts": {"adapter": "voxcpm", "model": "VoxCPM2", "device": "cuda:0", "voice": {"mode": "source_clone"}},
        "separation": {"adapter": "demucs", "model": "htdemucs", "device": "cpu"},
    }
    runtime.validate_config_capabilities(config, result, connections=all_model_assets)
    config["tts"]["voice"] = {"mode": "preset", "id": "unregistered"}
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, result, connections=all_model_assets)
    assert error.value.code == "INVALID_CONFIG" and error.value.field == "tts.voice.mode"


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


def test_optional_qwen_missing_does_not_degrade_existing_runtime(all_model_assets):
    result = runtime.build_runtime(connections=all_model_assets)
    assert result["status"] == "ready"
    qwen = result["capabilities"][-1]
    assert qwen["capability"] == "subtitle_alignment" and not qwen["available"]


def test_qwen_catalogue_uses_metadata_only_and_limits_each_dubbed_clip(all_model_assets, monkeypatch, tmp_path):
    from backend.app.v1 import forced_alignment

    monkeypatch.setattr(runtime.importlib.metadata, "version", lambda name: "5.17.0" if name == "transformers" else "2.0.3")
    root = tmp_path / "qwen"
    root.mkdir()
    for name in ("config.json", "model.safetensors", "processor_config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja"):
        (root / name).write_bytes(b"metadata fixture")
    monkeypatch.setenv("YOUDUB_FORCED_ALIGNER_MODEL_DIR", str(root))
    monkeypatch.setattr(forced_alignment, "align", lambda *args, **kwargs: pytest.fail("Runtime must not run alignment"))
    result = runtime.build_runtime(connections=all_model_assets)
    Runtime.model_validate(result)
    qwen = result["capabilities"][-1]
    assert qwen["available"] and qwen["execution"] == "local" and qwen["data_sent"] == []
    assert qwen["models"] == [{
        "id": "Qwen3-ForcedAligner-0.6B-hf", "devices": ["cpu", "cuda:0"], "source_languages": [],
        "target_languages": ["en", "zh"], "voice_modes": [], "voices": [],
        "input_limits": {"max_audio_duration_ms": 300000, "max_text_chars": None, "max_reference_duration_ms": None},
    }]
    (root / "model.safetensors").write_bytes(b"")
    result = runtime.build_runtime(connections=all_model_assets)
    assert not result["capabilities"][-1]["available"]
    assert result["status"] == "ready"


@pytest.mark.parametrize("version", ["5.16.0", "6.0.0", "5.17.0rc1", "bad", None])
def test_qwen_requires_supported_transformers_without_importing_model(all_model_assets, monkeypatch, version):
    def installed(name):
        if name != "transformers":
            return "2.0.3"
        if version is None:
            raise runtime.importlib.metadata.PackageNotFoundError(name)
        return version
    monkeypatch.setattr(runtime.importlib.metadata, "version", installed)
    qwen = runtime.build_runtime(connections=all_model_assets)["capabilities"][-1]
    assert not qwen["available"] and "transformers>=5.17,<6" in qwen["unavailable_reason"]


def test_selected_qwen_validates_its_own_model_device_and_target_language(config, catalogue):
    qwen = deepcopy(catalogue["capabilities"][3])
    qwen.update(adapter="qwen_forced_aligner", capability="subtitle_alignment")
    qwen["models"][0].update(id="Qwen3-ForcedAligner-0.6B-hf", source_languages=[], target_languages=["en", "zh"])
    catalogue["capabilities"].append(qwen)
    config.update(output_mode="both", tts={
        "adapter": "voxcpm", "model": "test-voxcpm", "device": "cpu", "voice": {"mode": "source_clone"},
    }, separation={"adapter": "demucs", "model": "test-demucs", "device": "cpu"}, subtitle_alignment={
        "adapter": "qwen_forced_aligner", "model": "Qwen3-ForcedAligner-0.6B-hf", "device": "cpu",
    })
    runtime.validate_config_capabilities(config, catalogue)
    for field, value in (("adapter", "unknown"), ("model", "unknown"), ("device", "remote")):
        altered = deepcopy(config)
        altered["subtitle_alignment"][field] = value
        with pytest.raises(runtime.CapabilityError) as error:
            runtime.validate_config_capabilities(altered, catalogue)
        assert error.value.field == f"subtitle_alignment.{field}"
    qwen["models"][0]["target_languages"] = ["en"]
    with pytest.raises(runtime.CapabilityError) as error:
        runtime.validate_config_capabilities(config, catalogue)
    assert error.value.code == "UNSUPPORTED_LANGUAGE" and error.value.field == "target_language"
    qwen.update(available=False, unavailable_reason="missing assets")
    config["subtitle_alignment"] = None
    runtime.validate_config_capabilities(config, catalogue)

from __future__ import annotations

import types

import pytest

from backend.app import devices


def fake_torch(
    cuda_available: bool = False,
    mps_available: bool = False,
    cuda_count: int = 1,
):
    return types.SimpleNamespace(
        __version__="2.11.0",
        version=types.SimpleNamespace(cuda="12.8" if cuda_available else None),
        cuda=types.SimpleNamespace(
            is_available=lambda: cuda_available,
            device_count=lambda: cuda_count,
        ),
        backends=types.SimpleNamespace(
            mps=types.SimpleNamespace(
                is_built=lambda: True,
                is_available=lambda: mps_available,
            ),
        ),
    )


def test_device_type_accepts_supported_devices():
    assert devices.device_type("cpu") == "cpu"
    assert devices.device_type("cuda") == "cuda"
    assert devices.device_type("cuda:0") == "cuda"
    assert devices.device_type("mps") == "mps"
    assert devices.device_type("mps:0") == "mps"


def test_device_type_rejects_unknown_device():
    with pytest.raises(RuntimeError, match="not a supported device"):
        devices.device_type("xpu")


def test_device_type_rejects_unsupported_mps_index():
    with pytest.raises(RuntimeError, match="only mps:0"):
        devices.device_type("mps:1")


def test_auto_prefers_cuda(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "auto")
    monkeypatch.setattr(devices, "_load_torch", lambda: fake_torch(cuda_available=True, mps_available=True))

    assert devices.resolve_device("demucs").selected == "cuda"


def test_auto_uses_mps_when_cuda_is_unavailable(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "auto")
    monkeypatch.setattr(devices, "_load_torch", lambda: fake_torch(cuda_available=False, mps_available=True))

    assert devices.resolve_device("demucs").selected == "mps"


def test_auto_falls_back_to_cpu(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "auto")
    monkeypatch.setattr(devices, "_load_torch", lambda: fake_torch(cuda_available=False, mps_available=False))

    assert devices.resolve_device("demucs").selected == "cpu"


def test_whisper_uses_cpu_when_configured_device_is_mps(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "mps")

    resolution = devices.resolve_device("whisper")

    assert resolution.selected == "cpu"
    assert "float64 DTW" in resolution.reason


def test_whisper_uses_cpu_when_configured_device_is_mps_with_index(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "mps:0")

    assert devices.resolve_device("whisper").selected == "cpu"


def test_whisper_keeps_cuda_device(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "cuda:0")

    assert devices.resolve_device("whisper").selected == "cuda:0"


def test_component_override_takes_precedence(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "cuda")
    monkeypatch.setenv("DEMUCS_DEVICE", "cpu")

    resolution = devices.resolve_device("demucs")
    assert resolution.selected == "cpu"
    assert resolution.setting_name == "DEMUCS_DEVICE"


def test_voxcpm_is_reported_as_unmanaged(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "cuda")

    resolution = devices.resolve_device("voxcpm")
    assert not resolution.managed
    assert resolution.selected == "library-auto"
    assert "upstream package" in resolution.reason


def test_validate_device_available_rejects_mps_index(monkeypatch):
    monkeypatch.setattr(devices, "_load_torch", lambda: fake_torch(mps_available=True))

    with pytest.raises(RuntimeError, match="only mps:0"):
        devices.validate_device_available("mps:1")


def test_whisper_rejects_unsupported_mps_index_before_fallback(monkeypatch):
    monkeypatch.setattr(devices, "default_device", lambda: "cpu")
    monkeypatch.setenv("WHISPER_DEVICE", "mps:1")

    with pytest.raises(RuntimeError, match="only mps:0"):
        devices.resolve_device("whisper")

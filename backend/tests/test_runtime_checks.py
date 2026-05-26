from __future__ import annotations

import types

import pytest

from backend.app import runtime_checks


def fake_torch(cuda_available: bool, cuda_version: str | None = None, device_count: int = 1):
    return types.SimpleNamespace(
        __version__="2.11.0",
        version=types.SimpleNamespace(cuda=cuda_version),
        cuda=types.SimpleNamespace(
            is_available=lambda: cuda_available,
            device_count=lambda: device_count,
        ),
    )


def test_validate_runtime_device_skips_cpu(monkeypatch):
    monkeypatch.setattr(runtime_checks, "device", lambda: "cpu")
    monkeypatch.setattr(
        runtime_checks,
        "_load_torch",
        lambda: (_ for _ in ()).throw(AssertionError("torch should not be loaded")),
    )

    runtime_checks.validate_runtime_device()


def test_validate_runtime_device_accepts_cuda(monkeypatch):
    monkeypatch.setattr(runtime_checks, "device", lambda: "cuda:0")
    monkeypatch.setattr(runtime_checks, "_load_torch", lambda: fake_torch(True, "12.8"))

    runtime_checks.validate_runtime_device()


def test_validate_runtime_device_rejects_unavailable_cuda(monkeypatch):
    monkeypatch.setattr(runtime_checks, "device", lambda: "cuda")
    monkeypatch.setattr(runtime_checks, "_load_torch", lambda: fake_torch(False, None))

    with pytest.raises(RuntimeError, match="CUDA is not available") as exc:
        runtime_checks.validate_runtime_device()

    assert "requirements-pytorch-cu128.txt" in str(exc.value)


def test_validate_runtime_device_rejects_missing_cuda_index(monkeypatch):
    monkeypatch.setattr(runtime_checks, "device", lambda: "cuda:1")
    monkeypatch.setattr(runtime_checks, "_load_torch", lambda: fake_torch(True, "12.8", device_count=1))

    with pytest.raises(RuntimeError, match="only 1 CUDA"):
        runtime_checks.validate_runtime_device()

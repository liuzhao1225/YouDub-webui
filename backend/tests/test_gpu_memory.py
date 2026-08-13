from __future__ import annotations

import builtins
import sys
from types import SimpleNamespace

from backend.app import gpu_memory


def test_release_after_stage_is_enabled_by_default(monkeypatch):
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)

    assert gpu_memory.release_after_stage_enabled() is True


def test_release_after_stage_can_be_disabled(monkeypatch):
    for value in ("0", "false", "False", "no", "off"):
        monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", value)
        assert gpu_memory.release_after_stage_enabled() is False


def test_release_stage_memory_releases_matching_models_and_torch_cache(monkeypatch):
    released: list[str] = []
    cache_releases: list[str] = []
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.whisper_asr",
        SimpleNamespace(release_model=lambda: released.append("whisper")),
    )
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.voxcpm",
        SimpleNamespace(release_model=lambda: released.append("voxcpm")),
    )
    monkeypatch.setattr(gpu_memory, "_release_torch_cache", lambda: cache_releases.append("torch"))

    gpu_memory.release_stage_memory("separate")
    gpu_memory.release_stage_memory("asr")
    gpu_memory.release_stage_memory("tts")
    gpu_memory.release_stage_memory("translate")

    assert released == ["whisper", "voxcpm"]
    assert cache_releases == ["torch", "torch", "torch"]


def test_disabled_release_skips_models_and_torch_cache(monkeypatch):
    released: list[str] = []
    monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", "false")
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.whisper_asr",
        SimpleNamespace(release_model=lambda: released.append("whisper")),
    )
    monkeypatch.setattr(gpu_memory, "_release_torch_cache", lambda: released.append("torch"))

    gpu_memory.release_stage_memory("asr")
    gpu_memory.release_task_memory()

    assert released == []


def test_release_task_memory_releases_all_loaded_models(monkeypatch):
    released: list[str] = []
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.whisper_asr",
        SimpleNamespace(release_model=lambda: released.append("whisper")),
    )
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.voxcpm",
        SimpleNamespace(release_model=lambda: released.append("voxcpm")),
    )
    monkeypatch.setattr(gpu_memory, "_release_torch_cache", lambda: released.append("torch"))

    gpu_memory.release_task_memory()

    assert released == ["whisper", "voxcpm", "torch"]


def test_torch_cache_release_only_collects_gc_when_torch_is_not_loaded(monkeypatch):
    calls: list[str] = []
    original_import = builtins.__import__

    def reject_torch_import(name, *args, **kwargs):
        if name == "torch":
            raise AssertionError("torch should not be imported")
        return original_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "torch", raising=False)
    monkeypatch.setattr(builtins, "__import__", reject_torch_import)
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc"))

    gpu_memory._release_torch_cache()

    assert calls == ["gc"]


def test_torch_cache_release_ignores_backend_errors(monkeypatch):
    calls: list[str] = []

    def fail_cuda():
        calls.append("cuda")
        raise RuntimeError("CUDA unavailable")

    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(empty_cache=fail_cuda),
        mps=SimpleNamespace(empty_cache=lambda: calls.append("mps")),
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc"))

    gpu_memory._release_torch_cache()

    assert calls == ["gc", "cuda", "mps"]

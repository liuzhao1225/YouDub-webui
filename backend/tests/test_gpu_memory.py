from __future__ import annotations

import builtins
import sys
from types import SimpleNamespace

import pytest

from backend.app import gpu_memory


def _counter(*values: int):
    remaining = iter(values)
    return lambda: next(remaining)


def _fake_torch(
    calls: list[str],
    *,
    cuda_available: bool,
    mps_available: bool,
    cuda_memory: dict[int, tuple[tuple[int, int], tuple[int, int]]] | None = None,
):
    if cuda_memory is None:
        cuda_memory = {
            0: (
                (800 * 1024**2, 0),
                (1000 * 1024**2, 100 * 1024**2),
            )
        }
    cuda_allocated = {index: iter(values[0]) for index, values in cuda_memory.items()}
    cuda_reserved = {index: iter(values[1]) for index, values in cuda_memory.items()}

    def device_count():
        calls.append("cuda.device_count")
        return len(cuda_memory)

    def memory_allocated(index):
        calls.append(f"cuda.memory_allocated:{index}")
        return next(cuda_allocated[index])

    def memory_reserved(index):
        calls.append(f"cuda.memory_reserved:{index}")
        return next(cuda_reserved[index])

    cuda = SimpleNamespace(
        is_available=lambda: cuda_available,
        device_count=device_count,
        memory_allocated=memory_allocated,
        memory_reserved=memory_reserved,
        empty_cache=lambda: calls.append("cuda.empty_cache"),
    )
    mps = SimpleNamespace(
        current_allocated_memory=_counter(600 * 1024**2, 0),
        driver_allocated_memory=_counter(900 * 1024**2, 80 * 1024**2),
        empty_cache=lambda: calls.append("mps.empty_cache"),
    )
    return SimpleNamespace(
        cuda=cuda,
        mps=mps,
        backends=SimpleNamespace(
            mps=SimpleNamespace(is_available=lambda: mps_available),
        ),
    )


def test_release_is_enabled_by_default_and_parses_explicit_values(monkeypatch):
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    assert gpu_memory.release_after_stage_enabled() is True

    for value in ("1", "true", "TRUE", " yes ", "on"):
        monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", value)
        assert gpu_memory.release_after_stage_enabled() is True

    for value in ("0", "false", "FALSE", " no ", "off"):
        monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", value)
        assert gpu_memory.release_after_stage_enabled() is False


def test_release_rejects_unknown_switch_value(monkeypatch):
    monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", "sometimes")

    with pytest.raises(ValueError, match="received 'sometimes'"):
        gpu_memory.release_after_stage_enabled()


def test_stage_release_records_cuda_and_mps_memory_before_and_after(monkeypatch):
    calls: list[str] = []
    released: list[str] = []
    fake_torch = _fake_torch(calls, cuda_available=True, mps_available=True)
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.whisper_asr",
        SimpleNamespace(release_model=lambda: released.append("whisper") or True),
    )
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc.collect") or 7)

    report = gpu_memory.release_stage_memory("asr")

    assert report is not None
    assert report.released_models == ("Whisper",)
    assert report.collected_objects == 7
    assert calls == [
        "cuda.device_count",
        "cuda.memory_allocated:0",
        "cuda.memory_reserved:0",
        "gc.collect",
        "cuda.empty_cache",
        "mps.empty_cache",
        "cuda.memory_allocated:0",
        "cuda.memory_reserved:0",
    ]
    assert released == ["whisper"]
    assert report.devices[0] == gpu_memory.DeviceMemory(
        name="CUDA:0",
        available=True,
        allocated_before=800 * 1024**2,
        reserved_before=1000 * 1024**2,
        allocated_after=0,
        reserved_after=100 * 1024**2,
    )
    assert report.devices[1] == gpu_memory.DeviceMemory(
        name="MPS",
        available=True,
        allocated_before=600 * 1024**2,
        reserved_before=900 * 1024**2,
        allocated_after=0,
        reserved_after=80 * 1024**2,
    )
    assert "CUDA:0 allocated 800.0 MiB -> 0.0 MiB" in report.summary()
    assert "MPS allocated 600.0 MiB -> 0.0 MiB" in report.summary()


def test_stage_release_records_each_cuda_device_including_cuda_one(monkeypatch):
    calls: list[str] = []
    fake_torch = _fake_torch(
        calls,
        cuda_available=True,
        mps_available=False,
        cuda_memory={
            0: ((64 * 1024**2, 32 * 1024**2), (96 * 1024**2, 48 * 1024**2)),
            1: ((800 * 1024**2, 0), (1000 * 1024**2, 100 * 1024**2)),
        },
    )
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc.collect") or 0)

    report = gpu_memory.release_stage_memory("separate")

    assert report is not None
    assert report.devices[1] == gpu_memory.DeviceMemory(
        name="CUDA:1",
        available=True,
        allocated_before=800 * 1024**2,
        reserved_before=1000 * 1024**2,
        allocated_after=0,
        reserved_after=100 * 1024**2,
    )
    assert calls.count("cuda.memory_allocated:1") == 2
    assert calls.count("cuda.memory_reserved:1") == 2
    assert "CUDA:1 allocated 800.0 MiB -> 0.0 MiB" in report.summary()


def test_torch_cache_release_does_not_import_torch_when_unloaded(monkeypatch):
    calls: list[str] = []
    original_import = builtins.__import__

    def reject_torch_import(name, *args, **kwargs):
        if name == "torch":
            raise AssertionError("torch should not be imported")
        return original_import(name, *args, **kwargs)

    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.delitem(sys.modules, "torch", raising=False)
    monkeypatch.setattr(builtins, "__import__", reject_torch_import)
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc.collect") or 3)

    report = gpu_memory.release_stage_memory("separate")

    assert report is not None
    assert report.torch_loaded is False
    assert calls == ["gc.collect"]
    assert "torch not loaded; backend cache release skipped" in report.summary()


def test_unavailable_cuda_and_mps_skip_backend_calls(monkeypatch):
    calls: list[str] = []
    fake_torch = _fake_torch(calls, cuda_available=False, mps_available=False)
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc.collect") or 0)

    report = gpu_memory.release_stage_memory("separate")

    assert report is not None
    assert calls == ["gc.collect"]
    assert [device.available for device in report.devices] == [False, False]
    assert "CUDA unavailable" in report.summary()
    assert "MPS unavailable" in report.summary()


def test_release_failures_are_aggregated_and_raised(monkeypatch):
    calls: list[str] = []

    def fail_model_release():
        calls.append("whisper.release_model")
        raise RuntimeError("model release exploded")

    fake_torch = _fake_torch(calls, cuda_available=True, mps_available=False)
    fake_torch.cuda.empty_cache = lambda: (_ for _ in ()).throw(RuntimeError("cache release exploded"))
    monkeypatch.delenv("RELEASE_GPU_MEMORY_AFTER_STAGE", raising=False)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(
        sys.modules,
        "backend.app.adapters.whisper_asr",
        SimpleNamespace(release_model=fail_model_release),
    )
    monkeypatch.setattr(gpu_memory.gc, "collect", lambda: calls.append("gc.collect") or 0)

    with pytest.raises(gpu_memory.MemoryReleaseError) as exc_info:
        gpu_memory.release_stage_memory("asr")

    message = str(exc_info.value)
    assert "Whisper.release_model: RuntimeError: model release exploded" in message
    assert "CUDA.empty_cache: RuntimeError: cache release exploded" in message
    assert calls == [
        "cuda.device_count",
        "cuda.memory_allocated:0",
        "cuda.memory_reserved:0",
        "whisper.release_model",
        "gc.collect",
        "cuda.memory_allocated:0",
        "cuda.memory_reserved:0",
    ]


def test_disabled_release_skips_stage_and_task_cleanup(monkeypatch):
    monkeypatch.setenv("RELEASE_GPU_MEMORY_AFTER_STAGE", "false")

    assert gpu_memory.release_stage_memory("asr") is None
    assert gpu_memory.release_task_memory() is None

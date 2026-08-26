from __future__ import annotations

import gc
import os
import sys
from dataclasses import dataclass
from typing import Callable, TypeVar


_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}
_STAGE_MODEL_MODULES = {
    "asr": (("backend.app.adapters.whisper_asr", "Whisper"),),
    "tts": (("backend.app.adapters.voxcpm", "VoxCPM"),),
}
_GPU_STAGES = {"separate", "asr", "tts"}
_TASK_MODEL_MODULES = (
    ("backend.app.adapters.whisper_asr", "Whisper"),
    ("backend.app.adapters.voxcpm", "VoxCPM"),
)

T = TypeVar("T")


@dataclass(frozen=True)
class DeviceMemory:
    name: str
    available: bool
    allocated_before: int | None = None
    reserved_before: int | None = None
    allocated_after: int | None = None
    reserved_after: int | None = None

    def summary(self) -> str:
        if not self.available:
            return f"{self.name} unavailable"
        return (
            f"{self.name} allocated {_format_bytes(self.allocated_before)} -> "
            f"{_format_bytes(self.allocated_after)}, reserved/driver "
            f"{_format_bytes(self.reserved_before)} -> {_format_bytes(self.reserved_after)}"
        )


@dataclass(frozen=True)
class MemoryReleaseReport:
    scope: str
    released_models: tuple[str, ...]
    collected_objects: int
    torch_loaded: bool
    devices: tuple[DeviceMemory, ...]

    def summary(self) -> str:
        models = ", ".join(self.released_models) or "none"
        parts = [
            f"GPU memory release completed for {self.scope}",
            f"models={models}",
            f"gc_collected={self.collected_objects}",
        ]
        if not self.torch_loaded:
            parts.append("torch not loaded; backend cache release skipped")
        else:
            parts.extend(device.summary() for device in self.devices)
        return "; ".join(parts)


class MemoryReleaseError(RuntimeError):
    def __init__(self, scope: str, failures: list[tuple[str, Exception]]):
        self.scope = scope
        self.failures = tuple(failures)
        details = "; ".join(
            f"{operation}: {type(exc).__name__}: {exc}" for operation, exc in failures
        )
        super().__init__(f"GPU memory release failed for {scope}: {details}")


def release_after_stage_enabled() -> bool:
    raw_value = os.getenv("RELEASE_GPU_MEMORY_AFTER_STAGE")
    if raw_value is None:
        return True
    value = raw_value.strip().lower()
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    accepted = ", ".join(sorted(_TRUE_VALUES | _FALSE_VALUES))
    raise ValueError(
        "RELEASE_GPU_MEMORY_AFTER_STAGE must be one of "
        f"{accepted}; received {raw_value!r}"
    )


def _format_bytes(value: int | None) -> str:
    if value is None:
        return "unknown"
    return f"{value / (1024 * 1024):.1f} MiB"


def _attempt(
    operation: str,
    callback: Callable[[], T],
    failures: list[tuple[str, Exception]],
    default: T,
) -> T:
    try:
        return callback()
    except Exception as exc:
        failures.append((operation, exc))
        return default


def _is_available(
    name: str,
    callback: object,
    failures: list[tuple[str, Exception]],
) -> bool:
    if not callable(callback):
        return False
    return bool(_attempt(f"{name}.is_available", callback, failures, False))


def _read_counter(
    name: str,
    callback: object,
    failures: list[tuple[str, Exception]],
) -> int | None:
    if not callable(callback):
        return None
    return _attempt(name, callback, failures, None)


def _cuda_device_count(
    cuda: object,
    available: bool,
    failures: list[tuple[str, Exception]],
) -> int:
    if not available:
        return 0
    callback = getattr(cuda, "device_count", None)
    if not callable(callback):
        failures.append(("CUDA.device_count", RuntimeError("device_count is unavailable")))
        return 0
    count = _attempt("CUDA.device_count", callback, failures, 0)
    if not isinstance(count, int) or count < 1:
        failures.append(
            (
                "CUDA.device_count",
                RuntimeError(f"CUDA is available but device_count returned {count!r}"),
            )
        )
        return 0
    return count


def _read_cuda_counter(
    cuda: object,
    index: int,
    counter_name: str,
    phase: str,
    failures: list[tuple[str, Exception]],
) -> int | None:
    callback = getattr(cuda, counter_name, None)
    if not callable(callback):
        return None
    return _attempt(
        f"CUDA:{index}.{counter_name}({phase})",
        lambda: callback(index),
        failures,
        None,
    )


def _release_loaded_models(
    modules: tuple[tuple[str, str], ...],
    failures: list[tuple[str, Exception]],
) -> tuple[str, ...]:
    released: list[str] = []
    for module_name, model_name in modules:
        module = sys.modules.get(module_name)
        if module is None:
            continue
        callback = getattr(module, "release_model", None)
        if not callable(callback):
            if getattr(module, "_MODEL", None) is None:
                continue
            failures.append(
                (
                    f"{model_name}.release_model",
                    RuntimeError(f"loaded module {module_name} has no release_model function"),
                )
            )
            continue
        was_loaded = _attempt(f"{model_name}.release_model", callback, failures, False)
        if was_loaded:
            released.append(model_name)
    return tuple(released)


def _release_memory(
    scope: str,
    model_modules: tuple[tuple[str, str], ...],
) -> MemoryReleaseReport:
    failures: list[tuple[str, Exception]] = []
    torch = sys.modules.get("torch")
    torch_loaded = torch is not None

    cuda = getattr(torch, "cuda", None) if torch_loaded else None
    cuda_available = _is_available("CUDA", getattr(cuda, "is_available", None), failures)
    cuda_device_count = _cuda_device_count(cuda, cuda_available, failures)

    torch_backends = getattr(torch, "backends", None) if torch_loaded else None
    mps_backend = getattr(torch_backends, "mps", None)
    mps = getattr(torch, "mps", None) if torch_loaded else None
    mps_available = _is_available("MPS", getattr(mps_backend, "is_available", None), failures)

    cuda_before = {
        index: (
            _read_cuda_counter(cuda, index, "memory_allocated", "before", failures),
            _read_cuda_counter(cuda, index, "memory_reserved", "before", failures),
        )
        for index in range(cuda_device_count)
    }
    mps_before = (
        _read_counter(
            "MPS.current_allocated_memory(before)",
            getattr(mps, "current_allocated_memory", None),
            failures,
        )
        if mps_available
        else None
    )
    mps_cached_before = (
        _read_counter(
            "MPS.driver_allocated_memory(before)",
            getattr(mps, "driver_allocated_memory", None),
            failures,
        )
        if mps_available
        else None
    )

    released_models = _release_loaded_models(model_modules, failures)
    collected_objects = _attempt("gc.collect", gc.collect, failures, 0)

    if cuda_available:
        empty_cache = getattr(cuda, "empty_cache", None)
        if callable(empty_cache):
            _attempt("CUDA.empty_cache", empty_cache, failures, None)
        else:
            failures.append(("CUDA.empty_cache", RuntimeError("empty_cache is unavailable")))
    if mps_available:
        empty_cache = getattr(mps, "empty_cache", None)
        if callable(empty_cache):
            _attempt("MPS.empty_cache", empty_cache, failures, None)
        else:
            failures.append(("MPS.empty_cache", RuntimeError("empty_cache is unavailable")))

    cuda_after = {
        index: (
            _read_cuda_counter(cuda, index, "memory_allocated", "after", failures),
            _read_cuda_counter(cuda, index, "memory_reserved", "after", failures),
        )
        for index in range(cuda_device_count)
    }
    mps_after = (
        _read_counter(
            "MPS.current_allocated_memory(after)",
            getattr(mps, "current_allocated_memory", None),
            failures,
        )
        if mps_available
        else None
    )
    mps_cached_after = (
        _read_counter(
            "MPS.driver_allocated_memory(after)",
            getattr(mps, "driver_allocated_memory", None),
            failures,
        )
        if mps_available
        else None
    )

    if failures:
        error = MemoryReleaseError(scope, failures)
        raise error from failures[0][1]

    cuda_reports = (
        tuple(
            DeviceMemory(
                name=f"CUDA:{index}",
                available=True,
                allocated_before=cuda_before[index][0],
                reserved_before=cuda_before[index][1],
                allocated_after=cuda_after[index][0],
                reserved_after=cuda_after[index][1],
            )
            for index in range(cuda_device_count)
        )
        if cuda_available
        else (DeviceMemory(name="CUDA", available=False),)
    )

    return MemoryReleaseReport(
        scope=scope,
        released_models=released_models,
        collected_objects=collected_objects,
        torch_loaded=torch_loaded,
        devices=(
            *cuda_reports,
            DeviceMemory(
                name="MPS",
                available=mps_available,
                allocated_before=mps_before,
                reserved_before=mps_cached_before,
                allocated_after=mps_after,
                reserved_after=mps_cached_after,
            ),
        ),
    )


def release_stage_memory(stage: str) -> MemoryReleaseReport | None:
    if stage not in _GPU_STAGES or not release_after_stage_enabled():
        return None
    return _release_memory(f"stage {stage}", _STAGE_MODEL_MODULES.get(stage, ()))


def release_task_memory() -> MemoryReleaseReport | None:
    if not release_after_stage_enabled():
        return None
    return _release_memory("task finally", _TASK_MODEL_MODULES)

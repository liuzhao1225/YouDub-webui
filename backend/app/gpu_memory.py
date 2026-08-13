from __future__ import annotations

import gc
import os
import sys


_DISABLED_VALUES = {"0", "false", "no", "off"}


def release_after_stage_enabled() -> bool:
    return os.getenv("RELEASE_GPU_MEMORY_AFTER_STAGE", "true").strip().lower() not in _DISABLED_VALUES


def _call_safely(callback) -> None:
    if not callable(callback):
        return
    try:
        callback()
    except Exception:
        pass


def _release_torch_cache() -> None:
    gc.collect()
    torch = sys.modules.get("torch")
    if torch is None:
        return

    _call_safely(getattr(getattr(torch, "cuda", None), "empty_cache", None))
    _call_safely(getattr(getattr(torch, "mps", None), "empty_cache", None))


def release_stage_memory(stage: str) -> None:
    if not release_after_stage_enabled():
        return

    if stage == "asr":
        module = sys.modules.get("backend.app.adapters.whisper_asr")
        release_model = getattr(module, "release_model", None)
        _call_safely(release_model)
    elif stage == "tts":
        module = sys.modules.get("backend.app.adapters.voxcpm")
        release_model = getattr(module, "release_model", None)
        _call_safely(release_model)

    if stage in {"separate", "asr", "tts"}:
        _release_torch_cache()


def release_task_memory() -> None:
    if not release_after_stage_enabled():
        return

    for module_name in (
        "backend.app.adapters.whisper_asr",
        "backend.app.adapters.voxcpm",
    ):
        module = sys.modules.get(module_name)
        release_model = getattr(module, "release_model", None)
        _call_safely(release_model)
    _release_torch_cache()

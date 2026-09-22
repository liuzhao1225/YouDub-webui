"""The v1 capability catalogue and validation of selections against it.

Catalogue reads never load a model, download assets, or call a provider. Legacy
media functions are not advertised as v1 implementations until their config and
result mapping has been connected to the v1 worker.
"""
from __future__ import annotations

import importlib.util
import os
import platform
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4


CONTRACT_VERSION = "0.1.0-draft.1"
INSTANCE_ID = str(uuid4())

# These are application admission/scheduling limits, not model benchmarks. The
# v1 importer and worker consume this same catalogue when they are connected.
RUNTIME_LIMITS: dict[str, Any] = {
    "max_file_bytes": 4 * 1024 * 1024 * 1024,
    "max_video_duration_ms": 600_000,
    "max_video_width": 1920,
    "max_video_height": 1920,
    "max_frame_rate": 60,
    "video_suffixes": [".mp4", ".mov", ".mkv", ".webm"],
    "video_codecs": ["h264", "hevc", "vp8", "vp9", "av1"],
    "audio_codecs": ["aac", "mp3", "pcm_s16le", "pcm_s24le", "pcm_f32le", "opus", "vorbis", "flac"],
    "max_active_tasks": 1,
    "cpu_heavy_slots": 1,
    "gpu_slots_per_device": 1,
    "remote_request_slots_per_connection": 1,
    "remote_pending_slots_per_connection": 1,
    "poll_interval_ms": 2000,
}


class CapabilityError(ValueError):
    def __init__(self, code: str, message: str, field: str) -> None:
        super().__init__(message)
        self.code = code
        self.field = field


def _detect_devices() -> list[dict[str, Any]]:
    devices = [{"id": "cpu", "name": "CPU", "available": True, "unavailable_reason": None}]
    if importlib.util.find_spec("torch") is None:
        return devices

    # Querying CUDA does not construct or load any inference models. An invalid
    # installed Torch runtime must propagate its error rather than look ready.
    import torch

    if torch.cuda.is_available():
        devices.extend(
            {"id": f"cuda:{index}", "name": torch.cuda.get_device_name(index),
             "available": True, "unavailable_reason": None}
            for index in range(torch.cuda.device_count())
        )
    # The v1 Device contract currently supports CPU/CUDA only. In particular,
    # legacy VoxCPM's automatic MPS selection cannot become a selectable device.
    return devices


def build_runtime(
    instance_id: str | None = None,
    *,
    connections: Sequence[Mapping[str, Any]] | None = None,
    translation_model: str | None = None,
) -> dict[str, Any]:
    """Return an actual runtime snapshot; configuration alone enables no model.

    ``connections`` contains Settings' public connection records, without keys.
    It and ``translation_model`` are the inputs for subsequent adapter wiring.
    They do not currently change availability because no v1 adapter is wired.
    """
    capabilities = []
    for adapter, kind, execution in (
        ("whisper", "asr", "local"),
        ("openai", "translation", "remote"),
        ("voxcpm", "tts", "local"),
        ("demucs", "separation", "local"),
    ):
        remote = execution == "remote"
        capabilities.append({
            "adapter": adapter,
            "capability": kind,
            "execution": execution,
            "available": False,
            "unavailable_reason": "v1 媒体调用尚未接入。",
            "requires_api_key": remote,
            "models": [],
            "data_sent": ["text"] if remote else [],
            "remote_operations": {
                "submit_mode": "sync", "can_poll": False,
                "can_cancel": False, "can_lookup_request_key": False,
            } if remote else None,
        })

    limits = deepcopy(RUNTIME_LIMITS)
    limits["max_file_bytes"] = int(os.getenv("LOCAL_UPLOAD_MAX_BYTES", str(limits["max_file_bytes"])))
    if limits["max_file_bytes"] <= 0:
        raise ValueError("LOCAL_UPLOAD_MAX_BYTES must be a positive integer.")
    system = platform.system()
    platforms = {"Darwin": "macos", "Windows": "windows", "Linux": "linux"}
    if system not in platforms:
        raise RuntimeError(f"Unsupported operating system: {system}")
    return {
        "api_version": "v1",
        "contract_version": CONTRACT_VERSION,
        "instance_id": instance_id or INSTANCE_ID,
        "status": "degraded",
        "platform": platforms[system],
        "arch": platform.machine(),
        "devices": _detect_devices(),
        "capabilities": capabilities,
        "limits": limits,
    }


def validate_config_capabilities(
    config: Mapping[str, Any],
    runtime: Mapping[str, Any],
    *,
    connections: Sequence[Mapping[str, Any]] | None = None,
) -> None:
    """Validate a structurally validated TaskConfig against the current runtime.

    Pass Settings.connections to also require configured remote connections.
    ``None`` skips that check, which allows validating a config before saving its
    separate credentials. For source_language=auto, the worker must validate the
    detected language again before invoking translation or source-clone TTS.
    """
    source = config["source_language"]
    target = config["target_language"]
    if source == target:
        raise CapabilityError("INVALID_CONFIG", "Source and target languages must differ.", "target_language")

    available_devices = {device["id"] for device in runtime["devices"] if device["available"]}
    for kind in ("asr", "translation", "tts", "separation"):
        selection = config[kind]
        if selection is None:
            continue
        capability = next((item for item in runtime["capabilities"]
                           if item["adapter"] == selection["adapter"] and item["capability"] == kind), None)
        if capability is None or not capability["available"]:
            reason = capability["unavailable_reason"] if capability else "Adapter is not registered for this capability."
            raise CapabilityError("MODEL_NOT_READY", reason or "Adapter is unavailable.", f"{kind}.adapter")
        model = next((item for item in capability["models"] if item["id"] == selection["model"]), None)
        if model is None:
            raise CapabilityError("MODEL_NOT_READY", "Model is not in the available catalogue.", f"{kind}.model")
        device = selection["device"]
        remote = capability["execution"] == "remote"
        if device not in model["devices"] or (device != "remote" if remote else device not in available_devices):
            raise CapabilityError("MODEL_NOT_READY", "Selected model/device combination is unavailable.", f"{kind}.device")

        if kind == "asr" or (kind == "translation" and source != "auto"):
            _require_language(source, model["source_languages"], "source_language")
        if kind in {"translation", "tts"}:
            _require_language(target, model["target_languages"], "target_language")
        if kind == "tts":
            voice = selection["voice"]
            if voice["mode"] not in model["voice_modes"]:
                raise CapabilityError("INVALID_CONFIG", "Voice mode is unavailable for the model.", "tts.voice.mode")
            if voice["mode"] == "source_clone" and source != "auto" and model["source_languages"]:
                _require_language(source, model["source_languages"], "source_language")
            if voice["mode"] == "preset":
                preset = next((item for item in model["voices"] if item["id"] == voice["id"]), None)
                if preset is None or target not in preset["languages"]:
                    raise CapabilityError("INVALID_CONFIG", "Preset voice is unavailable for the target language.", "tts.voice.id")
        if remote and connections is not None:
            _require_connection(selection["adapter"], capability["requires_api_key"], connections, kind)


def _require_language(language: str, supported: Sequence[str], field: str) -> None:
    if language not in supported:
        raise CapabilityError("UNSUPPORTED_LANGUAGE", f"Language {language} is unavailable for the selected model.", field)


def _require_connection(adapter: str, requires_key: bool, connections: Sequence[Mapping[str, Any]], kind: str) -> None:
    connection = next((item for item in connections if item["adapter"] == adapter), None)
    if connection is None:
        raise CapabilityError("MODEL_NOT_READY", "Provider connection is not configured.", f"{kind}.adapter")
    address = str(connection.get("base_url", ""))
    try:
        url = urlsplit(address)
        valid = url.scheme in {"http", "https"} and bool(url.hostname) and not (
            url.username or url.password or url.query or url.fragment
        )
        url.port
    except ValueError:
        valid = False
    if not valid:
        raise CapabilityError("MODEL_NOT_READY", "Provider base URL is invalid.", f"{kind}.adapter")
    if requires_key and not connection.get("has_api_key", False):
        raise CapabilityError("MODEL_NOT_READY", "Provider API key is not configured.", f"{kind}.adapter")

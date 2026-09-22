"""The v1 capability catalogue and validation of selections against it.

Catalogue reads never load a model, download assets, or call a provider. Legacy
media functions are not advertised as v1 implementations until their config and
result mapping has been connected to the v1 worker.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import os
import platform
import shutil
from collections.abc import Mapping, Sequence
from copy import deepcopy
from importlib.machinery import PathFinder
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

from ..config import ffmpeg_binary, ffprobe_binary
from .segments import LANGUAGES


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


def _model(
    model_id: str, devices: list[str], source_languages: list[str], target_languages: list[str],
    *, max_audio_duration_ms: int | None = None, max_text_chars: int | None = None,
    max_reference_duration_ms: int | None = None,
) -> dict[str, Any]:
    return {
        "id": model_id, "devices": devices, "source_languages": source_languages,
        "target_languages": target_languages, "voice_modes": [], "voices": [],
        "input_limits": {"max_audio_duration_ms": max_audio_duration_ms,
                         "max_text_chars": max_text_chars, "max_reference_duration_ms": max_reference_duration_ms},
    }


def _whisper_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    if importlib.util.find_spec("whisper") is None or importlib.util.find_spec("torch") is None:
        return [], "本地 Whisper 需要安装 openai-whisper 和 torch。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    # Whisper's own load_audio invokes `ffmpeg` by name, independently of the
    # application's configured binary paths used by prepare/export.
    if shutil.which("ffmpeg") is None:
        return [], "Whisper ASR 还需要 PATH 中可执行的 ffmpeg；仅配置 FFMPEG_PATH 不足以读取音频。"
    from .asr import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 Whisper 的 CPU/CUDA 设备。"
    models = [_model(
        name, available_devices.copy(), ["auto", "en"] if name.endswith(".en") else ["auto", *LANGUAGES], [],
        max_audio_duration_ms=RUNTIME_LIMITS["max_video_duration_ms"],
    ) for name in available_models()]
    return models, None if models else "未找到非空的本地 Whisper .pt 权重；请安装到 Whisper 模型目录。"


def _translation_models(
    connections: Sequence[Mapping[str, Any]], translation_model: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    if importlib.util.find_spec("openai") is None:
        return [], "OpenAI 兼容翻译需要安装 openai SDK。"
    try:
        _require_connection("openai", True, connections, "translation")
    except CapabilityError as exc:
        return [], str(exc)
    # These are configured candidates, not a discovery/health response from the
    # provider. No client is constructed and no remote request is made here.
    configured = os.getenv("YOUDUB_TRANSLATION_MODELS", "gpt-4.1-mini")
    candidates = [name.strip() for name in configured.split(",") if name.strip()]
    if translation_model and translation_model.strip():
        candidates.append(translation_model.strip())
    from .translate import MAX_TEXT_CHARS
    models = [_model(name, ["remote"], list(LANGUAGES), list(LANGUAGES), max_text_chars=MAX_TEXT_CHARS)
              for name in dict.fromkeys(candidates)]
    return models, None if models else "未配置翻译模型；请设置 YOUDUB_TRANSLATION_MODELS。"


def _voxcpm_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    dependencies = ("voxcpm", "torch", "torchaudio", "numpy", "soundfile", "transformers", "librosa",
                    "einops", "huggingface_hub", "safetensors", "tqdm", "packaging")
    missing = [name for name in dependencies if importlib.util.find_spec(name) is None]
    if missing:
        return [], f"本地 VoxCPM2 缺少运行依赖：{', '.join(missing)}。"
    # Check installed distribution metadata, never import VoxCPM during a GET.
    from packaging.version import InvalidVersion, Version
    try:
        supported = Version(importlib.metadata.version("voxcpm")) >= Version("2.0.3")
    except (importlib.metadata.PackageNotFoundError, InvalidVersion):
        supported = False
    if not supported:
        return [], "本地 VoxCPM2 需要 voxcpm>=2.0.3，以支持明确的 CPU/CUDA 设备选择。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    from .tts import MAX_REFERENCE_DURATION_MS, available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 VoxCPM2 的 CPU/CUDA 设备。"
    models = [_model(name, available_devices.copy(), list(LANGUAGES), list(LANGUAGES),
                     max_reference_duration_ms=MAX_REFERENCE_DURATION_MS)
              for name in available_models()]
    for model in models:
        model["voice_modes"] = ["source_clone"]
    return models, None if models else "本地 VoxCPM2 权重或 tokenizer 资产不完整。"


def _demucs_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    # The child selects this vendored module path, independently of site-packages.
    source = Path(__file__).resolve().parents[3] / "submodule" / "demucs"
    if PathFinder.find_spec("demucs", [str(source)]) is None:
        return [], "缺少仓库中的 Demucs 子模块源码。"
    dependencies = ("torch", "torchaudio", "numpy", "soundfile", "julius", "dora", "omegaconf",
                    "einops", "openunmix", "tqdm")
    missing = [name for name in dependencies if importlib.util.find_spec(name) is None]
    if missing:
        return [], f"本地 Demucs 缺少运行依赖：{', '.join(missing)}。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    from .separate import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 Demucs 的 CPU/CUDA 设备。"
    models = [_model(name, available_devices.copy(), [], [],
                     max_audio_duration_ms=RUNTIME_LIMITS["max_video_duration_ms"])
              for name in available_models()]
    return models, None if models else "未找到非空的本地 htdemucs 权重。"


def _subtitle_alignment_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    dependencies = ("transformers", "torch", "numpy", "soundfile", "librosa", "packaging")
    missing = [name for name in dependencies if importlib.util.find_spec(name) is None]
    if missing:
        return [], f"本地 Qwen 字幕对齐缺少运行依赖：{', '.join(missing)}。"
    from packaging.version import InvalidVersion, Version
    try:
        version = Version(importlib.metadata.version("transformers"))
        supported = Version("5.17") <= version < Version("6")
    except (importlib.metadata.PackageNotFoundError, InvalidVersion):
        supported = False
    if not supported:
        return [], "本地 Qwen 字幕对齐需要 transformers>=5.17,<6。"
    from .forced_alignment import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 Qwen 字幕对齐的 CPU/CUDA 设备。"
    models = [_model(name, available_devices.copy(), [], ["en", "zh"], max_audio_duration_ms=300_000)
              for name in available_models()]
    return models, None if models else "本地 Qwen3-ForcedAligner-0.6B-hf 权重或 tokenizer 资产不完整。"


def build_runtime(
    instance_id: str | None = None,
    *,
    connections: Sequence[Mapping[str, Any]] | None = None,
    translation_model: str | None = None,
) -> dict[str, Any]:
    """Return locally verified capability prerequisites without inference/network.

    ``connections`` contains Settings' public connection records, without keys.
    A selectable remote model means its SDK and connection are configured; its
    health, authorization and model name are checked by the real request later.
    """
    devices = _detect_devices()
    capabilities = []
    for adapter, kind, execution in (
        ("whisper", "asr", "local"),
        ("openai", "translation", "remote"),
        ("voxcpm", "tts", "local"),
        ("demucs", "separation", "local"),
        ("qwen_forced_aligner", "subtitle_alignment", "local"),
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

    whisper_models, whisper_reason = _whisper_models(devices)
    translation_models, translation_reason = _translation_models(connections or [], translation_model)
    voxcpm_models, voxcpm_reason = _voxcpm_models(devices)
    demucs_models, demucs_reason = _demucs_models(devices)
    alignment_models, alignment_reason = _subtitle_alignment_models(devices)
    for capability, models, reason in (
        (capabilities[0], whisper_models, whisper_reason),
        (capabilities[1], translation_models, translation_reason),
        (capabilities[2], voxcpm_models, voxcpm_reason),
        (capabilities[3], demucs_models, demucs_reason),
        (capabilities[4], alignment_models, alignment_reason),
    ):
        capability.update(available=bool(models), unavailable_reason=reason, models=models)

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
        "status": "ready" if all(item["available"] for item in capabilities
                                  if item["capability"] != "subtitle_alignment") else "degraded",
        "platform": platforms[system],
        "arch": platform.machine(),
        "devices": devices,
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
    for kind in ("asr", "translation", "tts", "separation", "subtitle_alignment"):
        selection = config.get(kind)
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
        if kind in {"translation", "tts", "subtitle_alignment"}:
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

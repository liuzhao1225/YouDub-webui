"""Model metadata and cached, model-free accelerator probes for local providers."""
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
from uuid import uuid4

from ..config import ffmpeg_binary, ffprobe_binary
from ..accelerators import detect_devices
from ..resources import missing_modules, version_supported, version_requirement
from .segments import LANGUAGES


INSTANCE_ID = str(uuid4())

from .runtime_limits import RUNTIME_LIMITS


def _detect_devices() -> list[dict[str, Any]]:
    return deepcopy(detect_devices())


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
    if importlib.util.find_spec("nltk") is None:
        return [], "Whisper 英文分句需要安装 nltk==3.10.3 和 punkt_tab 数据。"
    from nltk.data import find

    try:
        punkt = Path(str(find("tokenizers/punkt_tab/english/")))
    except LookupError:
        return [], "缺少 Whisper 英文分句数据；请运行 .venv/bin/python -m nltk.downloader punkt_tab。"
    if any(not (punkt / name).is_file() or (punkt / name).stat().st_size == 0 for name in (
        "collocations.tab", "sent_starters.txt", "abbrev_types.txt", "ortho_context.tab",
    )):
        return [], "Whisper 英文 punkt_tab 数据不完整；请重新安装 punkt_tab。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    # Whisper's own load_audio invokes `ffmpeg` by name, independently of the
    # application's configured binary paths used by prepare/export.
    if shutil.which("ffmpeg") is None:
        return [], "Whisper ASR 还需要 PATH 中可执行的 ffmpeg；仅配置 FFMPEG_PATH 不足以读取音频。"
    from .asr import available_models

    # OpenAI Whisper stores sparse alignment heads; MPS cannot move these
    # buffers. Keep its ASR on CPU while other providers can use Apple MPS.
    available_devices = [device["id"] for device in devices if device["available"] and device["id"] != "mps"]
    if not available_devices:
        return [], "没有可执行 Whisper 的 CPU/CUDA/ROCm 设备。"
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
    from .contracts import _valid_base_url
    connection = next((item for item in connections if item["adapter"] == "openai"), None)
    if connection is None:
        return [], "Provider connection is not configured."
    try:
        _valid_base_url(str(connection.get("base_url", "")))
    except ValueError:
        return [], "Provider base URL is invalid."
    if not connection.get("has_api_key", False):
        return [], "Provider API key is not configured."
    # These are configured candidates, not a discovery/health response from the
    # provider. No client is constructed and no remote request is made here.
    configured = os.getenv("YOUDUB_TRANSLATION_MODELS", "gpt-4.1-mini")
    candidates = [name.strip() for name in configured.split(",") if name.strip()]
    model = connection.get("model")
    if model and model.strip():
        candidates.insert(0, model.strip())
    elif translation_model and translation_model.strip():
        # Compatibility for direct callers predating connection.model.
        candidates.append(translation_model.strip())
    from .translate import MAX_TEXT_CHARS
    models = [_model(name, ["remote"], list(LANGUAGES), list(LANGUAGES), max_text_chars=MAX_TEXT_CHARS)
              for name in dict.fromkeys(candidates)]
    return models, None if models else "未配置翻译模型；请设置 YOUDUB_TRANSLATION_MODELS。"


def _voxcpm_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    missing = missing_modules(["base", "media", "voxcpm"])
    if missing:
        return [], f"本地 VoxCPM2 缺少运行依赖：{', '.join(missing)}。"
    # Check installed distribution metadata, never import VoxCPM during a GET.
    if not version_supported("voxcpm"):
        return [], f"本地 VoxCPM2 需要 voxcpm{version_requirement('voxcpm')}，以支持明确的 CPU/CUDA/ROCm/MPS 设备选择。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    from .tts import MAX_REFERENCE_DURATION_MS, available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 VoxCPM2 的 CPU/CUDA/ROCm/MPS 设备。"
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
    missing = missing_modules(["media", "demucs"])
    if missing:
        return [], f"本地 Demucs 缺少运行依赖：{', '.join(missing)}。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    from .separate import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 Demucs 的 CPU/CUDA/ROCm/MPS 设备。"
    models = [_model(name, available_devices.copy(), [], [],
                     max_audio_duration_ms=RUNTIME_LIMITS["max_video_duration_ms"])
              for name in available_models()]
    return models, None if models else "未找到非空的本地 htdemucs 权重。"


def _subtitle_alignment_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    missing = missing_modules(["base", "media", "qwen_forced_aligner"])
    if missing:
        return [], f"本地 Qwen 字幕对齐缺少运行依赖：{', '.join(missing)}。"
    if not version_supported("transformers"):
        return [], f"本地 Qwen 字幕对齐需要 transformers{version_requirement('transformers')}。"
    from .forced_alignment import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 Qwen 字幕对齐的 CPU/CUDA/ROCm/MPS 设备。"
    models = [_model(name, available_devices.copy(), [], ["en", "zh"], max_audio_duration_ms=300_000)
              for name in available_models()]
    return models, None if models else "本地 Qwen3-ForcedAligner-0.6B-hf 权重或 tokenizer 资产不完整。"


def runtime_info() -> dict[str, Any]:
    """Environment metadata without probing model assets or credentials."""
    limits = deepcopy(RUNTIME_LIMITS)
    limits["max_file_bytes"] = int(os.getenv("LOCAL_UPLOAD_MAX_BYTES", str(limits["max_file_bytes"])))
    if limits["max_file_bytes"] <= 0:
        raise ValueError("LOCAL_UPLOAD_MAX_BYTES must be a positive integer.")
    system = platform.system()
    platforms = {"Darwin": "macos", "Windows": "windows", "Linux": "linux"}
    if system not in platforms:
        raise RuntimeError(f"Unsupported operating system: {system}")
    return {"instance_id": INSTANCE_ID, "platform": platforms[system], "arch": platform.machine(),
            "devices": _detect_devices(), "limits": limits}


def probe_capability(adapter: str, *, connections: Sequence[Mapping[str, Any]] = (),
                     translation_model: str | None = None) -> dict[str, Any]:
    """Inspect exactly one installed provider; no inference or network access."""
    probes = {"whisper": ("asr", _whisper_models), "voxcpm": ("tts", _voxcpm_models),
              "demucs": ("separation", _demucs_models),
              "qwen_forced_aligner": ("subtitle_alignment", _subtitle_alignment_models)}
    remote = adapter == "openai"
    if remote:
        kind = "translation"
        models, reason = _translation_models(connections, translation_model)
    else:
        if adapter not in probes:
            raise ValueError(f"Unknown Python provider: {adapter}")
        kind, probe = probes[adapter]
        models, reason = probe(_detect_devices())
    return {"adapter": adapter, "capability": kind, "execution": "remote" if remote else "local",
            "available": bool(models), "unavailable_reason": reason, "requires_api_key": remote,
            "models": models, "data_sent": ["text"] if remote else [],
            "remote_operations": {"submit_mode": "sync", "can_poll": False, "can_cancel": False,
                                  "can_lookup_request_key": False} if remote else None}

"""Model metadata and cached, model-free accelerator probes for local providers."""
from __future__ import annotations

import importlib.metadata
import importlib.util
import os
import shutil
from copy import deepcopy
from importlib.machinery import PathFinder
from pathlib import Path
from typing import Any

from ..config import ffmpeg_binary, ffprobe_binary
from ..accelerators import detect_devices
from ..resources import missing_modules, version_supported, version_requirement
from .segments import LANGUAGES


def _detect_devices() -> list[dict[str, Any]]:
    return deepcopy(detect_devices())


def _model(
    model_id: str, devices: list[str], source_languages: list[str], target_languages: list[str],
) -> dict[str, Any]:
    return {
        "id": model_id, "devices": devices, "source_languages": source_languages,
        "target_languages": target_languages, "voice_modes": [], "voices": [],
    }


def _whisper_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    if importlib.util.find_spec("whisper") is None or importlib.util.find_spec("torch") is None:
        return [], "本地 Whisper 需要安装 openai-whisper 和 torch。"
    if importlib.util.find_spec("nltk") is None:
        return [], "Whisper 英文分句需要安装 nltk==3.10.3 和 punkt_tab 数据。"
    from nltk.data import find

    try:
        paths = [os.environ["NLTK_DATA"]] if os.getenv("YOUDUB_HARNESS_RUNTIME") == "1" else None
        punkt = Path(str(find("tokenizers/punkt_tab/english/", paths=paths)))
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
    ) for name in available_models()]
    return models, None if models else "未找到非空的本地 Whisper .pt 权重；请安装到 Whisper 模型目录。"


def _voxcpm_models(devices: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    missing = missing_modules(["base", "media", "voxcpm"])
    if missing:
        return [], f"本地 VoxCPM2 缺少运行依赖：{', '.join(missing)}。"
    # Check installed distribution metadata, never import VoxCPM during a GET.
    if not version_supported("voxcpm"):
        return [], f"本地 VoxCPM2 需要 voxcpm{version_requirement('voxcpm')}，以支持明确的 CPU/CUDA/ROCm/MPS 设备选择。"
    if shutil.which(ffmpeg_binary()) is None or shutil.which(ffprobe_binary()) is None:
        return [], "本地媒体处理需要可执行的 FFmpeg 和 FFprobe。"
    from .tts import available_models

    available_devices = [device["id"] for device in devices if device["available"]]
    if not available_devices:
        return [], "没有可执行 VoxCPM2 的 CPU/CUDA/ROCm/MPS 设备。"
    models = [_model(name, available_devices.copy(), list(LANGUAGES), list(LANGUAGES))
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
    models = [_model(name, available_devices.copy(), [], [])
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
    models = [_model(name, available_devices.copy(), [], ["en", "zh"])
              for name in available_models()]
    return models, None if models else "本地 Qwen3-ForcedAligner-0.6B-hf 权重或 tokenizer 资产不完整。"


def runtime_info() -> dict[str, Any]:
    """Environment metadata without probing model assets or credentials."""
    return {"devices": _detect_devices()}


def probe_capability(adapter: str) -> dict[str, Any]:
    """Inspect exactly one installed provider; no inference or network access."""
    probes = {"whisper": ("asr", _whisper_models), "voxcpm": ("tts", _voxcpm_models),
              "demucs": ("separation", _demucs_models),
              "qwen_forced_aligner": ("subtitle_alignment", _subtitle_alignment_models)}
    if adapter not in probes:
        raise ValueError(f"Unknown Python provider: {adapter}")
    kind, probe = probes[adapter]
    models, reason = probe(_detect_devices())
    return {"adapter": adapter, "capability": kind, "execution": "local",
            "available": bool(models), "unavailable_reason": reason, "models": models}

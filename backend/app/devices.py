from __future__ import annotations

import os
from dataclasses import dataclass

from .config import device as default_device


SUPPORTED_DEVICE_TYPES = {"cpu", "cuda", "mps"}
MANAGED_COMPONENTS = ("demucs", "whisper")
PLAN_COMPONENTS = (*MANAGED_COMPONENTS, "voxcpm")

CUDA_INSTALL_HINT = (
    "Install a CUDA-enabled PyTorch build before requirements.txt, for example: "
    "pip install -r requirements-pytorch-cu128.txt. Then verify with: "
    "python -c \"import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())\""
)


@dataclass(frozen=True)
class DeviceResolution:
    component: str
    configured: str
    selected: str
    setting_name: str
    managed: bool = True
    reason: str = ""


def _load_torch():
    import torch

    return torch


def _component_setting_name(component: str) -> str:
    return f"{component.strip().upper()}_DEVICE"


def _configured_device(component: str) -> tuple[str, str]:
    setting_name = _component_setting_name(component)
    override = os.getenv(setting_name, "").strip()
    if override:
        return override, setting_name
    return default_device().strip(), "DEVICE"


def _normalize(value: str, setting_name: str = "DEVICE") -> str:
    normalized = value.strip().lower()
    if normalized:
        return normalized
    raise RuntimeError(f"{setting_name} must not be empty.")


def device_type(value: str, setting_name: str = "DEVICE") -> str:
    normalized = _normalize(value, setting_name)
    if normalized == "auto":
        raise RuntimeError(f"{setting_name}=auto must be resolved before use.")

    parts = normalized.split(":", 1)
    kind = parts[0]
    if kind not in SUPPORTED_DEVICE_TYPES:
        raise RuntimeError(
            f"{setting_name}={value} is not a supported device. "
            "Use auto, cpu, cuda, cuda:<index>, mps, or mps:0."
        )

    if len(parts) == 2 and not parts[1].isdigit():
        raise RuntimeError(f"{setting_name}={value} is not a valid device name.")
    if kind == "mps" and len(parts) == 2 and parts[1] != "0":
        raise RuntimeError(f"{setting_name}={value} is configured, but only mps:0 is supported.")
    return kind


def _device_index(value: str) -> int | None:
    normalized = value.strip().lower()
    if ":" not in normalized:
        return None
    return int(normalized.split(":", 1)[1])


def _mps_backend(torch):
    return getattr(getattr(torch, "backends", None), "mps", None)


def _mps_is_available(torch) -> bool:
    mps = _mps_backend(torch)
    return bool(mps and mps.is_available())


def _auto_device() -> str:
    try:
        torch = _load_torch()
    except ImportError:
        return "cpu"

    if torch.cuda.is_available():
        return "cuda"
    if _mps_is_available(torch):
        return "mps"
    return "cpu"


def _resolve_configured_device(value: str, setting_name: str) -> str:
    normalized = _normalize(value, setting_name)
    if normalized == "auto":
        return _auto_device()
    device_type(normalized, setting_name)
    return normalized


def resolve_device(component: str) -> DeviceResolution:
    component_name = component.strip().lower()
    configured, setting_name = _configured_device(component_name)

    if component_name == "voxcpm":
        return DeviceResolution(
            component=component_name,
            configured=configured,
            selected="library-auto",
            setting_name=setting_name,
            managed=False,
            reason="VoxCPM currently selects cuda, mps, or cpu inside the upstream package.",
        )

    selected = _resolve_configured_device(configured, setting_name)
    selected_type = device_type(selected, setting_name)
    if component_name == "whisper" and selected_type == "mps":
        return DeviceResolution(
            component=component_name,
            configured=configured,
            selected="cpu",
            setting_name=setting_name,
            reason="Whisper word timestamps use float64 DTW, which is not supported by MPS.",
        )

    return DeviceResolution(
        component=component_name,
        configured=configured,
        selected=selected,
        setting_name=setting_name,
    )


def validate_device_available(selected_device: str, setting_name: str = "DEVICE") -> None:
    kind = device_type(selected_device, setting_name)
    if kind == "cpu":
        return

    try:
        torch = _load_torch()
    except ImportError as exc:
        raise RuntimeError(
            f"{setting_name}={selected_device} is configured, but PyTorch is not installed. "
            f"{CUDA_INSTALL_HINT}"
        ) from exc

    if kind == "cuda":
        if not torch.cuda.is_available():
            torch_version = getattr(torch, "__version__", "unknown")
            cuda_version = getattr(getattr(torch, "version", None), "cuda", None) or "None"
            raise RuntimeError(
                f"{setting_name}={selected_device} is configured, but CUDA is not available in the current "
                f"PyTorch runtime. torch={torch_version}, torch.version.cuda={cuda_version}. "
                f"{CUDA_INSTALL_HINT}"
            )

        requested_index = _device_index(selected_device)
        if requested_index is not None and requested_index >= torch.cuda.device_count():
            raise RuntimeError(
                f"{setting_name}={selected_device} is configured, but only {torch.cuda.device_count()} CUDA "
                "device(s) are visible to PyTorch."
            )
        return

    mps = _mps_backend(torch)
    if not mps or not mps.is_built():
        raise RuntimeError(
            f"{setting_name}={selected_device} is configured, but PyTorch was not built with MPS support."
        )
    if not mps.is_available():
        raise RuntimeError(
            f"{setting_name}={selected_device} is configured, but MPS is not available on this machine."
        )

def device_plan() -> tuple[DeviceResolution, ...]:
    return tuple(resolve_device(component) for component in PLAN_COMPONENTS)


def device_plan_summary() -> str:
    parts = []
    for item in device_plan():
        text = f"{item.component}={item.selected}"
        if item.reason:
            text += f" ({item.reason})"
        parts.append(text)
    return ", ".join(parts)

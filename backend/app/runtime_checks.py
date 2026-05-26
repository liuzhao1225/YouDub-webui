from __future__ import annotations

from .config import device


CUDA_INSTALL_HINT = (
    "Install a CUDA-enabled PyTorch build before requirements.txt, for example: "
    "pip install -r requirements-pytorch-cu128.txt. Then verify with: "
    "python -c \"import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())\""
)


def _wants_cuda(selected_device: str) -> bool:
    normalized = selected_device.strip().lower()
    return normalized == "cuda" or normalized.startswith("cuda:")


def _cuda_device_index(selected_device: str) -> int | None:
    normalized = selected_device.strip().lower()
    if not normalized.startswith("cuda:"):
        return None
    suffix = normalized.split(":", 1)[1]
    if not suffix.isdigit():
        raise RuntimeError(f"DEVICE={selected_device} is not a valid CUDA device name.")
    return int(suffix)


def _load_torch():
    import torch

    return torch


def validate_runtime_device() -> None:
    selected_device = device().strip()
    if not _wants_cuda(selected_device):
        return

    requested_index = _cuda_device_index(selected_device)
    try:
        torch = _load_torch()
    except ImportError as exc:
        raise RuntimeError(
            f"DEVICE={selected_device} is configured, but PyTorch is not installed. "
            f"{CUDA_INSTALL_HINT}"
        ) from exc

    if not torch.cuda.is_available():
        torch_version = getattr(torch, "__version__", "unknown")
        cuda_version = getattr(getattr(torch, "version", None), "cuda", None) or "None"
        raise RuntimeError(
            f"DEVICE={selected_device} is configured, but CUDA is not available in the current "
            f"PyTorch runtime. torch={torch_version}, torch.version.cuda={cuda_version}. "
            f"{CUDA_INSTALL_HINT}"
        )

    if requested_index is not None and requested_index >= torch.cuda.device_count():
        raise RuntimeError(
            f"DEVICE={selected_device} is configured, but only {torch.cuda.device_count()} CUDA "
            "device(s) are visible to PyTorch."
        )

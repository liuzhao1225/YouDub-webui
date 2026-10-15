"""Host hardware, compatible wheels, and executable Torch devices.

Hardware discovery is stdlib-only so it also works before Torch is installed.
CUDA/ROCm share Torch's cuda device namespace; availability requires real work.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import os
import platform
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path


def _command(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=15, check=True,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def hardware() -> dict:
    system = platform.system()
    result = {"system": system, "arch": platform.machine().lower(), "gpus": []}
    smi = shutil.which("nvidia-smi")
    if not smi and system == "Windows":
        candidate = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32" / "nvidia-smi.exe"
        if candidate.is_file():
            smi = str(candidate)
    if smi:
        output = _command([smi, "--query-gpu=name,driver_version,compute_cap", "--format=csv,noheader,nounits"])
        for row in csv.reader(output.splitlines()):
            if len(row) == 3:
                result["gpus"].append({"vendor": "nvidia", "name": row[0].strip(), "driver": row[1].strip(), "capability": row[2].strip()})
    if system == "Windows":
        result["build"] = int(platform.version().split(".")[-1])
        shell = str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")
        output = _command([shell, "-NoProfile", "-NonInteractive", "-Command",
                           "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility | ConvertTo-Json -Compress"])
        if output:
            entries = json.loads(output)
            for item in entries if isinstance(entries, list) else [entries]:
                name = item.get("Name", "")
                if any(vendor in (name + str(item.get("AdapterCompatibility", ""))).upper() for vendor in ("AMD", "ADVANCED MICRO DEVICES")):
                    result["gpus"].append({"vendor": "amd", "name": name})
    elif system == "Linux":
        for vendor in Path("/sys/class/drm").glob("card*/device/vendor"):
            if vendor.read_text().strip() == "0x1002":
                result["gpus"].append({"vendor": "amd", "name": "AMD Radeon"})
        version = Path("/opt/rocm/.info/version")
        result["rocm"] = version.read_text().strip() if version.is_file() else ""
    elif system == "Darwin" and result["arch"] in {"arm64", "aarch64"}:
        result["gpus"].append({"vendor": "apple", "name": "Apple Silicon"})
    return result


def installation_plan(host: dict) -> dict:
    """Pinned Torch/Audio/Codec ABI sets, never install or change OS drivers."""
    system = host["system"]
    plan = {"backend": "cpu", "index": "https://download.pytorch.org/whl/cpu", "version": "2.8.0",
            "codec": "0.7.0", "prerequisites": [], "packages": [], "detail": "CPU：未发现受支持的 GPU 运行环境"}
    if system == "Darwin":
        plan["index"] = "https://mirrors.aliyun.com/pypi/simple/"
        plan["backend"] = "mps" if host["arch"] in {"arm64", "aarch64"} else "cpu"
        plan["detail"] = "Apple MPS：安装后检查实际运算能力" if plan["backend"] == "mps" else "Intel Mac 需要自行提供支持 Torch >= 2.5 的 Python 环境"
        return plan
    nvidia = [gpu for gpu in host["gpus"] if gpu["vendor"] == "nvidia"]
    for gpu in nvidia:
        try:
            capability = float(gpu["capability"])
            driver = tuple(int(part) for part in gpu["driver"].split("."))
        except (KeyError, ValueError):
            continue
        modern = capability >= 10
        minimum = (570, 65) if system == "Windows" and modern else (570, 26) if modern else (527, 41) if system == "Windows" else (525, 60)
        if capability >= 5 and driver >= minimum:
            variant = "cu128" if modern else "cu126"
            plan.update(backend="cuda", index=f"https://download.pytorch.org/whl/{variant}",
                        detail=f"{gpu['name']} · CUDA {variant[2:4]}.{variant[4:]} · 驱动 {gpu['driver']}；安装后验证运算")
            return plan
    if nvidia:
        plan["detail"] = "已发现 NVIDIA GPU，但架构或驱动不满足兼容 CUDA 包要求；使用 CPU"
    amd = [gpu for gpu in host["gpus"] if gpu["vendor"] == "amd"]
    if amd and system == "Linux" and host.get("rocm", "").startswith("6.4"):
        plan.update(backend="rocm", index="https://download.pytorch.org/whl/rocm6.4", detail="AMD ROCm 6.4：安装后验证 GPU 运算")
    elif amd and system == "Windows":
        supported = {"AMD Radeon RX 9070 XT", "AMD Radeon RX 9070", "AMD Radeon RX 9060 XT", "AMD Radeon RX 7900 XTX",
                     "AMD Radeon RX 7700", "AMD Radeon PRO W7900", "AMD Radeon PRO W7900 Dual Slot", "AMD Radeon AI PRO R9700"}
        if host.get("build", 0) >= 22000 and any(gpu["name"] in supported for gpu in amd):
            base = "https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/"
            plan.update(backend="rocm", version="2.9.1", codec="0.8.1", index="https://mirrors.aliyun.com/pypi/simple/",
                        detail="AMD ROCm 7.2.1（需要 AMD 26.2.2 驱动）；安装后验证 GPU 运算",
                        prerequisites=[base + f"{name}-7.2.1-py3-none-win_amd64.whl" for name in ("rocm_sdk_core", "rocm_sdk_devel", "rocm_sdk_libraries_custom")] + [base + "rocm-7.2.1.tar.gz"],
                        packages=[base + f"{name}-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl" for name in ("torch", "torchaudio")])
        else:
            plan["detail"] = "已发现 AMD GPU；官方 Windows ROCm 需要 Windows 11 和受支持的 Radeon 型号，当前使用 CPU"
    elif amd:
        plan["detail"] = "已发现 AMD GPU，但未发现兼容的 ROCm 6.4；当前使用 CPU"
    return plan


def _exercise(torch, device: str) -> None:
    value = torch.ones((16, 16), device=device)
    if (value @ value).sum().item() != 4096:
        raise RuntimeError("GPU 运算结果不正确")


def torch_devices(torch) -> list[dict]:
    devices = []
    hip = getattr(getattr(torch, "version", None), "hip", None)
    if torch.cuda.is_available():
        for index in range(torch.cuda.device_count()):
            device = f"cuda:{index}"
            reason = None
            try:
                _exercise(torch, device)
            except Exception as exc:
                reason = f"GPU 运算检查失败：{type(exc).__name__}: {exc}"
            devices.append({"id": device, "name": torch.cuda.get_device_name(index), "backend": "rocm" if hip else "cuda",
                            "available": reason is None, "unavailable_reason": reason})
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    if mps is not None and mps.is_built():
        reason = "Apple MPS 在此系统不可用"
        if mps.is_available():
            try:
                _exercise(torch, "mps")
                reason = None
            except Exception as exc:
                reason = f"MPS 运算检查失败：{type(exc).__name__}: {exc}"
        devices.append({"id": "mps", "name": "Apple MPS", "backend": "mps", "available": reason is None, "unavailable_reason": reason})
    devices.append({"id": "cpu", "name": "CPU", "backend": "cpu", "available": True, "unavailable_reason": None})
    return devices


@lru_cache(maxsize=1)
def detect_devices() -> list[dict]:
    if importlib.util.find_spec("torch") is None:
        return [{"id": "cpu", "name": "CPU", "backend": "cpu", "available": True, "unavailable_reason": None}]
    import torch  # A broken installed Torch must surface its import error.
    return torch_devices(torch)


def accelerator_status() -> dict:
    devices = detect_devices()
    selected = next(device for device in devices if device["available"])
    detail = f"{selected['name']} · {selected['backend'].upper()}（运算检查通过）" if selected['backend'] != 'cpu' else "CPU：未启用 GPU 加速"
    failures = [device["unavailable_reason"] for device in devices if not device["available"]]
    if failures:
        detail += "；" + "；".join(failures)
    return {"devices": devices, "backend": selected["backend"], "detail": detail}

"""First-start checks. Missing packages are pending; broken installed packages fail."""
from __future__ import annotations
import importlib
import importlib.metadata
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys

from backend.app.resources import GROUPS, distributions, missing_dependencies


def verify(groups):
    """Import only the selected providers. Model checks are handled separately."""
    missing = missing_dependencies(groups)
    if missing:
        raise RuntimeError(f"Missing dependencies: {', '.join(missing)}")
    selected = distributions(groups)
    if "torchcodec" in selected:
        from packaging.version import Version
        # VoxCPM uses torchaudio.load; that API requires TorchCodec since 2.9.
        # TorchAudio 2.8 uses SoundFile, and our aligner receives decoded arrays.
        # Do not require FFmpeg shared libraries for those execution paths.
        if "voxcpm" not in groups or Version(importlib.metadata.version("torchaudio")) < Version("2.9"):
            selected.pop("torchcodec")
    if "torchcodec" in selected:
        from backend.app.config import configure_windows_ffmpeg_dll_directory
        configure_windows_ffmpeg_dll_directory()
    for module in selected:
        importlib.import_module(module)
    return {"ready": True}


def resources(groups):
    from pathlib import Path
    result = {"missing": missing_dependencies(groups), "media": True, "punkt": True, "demucsSource": True}
    if "media" in groups:
        result["mediaReason"] = media_error()
        result["media"] = result["mediaReason"] is None
    if "whisper" in groups or "punkt" in groups:
        result["punkt"] = False
        if importlib.util.find_spec("nltk") is not None:
            result["punkt"] = punkt()["ready"]
    if "demucs" in groups:
        result["demucsSource"] = (Path(__file__).resolve().parents[2] / "submodule/demucs/demucs/__init__.py").is_file()
    return result


def media_error():
    """Match the installer capability checks without downloading anything."""
    from pathlib import Path
    from backend.app.config import ffmpeg_binary, ffprobe_binary
    for name, command in (("ffmpeg", ffmpeg_binary()), ("ffprobe", ffprobe_binary())):
        path = shutil.which(command)
        if not path:
            return f"缺少可执行的 {name}：{command}"
        args = [path, "-hide_banner", "-filters"] if name == "ffmpeg" else [path, "-version"]
        try:
            result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                    timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except (OSError, subprocess.TimeoutExpired) as error:
            return f"{command}: {type(error).__name__}: {error}"
        if result.returncode != 0:
            return f"{command} exited ({result.returncode}).\n{result.stderr}"
        if name == "ffmpeg" and not re.search(r"\bsubtitles\b", result.stdout):
            return f"FFmpeg 缺少 subtitles 滤镜：{path}"
        if os.name == "nt" and not any(Path(path).parent.glob("av*.dll")):
            return f"{name} 缺少共享 av*.dll：{path}"
    return None


def punkt():
    from nltk.data import find
    from pathlib import Path
    try:
        paths = [os.environ["NLTK_DATA"]] if os.getenv("YOUDUB_HARNESS_RUNTIME") == "1" else None
        directory = Path(str(find("tokenizers/punkt_tab/english/", paths=paths)))
    except LookupError:
        return {"ready": False}
    return {"ready": all((directory / name).is_file() and (directory / name).stat().st_size > 0
                        for name in ("collocations.tab", "sent_starters.txt", "abbrev_types.txt", "ortho_context.tab"))}


def main():
    action = sys.argv[1]
    groups = json.loads(sys.argv[2]) if len(sys.argv) > 2 else ["base"]
    if action == "acceleration-plan":
        from backend.app.accelerators import hardware, installation_plan
        plan = installation_plan(hardware())
        suffix = "+" + plan["variant"] if plan["variant"] else ""
        expected = plan["version"] + suffix
        try:
            plan["installed"] = all(importlib.metadata.version(name) == expected or
                                    (not suffix and importlib.metadata.version(name) == expected + "+cpu")
                                    for name in ("torch", "torchaudio"))
        except importlib.metadata.PackageNotFoundError:
            plan["installed"] = False
        if not plan["installed"] and importlib.util.find_spec('torch') is not None:
            # Keep a working custom CUDA/ROCm/MPS stack, including ROCm versions
            # outside our first-install matrix. Never turn a working GPU into CPU.
            from backend.app.accelerators import accelerator_status
            status = accelerator_status()
            if status['backend'] != 'cpu':
                try:
                    version = importlib.metadata.version('torch')
                    audio = importlib.metadata.version('torchaudio')
                    codec = importlib.metadata.version('torchcodec')
                    if tuple(map(int, version.split('+')[0].split('.')[:2])) >= (2, 5) and version == audio:
                        plan.update(installed=True, version=version, codec=codec,
                                    backend=status['backend'], detail=status['detail'])
                except importlib.metadata.PackageNotFoundError:
                    pass
        print(json.dumps(plan))
    elif action == "acceleration":
        from backend.app.accelerators import accelerator_status
        print(json.dumps(accelerator_status()))
    elif action == "dependencies":
        print(json.dumps({"missing": missing_dependencies(groups)}))
    elif action == "punkt":
        print(json.dumps(punkt()))
    elif action == "resources":
        print(json.dumps(resources(groups)))
    elif action == "models":
        from backend.app.v1.runtime import probe_capability
        print(json.dumps({provider: probe_capability(provider) for provider in groups}, ensure_ascii=False))
    elif action == "verify":
        print(json.dumps(verify(groups)))
    else:
        raise ValueError(f"Unknown setup check: {action}")

if __name__ == "__main__":
    main()

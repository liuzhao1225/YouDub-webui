"""First-start checks. Missing packages are pending; broken installed packages fail."""
from __future__ import annotations
import importlib.metadata
import importlib.util
import json
import sys

DISTRIBUTIONS = {
    "dotenv": "python-dotenv", "pydantic": "pydantic", "keyring": "keyring", "openai": "openai",
    "torch": "torch", "torchaudio": "torchaudio", "torchcodec": "torchcodec", "whisper": "openai-whisper", "nltk": "nltk",
    "voxcpm": "voxcpm", "transformers": "transformers", "soundfile": "soundfile", "librosa": "librosa",
    "numpy": "numpy", "julius": "julius", "dora": "dora-search", "omegaconf": "omegaconf",
    "einops": "einops", "openunmix": "openunmix", "tqdm": "tqdm", "yt_dlp": "yt-dlp", "packaging": "packaging",
}

def main():
    action = sys.argv[1]
    if action == "acceleration-plan":
        from backend.app.accelerators import hardware, installation_plan
        plan = installation_plan(hardware())
        suffix = "+" + plan["index"].rsplit("/", 1)[-1] if plan["backend"] in {"cuda", "rocm"} else ""
        if plan["packages"]:
            suffix = "+rocm7.2.1"
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
        missing = [dist for module, dist in DISTRIBUTIONS.items() if importlib.util.find_spec(module) is None]
        if not missing:
            from packaging.version import Version
            codec_version = {"2.8": "0.7.0", "2.9": "0.8.1"}.get('.'.join(importlib.metadata.version('torch').split('.')[:2]))
            checks = {"voxcpm": lambda v: v >= Version("2.0.3"), "transformers": lambda v: Version("5.17") <= v < Version("6"), "nltk": lambda v: v == Version("3.10.3"), "torchcodec": lambda v: codec_version is None or v == Version(codec_version)}
            missing = [dist for dist, valid in checks.items() if not valid(Version(importlib.metadata.version(dist)))]
        print(json.dumps({"missing": missing}))
    elif action == "punkt":
        from nltk.data import find
        from pathlib import Path
        try:
            directory = Path(str(find("tokenizers/punkt_tab/english/")))
        except LookupError:
            print(json.dumps({"ready": False})); return
        print(json.dumps({"ready": all((directory / name).is_file() and (directory / name).stat().st_size > 0 for name in ("collocations.tab", "sent_starters.txt", "abbrev_types.txt", "ortho_context.tab"))}))
    elif action == "verify":
        # Exercise imports needed by inference, as well as metadata-only model probes.
        import torch, torchaudio, whisper, voxcpm, transformers, soundfile, librosa
        from backend.app.v1.runtime import probe_capability
        result = {adapter: probe_capability(adapter) for adapter in ("whisper", "voxcpm", "demucs", "qwen_forced_aligner")}
        unavailable = {key: item["unavailable_reason"] for key, item in result.items() if not item["available"]}
        if unavailable:
            raise RuntimeError(json.dumps(unavailable, ensure_ascii=False))
        print(json.dumps({"ready": True}))
    else:
        raise ValueError(f"Unknown setup check: {action}")

if __name__ == "__main__":
    main()

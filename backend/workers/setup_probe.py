"""First-start checks. Missing packages are pending; broken installed packages fail."""
from __future__ import annotations
import importlib.metadata
import importlib.util
import json
import sys

DISTRIBUTIONS = {
    "dotenv": "python-dotenv", "pydantic": "pydantic", "keyring": "keyring", "openai": "openai",
    "torch": "torch", "torchaudio": "torchaudio", "whisper": "openai-whisper", "nltk": "nltk",
    "voxcpm": "voxcpm", "transformers": "transformers", "soundfile": "soundfile", "librosa": "librosa",
    "numpy": "numpy", "julius": "julius", "dora": "dora-search", "omegaconf": "omegaconf",
    "einops": "einops", "openunmix": "openunmix", "tqdm": "tqdm", "yt_dlp": "yt-dlp", "packaging": "packaging",
}

def main():
    action = sys.argv[1]
    if action == "dependencies":
        missing = [dist for module, dist in DISTRIBUTIONS.items() if importlib.util.find_spec(module) is None]
        if not missing:
            from packaging.version import Version
            checks = {"voxcpm": lambda v: v >= Version("2.0.3"), "transformers": lambda v: Version("5.17") <= v < Version("6"), "nltk": lambda v: v == Version("3.10.3")}
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

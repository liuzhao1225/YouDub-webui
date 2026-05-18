from __future__ import annotations

import sys
from pathlib import Path

from ..config import REPO_ROOT, device, disable_torchcodec
from ..utils.video import save_audio_tensor


def _device() -> str:
    value = device()
    if value != "auto":
        return value
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def separate_audio(video_file: Path, session: Path) -> tuple[Path, Path]:
    demucs_path = REPO_ROOT / "submodule" / "demucs"
    if not demucs_path.exists():
        raise RuntimeError("Demucs submodule is missing. Run: git submodule update --init --recursive")
    sys.path.insert(0, str(demucs_path))
    disable_torchcodec()

    from demucs.api import Separator

    media_dir = session / "media"
    vocals_file = media_dir / "audio_vocals.wav"
    bgm_file = media_dir / "audio_bgm.wav"
    if vocals_file.exists() and bgm_file.exists():
        return vocals_file, bgm_file

    separator = Separator(model="htdemucs_ft", device=_device(), progress=True, shifts=3)
    _, separated = separator.separate_audio_file(str(video_file))

    vocals = separated["vocals"]
    bgm = None
    for stem, source in separated.items():
        if stem == "vocals":
            continue
        bgm = source if bgm is None else bgm + source

    save_audio_tensor(vocals_file, vocals, separator.samplerate)
    save_audio_tensor(bgm_file, bgm, separator.samplerate)
    return vocals_file, bgm_file

from __future__ import annotations

import sys
from pathlib import Path

from ..config import REPO_ROOT
from ..devices import resolve_device


def _device() -> str:
    return resolve_device("demucs").selected


def separate_audio(video_file: Path, session: Path) -> tuple[Path, Path]:
    demucs_path = _demucs_source_path()
    sys.path.insert(0, str(demucs_path))

    from demucs.api import Separator, save_audio

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

    save_audio(vocals, str(vocals_file), samplerate=separator.samplerate)
    save_audio(bgm, str(bgm_file), samplerate=separator.samplerate)
    return vocals_file, bgm_file


def _demucs_source_path() -> Path:
    demucs_path = REPO_ROOT / "submodule" / "demucs"
    api_file = demucs_path / "demucs" / "api.py"
    if api_file.exists():
        return demucs_path
    raise RuntimeError(
        "Demucs source submodule is missing or incomplete. "
        "Clone this repository with git and run: git submodule update --init --recursive. "
        "Do not use GitHub Download ZIP because it does not include submodules."
    )

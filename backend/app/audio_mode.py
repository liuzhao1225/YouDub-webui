from __future__ import annotations

from typing import Literal


AudioMode = Literal["tts", "original"]


def target_text(item: dict) -> object:
    return item.get("dst") or item.get("zh", "")


def audio_mode(item: dict) -> AudioMode:
    mode = item.get("audio_mode")
    if mode is not None:
        if mode not in {"tts", "original"}:
            raise ValueError("audio_mode must be one of: tts, original")
        return mode

    text = target_text(item)
    return "original" if isinstance(text, str) and not text.strip() else "tts"


def is_original_audio(item: dict) -> bool:
    return audio_mode(item) == "original"

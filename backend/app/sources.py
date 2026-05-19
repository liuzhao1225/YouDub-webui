from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import COOKIE_DIR
from .youtube import is_bilibili_url, is_local_en_to_zh_url, is_local_zh_to_en_url, is_youtube_url


LANG_NAMES = {"en": "English", "zh": "Simplified Chinese"}


@dataclass(frozen=True)
class SourceConfig:
    name: str
    matches: Callable[[str], bool]
    use_proxy: bool
    cookie_filename: str | None
    asr_language: str
    target_language: str

    @property
    def cookie_path(self) -> Path | None:
        if not self.cookie_filename:
            return None
        return COOKIE_DIR / self.cookie_filename

    @property
    def asr_language_name(self) -> str:
        return LANG_NAMES[self.asr_language]

    @property
    def target_language_name(self) -> str:
        return LANG_NAMES[self.target_language]


SOURCES: list[SourceConfig] = [
    SourceConfig(
        name="youtube",
        matches=is_youtube_url,
        use_proxy=True,
        cookie_filename="youtube.txt",
        asr_language="en",
        target_language="zh",
    ),
    SourceConfig(
        name="local",
        matches=is_local_en_to_zh_url,
        use_proxy=False,
        cookie_filename=None,
        asr_language="en",
        target_language="zh",
    ),
    SourceConfig(
        name="local",
        matches=is_local_zh_to_en_url,
        use_proxy=False,
        cookie_filename=None,
        asr_language="zh",
        target_language="en",
    ),
    SourceConfig(
        name="bilibili",
        matches=is_bilibili_url,
        use_proxy=False,
        cookie_filename="bilibili.txt",
        asr_language="zh",
        target_language="en",
    ),
]


def detect_source(url: str) -> SourceConfig:
    for source in SOURCES:
        if source.matches(url):
            return source
    raise ValueError(f"No source matches URL: {url}")

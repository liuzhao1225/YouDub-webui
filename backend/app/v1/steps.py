"""Cancellation and input context for one local media operation."""

from __future__ import annotations

from dataclasses import dataclass, field
from collections.abc import Callable
from pathlib import Path
from typing import Any


def _no_cancel() -> None:
    pass


@dataclass(frozen=True)
class StageContext:
    stage: str
    config: Any
    input_files: dict[str, Path]
    work_dir: Path
    check_cancel: Callable[[], None] = field(default=_no_cancel, repr=False, compare=False)


@dataclass(frozen=True)
class Completed:
    output_files: dict[str, Path]

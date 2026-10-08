"""Cancellation and input context for one local media operation."""

from __future__ import annotations

from dataclasses import dataclass, field
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal


class StageCancelled(Exception):
    """The current local step must stop before another Task can run."""


def _no_cancel() -> None:
    pass


def _no_external_state(state: str) -> None:
    pass


@dataclass(frozen=True)
class StageContext:
    task_id: str
    attempt: int
    stage: str
    config: Any
    input_files: dict[str, Path]
    work_dir: Path
    connections: dict[str, dict] = field(default_factory=dict, repr=False)
    check_cancel: Callable[[], None] = field(default=_no_cancel, repr=False, compare=False)
    set_external_state: Callable[[str], None] = field(default=_no_external_state, repr=False, compare=False)


@dataclass(frozen=True)
class Completed:
    output_files: dict[str, Path]
    state: Literal["completed"] = field(default="completed", init=False)

"""The boundary between task management and one media pipeline step."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .contracts import Stage, TaskConfig


@dataclass(frozen=True)
class StageContext:
    task_id: str
    attempt: int
    stage: Stage
    config: TaskConfig
    input_files: dict[str, Path]
    work_dir: Path
    remote_task_id: str | None = None
    connections: dict[str, dict] = field(default_factory=dict, repr=False)


@dataclass(frozen=True)
class Completed:
    output_files: dict[str, Path]
    state: Literal["completed"] = field(default="completed", init=False)


@dataclass(frozen=True)
class Waiting:
    remote_task_id: str
    next_poll_at: str
    state: Literal["waiting"] = field(default="waiting", init=False)


StepResult = Completed | Waiting

"""Save one multipart upload before creating its Task."""

from __future__ import annotations

import threading
from pathlib import Path

from fastapi import UploadFile
from pydantic import TypeAdapter, ValidationError

from .. import runtime_security
from . import runtime, tasks
from .contracts import TaskConfig, TaskId
from .errors import ApiError
from .storage import Store

_lock = threading.Lock()
_inflight: set[tuple[Path, str]] = set()
_task_id = TypeAdapter(TaskId)


def parse_config(part: str | UploadFile) -> TaskConfig:
    if isinstance(part, str):
        raw = part
    else:
        if part.content_type != "application/json":
            raise ApiError(422, "INVALID_CONFIG", "The config part must contain JSON.", field="config")
        raw = part.file.read(65_537)
    if len(raw) > 65_536:
        raise ApiError(422, "INVALID_CONFIG", "The config part is too large.", field="config")
    try:
        return TaskConfig.model_validate_json(raw)
    except ValidationError as exc:
        raise ApiError(422, "INVALID_CONFIG", "Invalid task configuration.", field="config") from exc


def import_video(store: Store, task_id: str, file: UploadFile, config: TaskConfig, snapshot: dict) -> dict:
    try:
        _task_id.validate_python(task_id)
    except ValidationError as exc:
        raise ApiError(422, "INVALID_CONFIG", "A canonical UUID is required.", field="id") from exc
    key = (store.path, task_id)
    root = store.root / "tasks" / task_id
    with _lock:
        if tasks.get_record(store, task_id) is not None:
            raise ApiError(409, "TASK_EXISTS", "A task with this ID already exists.", field="id", action="none")
        if key in _inflight:
            raise ApiError(409, "IMPORT_IN_PROGRESS", "An upload with this ID is still in progress.", field="id", action="none")
        if root.exists():
            raise ApiError(409, "IMPORT_RESIDUE", "An earlier upload left files under this ID. Delete the residual import before retrying.", field="id", action="none")
        _inflight.add(key)
    try:
        name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not name or any(ord(char) < 32 for char in name):
            raise ApiError(422, "INVALID_CONFIG", "A video filename is required.", field="file")
        suffix = Path(name).suffix.lower()
        if suffix not in snapshot["limits"]["video_suffixes"]:
            raise ApiError(415, "UNSUPPORTED_MEDIA", "Unsupported video filename extension.", field="file")
        try:
            runtime.validate_config_capabilities(config.model_dump(mode="json"), snapshot, connections=store.read_settings()["connections"])
        except runtime.CapabilityError as exc:
            raise ApiError(422, exc.code, str(exc), field=f"config.{exc.field}") from exc

        runtime_security.ensure_private_directory(root.parent)
        root.mkdir(mode=0o700)
        input_dir = runtime_security.ensure_private_directory(root / "input")
        destination = input_dir / f"source{suffix}"
        size = 0
        with runtime_security.open_private_binary_exclusive(destination) as handle:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > snapshot["limits"]["max_file_bytes"]:
                    raise ApiError(413, "FILE_TOO_LARGE", "The video exceeds the configured size limit.", field="file")
                handle.write(chunk)
        if size == 0:
            raise ApiError(422, "INVALID_MEDIA", "The uploaded video is empty.", field="file")
        return tasks.create_task(store, task_id=task_id, source_name=name, source_size_bytes=size,
                                 input_path=destination, config=config, runtime=snapshot)
    finally:
        with _lock:
            _inflight.remove(key)

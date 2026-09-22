from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from . import runtime as runtime_catalog
from .contracts import Runtime, Settings, SettingsPatch, Task, TaskId, TaskList, TaskStatus
from .errors import ApiError
from . import executor, files, imports, tasks
from .storage import Store, data_directory

router = APIRouter(prefix="/api/v1")


@lru_cache(maxsize=1)
def _store_at(root: Path) -> Store:
    return Store(root)


def get_store() -> Store:
    return _store_at(data_directory())


def runtime_snapshot(settings: dict) -> dict:
    defaults = settings["defaults"]
    model = defaults["translation"]["model"] if defaults else None
    return runtime_catalog.build_runtime(connections=settings["connections"], translation_model=model)


@router.get("/runtime", response_model=Runtime)
def get_runtime(store: Store = Depends(get_store)) -> dict:
    return runtime_snapshot(store.read_settings())


@router.get("/settings", response_model=Settings)
def get_settings(store: Store = Depends(get_store)) -> dict:
    return store.read_settings()


@router.patch("/settings", response_model=Settings)
def patch_settings(patch: SettingsPatch, store: Store = Depends(get_store)) -> dict:
    current = store.read_settings()
    runtime = runtime_snapshot(current)
    if "defaults" in patch.model_fields_set:
        try:
            runtime_catalog.validate_config_capabilities(
                patch.defaults.model_dump(mode="json"), runtime,
                connections=current["connections"],
            )
        except runtime_catalog.CapabilityError as exc:
            raise ApiError(422, exc.code, str(exc), field=exc.field) from exc
    elif "connection" in patch.model_fields_set:
        registered = {item["adapter"] for item in runtime["capabilities"] if item["execution"] == "remote"}
        if patch.connection.adapter not in registered:
            raise ApiError(422, "INVALID_CONFIG", "Unknown remote adapter.", field="connection.adapter")
    return store.patch_settings(patch)


@router.post("/tasks", status_code=201, response_model=Task)
def create_task(
    task_id: TaskId = Form(alias="id"),
    file: UploadFile = File(...),
    config: UploadFile | str = File(...),
    store: Store = Depends(get_store),
) -> dict:
    from .. import worker

    task_config = imports.parse_config(config)
    snapshot = runtime_snapshot(store.read_settings())
    task = imports.import_video(store, task_id, file, task_config, snapshot)
    executor.append_log(store, task_id, "Task created and queued.")
    worker.enqueue(f"mvp-{task_id}")
    return task


@router.get("/tasks", response_model=TaskList)
def list_tasks(
    limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
    status: TaskStatus | None = None, active: bool | None = None,
    store: Store = Depends(get_store),
) -> dict:
    return tasks.list_tasks(store, limit=limit, offset=offset, status=status, active=active)


@router.get("/tasks/{task_id}", response_model=Task)
def get_task(task_id: TaskId, store: Store = Depends(get_store)) -> dict:
    return tasks.get_task(store, task_id)


@router.get("/tasks/{task_id}/files/{kind}")
@router.head("/tasks/{task_id}/files/{kind}")
def task_file(task_id: TaskId, kind: Literal["video", "audio", "source_subtitles", "translated_subtitles"],
              request: Request, download: bool = False, store: Store = Depends(get_store)):
    return files.output_response(store, task_id, kind, request, download)


@router.get("/tasks/{task_id}/log")
def task_log(task_id: TaskId, lines: int = Query(200, ge=1, le=1000), download: bool = False,
             store: Store = Depends(get_store)):
    return files.log_response(store, task_id, lines, download)

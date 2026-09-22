"""Serve only the completed artifacts registered on a Task."""

from __future__ import annotations

import json
import re
from collections import deque
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from . import imports, tasks
from .errors import ApiError, error_content
from .storage import Store


class TaskFileResponse(FileResponse):
    def __init__(self, *args, store: Store, task_id: str, supports_range: bool = False, **kwargs):
        super().__init__(*args, **kwargs)
        self.store, self.task_id = store, task_id
        self.supports_range = supports_range

    async def __call__(self, scope, receive, send):
        try:
            size = self.path.stat().st_size
            headers = []
            for key, value in scope["headers"]:
                if key.lower() == b"range":
                    if not self.supports_range:
                        continue
                    # A suffix longer than the file represents the whole file.
                    if value.startswith(b"bytes=-"):
                        value = f"bytes=-{min(int(value[7:]), size)}".encode()
                headers.append((key, value))
            await super().__call__({**scope, "headers": headers}, receive, send)
        finally:
            imports.end_read(self.store, self.task_id)


def output_response(store: Store, task_id: str, kind: str, request: Request, download: bool):
    imports.begin_read(store, task_id)
    response = None
    try:
        response = _output_response(store, task_id, kind, request, download)
        return response
    finally:
        if not isinstance(response, TaskFileResponse):
            imports.end_read(store, task_id)


def _output_response(store: Store, task_id: str, kind: str, request: Request, download: bool):
    task = tasks.get_task(store, task_id)
    record = tasks.get_record(store, task_id)
    saved = json.loads(record["stage_context_json"])
    descriptor = task["outputs"].get(kind)
    relative = saved.get("output_paths", {}).get(kind)
    if descriptor is None or relative is None:
        raise ApiError(404, "OUTPUT_NOT_FOUND", "This output is not available.", action="none")
    root = (store.root / "tasks" / task_id / "output").resolve()
    path = (root.parent / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != descriptor["size_bytes"]:
        raise ApiError(404, "OUTPUT_NOT_FOUND", "The registered output is missing or has changed.", action="none")
    supports_range = kind in {"video", "audio"} and request.method != "HEAD"
    header = request.headers.get("range") if supports_range else None
    if header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
        size = descriptor["size_bytes"]
        valid = False
        if match:
            start, end = match.groups()
            if start:
                valid = int(start) < size and (not end or int(end) >= int(start))
            elif end:
                valid = int(end) > 0
        if not valid:
            return JSONResponse(status_code=416, content=error_content(
                "RANGE_NOT_SATISFIABLE", "A single valid byte range is required.", action="none",
            ), headers={"Content-Range": f"bytes */{size}"})
    return TaskFileResponse(path, store=store, task_id=task_id, supports_range=supports_range,
                         media_type=descriptor["mime_type"], filename=descriptor["file_name"],
                         content_disposition_type="attachment" if download else "inline")


def log_response(store: Store, task_id: str, lines: int, download: bool):
    imports.begin_read(store, task_id)
    response = None
    try:
        response = _log_response(store, task_id, lines, download)
        return response
    finally:
        if not isinstance(response, TaskFileResponse):
            imports.end_read(store, task_id)


def _log_response(store: Store, task_id: str, lines: int, download: bool):
    tasks.get_task(store, task_id)
    path = store.root / "tasks" / task_id / "task.log"
    if not path.is_file():
        return PlainTextResponse("")
    if download:
        return TaskFileResponse(path, store=store, task_id=task_id, media_type="text/plain",
                                filename=f"{task_id}.log", content_disposition_type="attachment")
    with path.open(encoding="utf-8") as handle:
        return PlainTextResponse("".join(deque(handle, maxlen=lines)))

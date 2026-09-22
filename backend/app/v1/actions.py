"""Explicit Task lifecycle actions and their managed-file operations."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi import UploadFile

from . import imports, tasks
from .contracts import RerunRequest
from .errors import ApiError
from .storage import Store, now_iso


def _record(conn, task_id: str) -> dict:
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise ApiError(404, "TASK_NOT_FOUND", "Task not found.", action="none")
    return dict(row)


def _input(record: dict, root: Path) -> Path:
    path = Path(record["input_path"])
    if not path.is_file() or not path.resolve().is_relative_to((root / "input").resolve()):
        raise ApiError(422, "INPUT_MISSING", "The original imported video is missing.", stage="prepare", action="none")
    return path


def _remove(path: Path) -> None:
    """Remove only the selected managed path; leave partial failures visible."""
    try:
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.exists():
            shutil.rmtree(path)
    except OSError as exc:
        raise ApiError(500, "FILE_DELETE_FAILED", "Task files could not be completely removed; the task record was retained.",
                       action="contact_support") from exc


def cancel_task(store: Store, task_id: str) -> dict:
    imports.validate_task_id(task_id)
    with store.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        record = _record(conn, task_id)
        status = record["status"]
        if status in tasks.TERMINAL_STATUSES or status == "cancelling":
            return tasks._public_task(record)
        timestamp = now_iso()
        queued = status == "queued"
        conn.execute(
            "UPDATE tasks SET status=?,updated_at=?,finished_at=?,wait_reason=NULL,status_message=? WHERE id=?",
            ("cancelled" if queued else "cancelling", timestamp, timestamp if queued else None,
             "Task cancelled." if queued else "Waiting for local processing to stop.", task_id),
        )
        return tasks._public_task(_record(conn, task_id))


def retry_task(store: Store, task_id: str, expected_attempt: int) -> dict:
    if type(expected_attempt) is not int or expected_attempt < 1:
        raise ApiError(422, "INVALID_CONFIG", "expected_attempt must be a positive integer.", field="expected_attempt")
    imports.validate_task_id(task_id)
    current = tasks.get_record(store, task_id)
    if current is not None and current["attempt"] == expected_attempt + 1:
        return tasks._public_task(current)
    imports.begin_task_write(store, task_id)
    try:
        with store.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            record = _record(conn, task_id)
            if record["attempt"] == expected_attempt + 1:
                return tasks._public_task(record)
            if record["attempt"] != expected_attempt:
                raise ApiError(409, "ATTEMPT_CONFLICT", "The task attempt has changed.", field="expected_attempt", action="none")
            if record["status"] in tasks.ACTIVE_STATUSES:
                raise ApiError(409, "TASK_BUSY", "The task is still active.", action="none")
            if record["status"] not in {"failed", "cancelled"}:
                raise ApiError(409, "RETRY_NOT_ALLOWED", "Only failed or cancelled tasks can be retried.", action="rerun")
            context = json.loads(record["stage_context_json"])
            if context["external_operation"]["may_still_run"]:
                raise ApiError(409, "EXTERNAL_RESULT_UNKNOWN", "The previous external operation may still be running.", action="rerun")
            root = store.root / "tasks" / task_id
            source = _input(record, root)
            _remove(root / "work")
            _remove(root / "output")
            reset = {key: context[key] for key in ("pipeline_version", "resolved_connections", "credential_refs")}
            reset.update(input_files={"video": str(source)}, external_operation={"state": "none", "may_still_run": False})
            timestamp = now_iso()
            conn.execute(
                "UPDATE tasks SET attempt=attempt+1,status='queued',current_stage='prepare',stage_progress=NULL,"
                "source_duration_ms=NULL,wait_reason=NULL,status_message='Task retried and queued.',outputs_json='{}',"
                "error_json=NULL,stage_context_json=?,updated_at=?,queued_at=?,started_at=NULL,finished_at=NULL WHERE id=?",
                (json.dumps(reset, ensure_ascii=False), timestamp, timestamp, task_id),
            )
            return tasks._public_task(_record(conn, task_id))
    finally:
        imports.end_task_write(store, task_id)


def rerun_task(store: Store, source_id: str, request: RerunRequest, runtime: dict) -> dict:
    imports.begin_task_write(store, source_id)
    try:
        record = tasks.get_record(store, source_id)
        if record is None:
            raise ApiError(404, "TASK_NOT_FOUND", "Task not found.", action="none")
        if record["status"] not in tasks.TERMINAL_STATUSES:
            raise ApiError(409, "TASK_BUSY", "The source task is still active.", action="none")
        context = json.loads(record["stage_context_json"])
        if context["external_operation"]["may_still_run"] and not request.acknowledge_external_risk:
            raise ApiError(409, "EXTERNAL_RESULT_UNKNOWN", "Confirm the previous external operation's risk before creating a new task.",
                           field="acknowledge_external_risk", action="none")
        source = _input(record, store.root / "tasks" / source_id)
        with source.open("rb") as handle:
            upload = UploadFile(filename=record["source_name"], file=handle)
            return imports.import_video(store, request.id, upload, request.config, runtime)
    finally:
        imports.end_task_write(store, source_id)


def delete_task(store: Store, task_id: str) -> None:
    imports.begin_task_write(store, task_id)
    try:
        with store.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
            if row is not None and row["status"] not in tasks.TERMINAL_STATUSES:
                raise ApiError(409, "TASK_BUSY", "Cancel the active task before deleting it.", action="none")
            _remove(store.root / "tasks" / task_id)
            conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    finally:
        imports.end_task_write(store, task_id)

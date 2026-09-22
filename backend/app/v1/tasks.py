"""Task snapshots and single-active-task scheduling for the MVP worker."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Collection
from datetime import datetime
from pathlib import Path

from .contracts import Task, TaskConfig, TaskSummary
from .errors import ApiError
from .runtime import CapabilityError, validate_config_capabilities
from .storage import Store, now_iso


ACTIVE_STATUSES = ("queued", "running", "waiting", "cancelling")
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")
_UPDATE_FIELDS = frozenset({
    "source_duration_ms", "status", "current_stage", "stage_progress",
    "wait_reason", "status_message", "outputs_json", "stage_context_json",
    "error_json", "queued_at", "started_at", "finished_at",
})
_SNAPSHOT_FIELDS = ("pipeline_version", "resolved_connections", "credential_refs")


def _public_task(record: dict, *, summary: bool = False) -> dict:
    context = json.loads(record["stage_context_json"])
    external = context["external_operation"]
    status = record["status"]
    if status in ACTIVE_STATUSES:
        actions = ["cancel"]
    else:
        actions = ["rerun", "delete"]
        if status in {"failed", "cancelled"} and not external["may_still_run"]:
            actions.insert(0, "retry")
    result = {
        "id": record["id"], "attempt": record["attempt"],
        "source_name": record["source_name"], "source_size_bytes": record["source_size_bytes"],
        "source_duration_ms": record["source_duration_ms"], "status": status,
        "current_stage": record["current_stage"], "stage_progress": record["stage_progress"],
        "wait_reason": record["wait_reason"], "message": record["status_message"],
        "error": json.loads(record["error_json"]) if record["error_json"] is not None else None,
        "external_operation": external, "allowed_actions": actions,
        "created_at": record["created_at"], "updated_at": record["updated_at"],
        "started_at": record["started_at"], "finished_at": record["finished_at"],
    }
    if summary:
        return TaskSummary.model_validate(result).model_dump(mode="json")
    result.update({
        "config": json.loads(record["config_json"]),
        "pipeline_version": context["pipeline_version"],
        "resolved_connections": context["resolved_connections"],
        "outputs": json.loads(record["outputs_json"]),
    })
    return Task.model_validate(result).model_dump(mode="json")


def create_task(
    store: Store, *, task_id: str, source_name: str, source_size_bytes: int,
    input_path: Path, config: TaskConfig, runtime: dict,
) -> dict:
    """Persist the validated config and selected provider connection snapshots."""
    configuration = config.model_dump(mode="json")
    with store._settings_lock:
        saved = store._settings_values().get("connections", [])
        selected_remote = {
            selection["adapter"]
            for kind in ("asr", "translation", "tts", "separation")
            if (selection := configuration[kind]) is not None
            and any(capability["adapter"] == selection["adapter"]
                    and capability["capability"] == kind
                    and capability["execution"] == "remote"
                    for capability in runtime["capabilities"])
        }
        connections = [item for item in saved if item["adapter"] in selected_remote]
        public_connections = [{
            "adapter": item["adapter"], "base_url": item["base_url"],
            "has_api_key": bool(item.get("credential_ref") and store.credentials.get(item["credential_ref"])),
        } for item in connections]
        try:
            validate_config_capabilities(configuration, runtime, connections=public_connections)
        except CapabilityError as exc:
            raise ApiError(422, exc.code, str(exc), field=exc.field) from exc
        context = {
            "pipeline_version": "0.1.0",
            "input_files": {"video": str(input_path)},
            "resolved_connections": [{"adapter": item["adapter"], "base_url": item["base_url"]}
                                     for item in connections],
            "credential_refs": {item["adapter"]: item["credential_ref"] for item in connections
                                if item.get("credential_ref")},
            "external_operation": {"state": "none", "may_still_run": False},
        }
        timestamp = now_iso()
        record = {
            "id": task_id, "attempt": 1, "source_name": source_name,
            "source_size_bytes": source_size_bytes, "source_duration_ms": None,
            "input_path": str(input_path), "config_json": json.dumps(configuration, ensure_ascii=False),
            "status": "queued", "current_stage": "prepare", "stage_progress": None,
            "wait_reason": None, "status_message": None, "outputs_json": "{}",
            "stage_context_json": json.dumps(context, ensure_ascii=False), "error_json": None,
            "created_at": timestamp, "updated_at": timestamp, "queued_at": timestamp,
            "started_at": None, "finished_at": None,
        }
        result = _public_task(record)
        try:
            with store.connect() as conn:
                conn.execute(
                    f"INSERT INTO tasks ({','.join(record)}) VALUES ({','.join('?' for _ in record)})",
                    tuple(record.values()),
                )
        except sqlite3.IntegrityError as exc:
            if exc.sqlite_errorcode == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY:
                raise ApiError(409, "TASK_EXISTS", "A task with this ID already exists.", field="id") from exc
            raise
        return result


def get_record(store: Store, task_id: str) -> dict | None:
    with store.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return dict(row) if row is not None else None


def get_task(store: Store, task_id: str) -> dict:
    record = get_record(store, task_id)
    if record is None:
        raise ApiError(404, "TASK_NOT_FOUND", "Task not found.", action="none")
    return _public_task(record)


def list_tasks(
    store: Store, limit: int = 20, offset: int = 0,
    status: str | None = None, active: bool | None = None,
) -> dict:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ApiError(422, "INVALID_CONFIG", "limit must be between 1 and 100.", field="limit")
    if type(offset) is not int or offset < 0:
        raise ApiError(422, "INVALID_CONFIG", "offset must be a nonnegative integer.", field="offset")
    if status is not None and active is not None:
        raise ApiError(422, "INVALID_CONFIG", "status and active cannot be combined.", field="active")
    if status is not None and status not in ACTIVE_STATUSES + TERMINAL_STATUSES:
        raise ApiError(422, "INVALID_CONFIG", "Unknown task status.", field="status")
    if active is not None and type(active) is not bool:
        raise ApiError(422, "INVALID_CONFIG", "active must be a boolean.", field="active")
    parameters: list = []
    where = ""
    if status is not None:
        where = " WHERE status=?"
        parameters.append(status)
    elif active is not None:
        statuses = ACTIVE_STATUSES if active else TERMINAL_STATUSES
        where = f" WHERE status IN ({','.join('?' for _ in statuses)})"
        parameters.extend(statuses)
    with store.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks" + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (*parameters, limit + 1, offset),
        ).fetchall()
    return {"items": [_public_task(dict(row), summary=True) for row in rows[:limit]],
            "limit": limit, "offset": offset, "has_more": len(rows) > limit}


def update_task(
    store: Store, task_id: str, attempt: int, expected_status: str | Collection[str], **fields,
) -> bool:
    """Conditionally apply one worker write; JSON fields accept native objects."""
    unknown = fields.keys() - _UPDATE_FIELDS
    if unknown:
        raise ValueError("Unsupported task update fields: " + ", ".join(sorted(unknown)))
    statuses = (expected_status,) if isinstance(expected_status, str) else tuple(expected_status)
    if not statuses or any(status not in ACTIVE_STATUSES + TERMINAL_STATUSES for status in statuses):
        raise ValueError("expected_status must contain known task statuses")
    changes = dict(fields)
    for name in ("outputs_json", "stage_context_json", "error_json"):
        if name not in changes:
            continue
        value = changes[name]
        if value is None and name == "error_json":
            continue
        if not isinstance(value, dict):
            raise TypeError(f"{name} must be a dict")
        changes[name] = json.dumps(value, ensure_ascii=False, allow_nan=False)
    changes["updated_at"] = now_iso()
    with store.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND attempt=?", (task_id, attempt)).fetchone()
        if row is None or row["status"] not in statuses:
            return False
        record = dict(row)
        if "stage_context_json" in fields:
            previous = json.loads(record["stage_context_json"])
            if any(fields["stage_context_json"].get(name) != previous.get(name) for name in _SNAPSHOT_FIELDS):
                raise ValueError("Task configuration and provider snapshots are immutable")
        record.update(changes)
        _public_task(record)
        return conn.execute(
            f"UPDATE tasks SET {','.join(name + '=?' for name in changes)} "
            f"WHERE id=? AND attempt=? AND status IN ({','.join('?' for _ in statuses)})",
            (*changes.values(), task_id, attempt, *statuses),
        ).rowcount == 1


def claim_next(store: Store) -> dict | None:
    """Claim the next stage while retaining the active task across stage waits."""
    with store.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM tasks WHERE status IN ('running','cancelling') LIMIT 1").fetchone():
            return None
        # A waiting task retains the single active slot even between polls.
        row = conn.execute(
            "SELECT * FROM tasks WHERE status='waiting' ORDER BY started_at, queued_at, id LIMIT 1",
        ).fetchone()
        timestamp = now_iso()
        if row is not None:
            context = json.loads(row["stage_context_json"])
            next_poll = context.get("next_poll_at")
            if not isinstance(next_poll, str):
                raise ValueError("Waiting task is missing next_poll_at")
            # Invalid scheduler data must remain visible instead of silently
            # admitting another task or leaving this one waiting forever.
            due = datetime.strptime(next_poll, "%Y-%m-%dT%H:%M:%S.%fZ")
            if due > datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.%fZ"):
                return None
        else:
            row = conn.execute(
                "SELECT * FROM tasks WHERE status='queued' "
                "ORDER BY started_at IS NULL, started_at, queued_at, id LIMIT 1",
            ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE tasks SET status='running', wait_reason=NULL, status_message=NULL, "
            "started_at=COALESCE(started_at,?), updated_at=? WHERE id=? AND attempt=? AND status=?",
            (timestamp, timestamp, row["id"], row["attempt"], row["status"]),
        )
        return dict(conn.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone())

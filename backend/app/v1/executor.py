"""Drive one MVP Task through its stages on the shared single-thread worker."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Callable

from .. import runtime_security
from . import media, tasks
from .contracts import TaskConfig, Timestamp
from .errors import ApiError, error_content
from .credentials import CredentialStoreError
from .steps import Completed, StageContext, StepResult, Waiting
from .storage import Store, now_iso

STAGES = ("prepare", "separate", "asr", "translate", "tts", "mix", "export")
TERMINAL = {"succeeded", "failed", "cancelled"}
StepRunner = Callable[[StageContext, Callable[[float | None, str], None]], StepResult]


def startup_tasks(store: Store) -> list[str]:
    """Interrupted local steps fail explicitly; saved remote waits keep their ID."""
    with store.connect() as conn:
        interrupted = [dict(row) for row in conn.execute("SELECT * FROM tasks WHERE status IN ('running','cancelling')")]
    for record in interrupted:
        saved = json.loads(record["stage_context_json"])
        if saved["external_operation"]["may_still_run"]:
            saved["external_operation"] = {"state": "unknown", "may_still_run": True}
        error = error_content("APP_INTERRUPTED", "The application stopped during a local step.",
                              stage=record["current_stage"], action="retry")["error"]
        tasks.update_task(store, record["id"], record["attempt"], record["status"],
                          status="failed", finished_at=now_iso(), error_json=error,
                          stage_context_json=saved, wait_reason=None, status_message=error["message"])
    with store.connect() as conn:
        return [row["id"] for row in conn.execute(
            "SELECT id FROM tasks WHERE status IN ('queued','waiting') ORDER BY started_at IS NULL, started_at, queued_at, id",
        )]


def stages_for(config: TaskConfig) -> tuple[str, ...]:
    return tuple(stage for stage in STAGES
                 if not (stage == "separate" and config.separation is None)
                 and not (stage in {"tts", "mix"} and config.output_mode == "subtitles"))


def execute_stage(context: StageContext, progress) -> StepResult:
    if context.stage == "prepare":
        return media.prepare(context, progress)
    raise ApiError(503, "MODEL_NOT_READY", f"The {context.stage} step has not been connected yet.", stage=context.stage)


def _redact(text: str, connections: dict) -> str:
    for connection in connections.values():
        secret = connection.get("api_key")
        if secret:
            text = text.replace(secret, "[redacted]")
    return re.sub(r"(?i)(authorization|api[_-]?key|cookie)\s*[:=]\s*[^\r\n]+", r"\1: [redacted]", text)


def append_log(store: Store, task_id: str, message: str, connections: dict | None = None) -> None:
    path = store.root / "tasks" / task_id / "task.log"
    with runtime_security.open_private_append_text(path) as handle:
        for line in _redact(message, connections or {}).splitlines():
            handle.write(f"[{now_iso()}] {line}\n")


def _connections(store: Store, saved: dict) -> dict:
    result = {}
    for connection in saved["resolved_connections"]:
        adapter = connection["adapter"]
        reference = saved["credential_refs"].get(adapter)
        try:
            key = store.credentials.get(reference) if reference else None
        except CredentialStoreError as exc:
            raise ApiError(503, "RUNTIME_UNAVAILABLE", str(exc), field="connection.api_key") from exc
        if reference and not key:
            raise ApiError(503, "MODEL_NOT_READY", "The task credential is no longer available.", field="connection.api_key")
        result[adapter] = {"base_url": connection["base_url"],
                           "api_key": key}
    return result


def _finish_outputs(store: Store, task_id: str, config: TaskConfig, files: dict[str, Path]) -> tuple[dict, dict]:
    required = {"video"}
    if config.output_mode in {"subtitles", "both"}:
        required.update({"source_subtitles", "translated_subtitles"})
    if config.output_mode in {"dubbing", "both"}:
        required.add("audio")
    if not required.issubset(files):
        raise ApiError(500, "STAGE_OUTPUT_MISSING", "Export did not produce all required files.", stage="export")
    root = store.root / "tasks" / task_id
    output_root = (root / "output").resolve()
    outputs, paths = {}, {}
    for kind in required:
        path = Path(files[kind]).resolve()
        if not path.is_relative_to(output_root) or not path.is_file() or path.stat().st_size == 0:
            raise ApiError(500, "STAGE_OUTPUT_MISSING", "Export output is missing or outside its output directory.", stage="export")
        duration = media.probe_duration(path) if kind in {"video", "audio"} else None
        timeline = "source" if kind == "source_subtitles" or config.output_mode == "subtitles" else "dubbed"
        outputs[kind] = {
            "url": f"/api/v1/tasks/{task_id}/files/{kind}", "file_name": path.name,
            "mime_type": {"video": "video/mp4", "audio": "audio/wav"}.get(kind, "application/x-subrip"),
            "size_bytes": path.stat().st_size, "duration_ms": duration, "timeline": timeline,
        }
        paths[kind] = str(path.relative_to(root.resolve()))
    return outputs, paths


def run_step(store: Store, record: dict, runner: StepRunner = execute_stage) -> None:
    task_id, attempt, stage = record["id"], record["attempt"], record["current_stage"]
    saved = json.loads(record["stage_context_json"])
    config = TaskConfig.model_validate_json(record["config_json"])
    connections = {}

    def progress(value: float | None, message: str):
        safe = _redact(message, connections)
        tasks.update_task(store, task_id, attempt, "running", stage_progress=value, status_message=safe)
        append_log(store, task_id, f"[{stage}] {safe}", connections)

    try:
        work = runtime_security.ensure_private_directory(store.root / "tasks" / task_id / "work")
        runtime_security.ensure_private_directory(store.root / "tasks" / task_id / "output")
        connections = _connections(store, saved)
        context = StageContext(task_id=task_id, attempt=attempt, stage=stage, config=config,
                               input_files={key: Path(value) for key, value in saved["input_files"].items()},
                               work_dir=work, remote_task_id=saved.get("remote_task_id"), connections=connections)
        result = runner(context, progress)
        if isinstance(result, Waiting):
            from pydantic import TypeAdapter

            TypeAdapter(Timestamp).validate_python(result.next_poll_at)
            if not result.remote_task_id:
                raise ApiError(500, "INVALID_PROVIDER_RESULT", "Provider returned an empty operation ID.", stage=stage)
            if saved.get("remote_task_id") and saved["remote_task_id"] != result.remote_task_id:
                raise ApiError(500, "INVALID_PROVIDER_RESULT", "Polling changed the external operation ID.", stage=stage)
            saved.update(remote_task_id=result.remote_task_id, next_poll_at=result.next_poll_at,
                         external_operation={"state": "pending", "may_still_run": True})
            tasks.update_task(store, task_id, attempt, "running", status="waiting", wait_reason="remote_result",
                              stage_progress=None, stage_context_json=saved, status_message="Waiting for provider result.")
        elif isinstance(result, Completed):
            for path in result.output_files.values():
                if not Path(path).is_file() or Path(path).stat().st_size == 0:
                    raise ApiError(500, "STAGE_OUTPUT_MISSING", "A step output file is missing or empty.", stage=stage)
            saved["input_files"].update({key: str(path) for key, path in result.output_files.items()})
            saved.pop("next_poll_at", None)
            if saved.pop("remote_task_id", None):
                saved["external_operation"] = {"state": "succeeded", "may_still_run": False}
            updates = {"stage_context_json": saved, "wait_reason": None, "status_message": f"{stage} completed."}
            if stage == "prepare":
                info = json.loads(result.output_files["media_info"].read_text())
                updates["source_duration_ms"] = info["duration_ms"]
            if stage == "export":
                outputs, paths = _finish_outputs(store, task_id, config, result.output_files)
                saved["output_paths"] = paths
                updates.update(status="succeeded", current_stage="done", stage_progress=1.0,
                               finished_at=now_iso(), outputs_json=outputs)
            else:
                stages = stages_for(config)
                updates.update(status="queued", current_stage=stages[stages.index(stage) + 1], stage_progress=None)
            tasks.update_task(store, task_id, attempt, "running", **updates)
        else:
            raise ApiError(500, "INVALID_PROVIDER_RESULT", "A step returned an invalid result.", stage=stage)
    except Exception as exc:
        current = tasks.get_record(store, task_id)
        if current is None or current["attempt"] != attempt or current["status"] != "running":
            raise
        if saved.get("remote_task_id"):
            saved["external_operation"] = {"state": "unknown", "may_still_run": True}
        error = exc.content["error"] if isinstance(exc, ApiError) else error_content(
            "WORKER_EXITED", f"The {stage} step failed ({type(exc).__name__}).", stage=stage, action="retry",
        )["error"]
        error = {**error, "message": _redact(error["message"], connections), "stage": stage}
        tasks.update_task(store, task_id, attempt, "running", status="failed", error_json=error,
                          stage_context_json=saved, finished_at=now_iso(), wait_reason=None, status_message=error["message"])
        append_log(store, task_id, f"[{stage}] {type(exc).__name__}: {exc}", connections)
    else:
        append_log(store, task_id, f"[{stage}] {result.state}", connections)


def run_task(store: Store, task_id: str, runner: StepRunner = execute_stage) -> None:
    """Keep the shared worker slot while the current Task waits or advances."""
    while True:
        requested = tasks.get_record(store, task_id)
        if requested is None or requested["status"] in TERMINAL:
            return
        claimed = tasks.claim_next(store)
        if claimed is None:
            if requested["status"] in {"running", "cancelling"}:
                return
            time.sleep(0.25)
            continue
        run_step(store, claimed, runner)

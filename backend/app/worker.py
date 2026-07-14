"""Single-thread FIFO worker that runs queued tasks one at a time."""

from __future__ import annotations

import logging
import queue
import threading
import traceback
from typing import Callable

from . import database, runtime_security


_queue: "queue.Queue[str]" = queue.Queue()
_thread: threading.Thread | None = None
_lock = threading.Lock()
logger = logging.getLogger(__name__)


def enqueue(task_id: str) -> None:
    _queue.put(task_id)


def _append_failure_log(task_id: str, traceback_text: str) -> None:
    path = database.log_path(task_id)
    timestamp = database.now_iso()
    with runtime_security.open_private_append_text(path) as handle:
        handle.write(f"[{timestamp}] Worker caught an unhandled runner exception\n")
        for line in traceback_text.rstrip().splitlines():
            handle.write(f"[{timestamp}] {line}\n")


def _record_runner_failure(task_id: str, exc: Exception) -> None:
    error_message = str(exc).strip() or type(exc).__name__
    traceback_text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))

    task = None
    try:
        task = database.get_task(task_id)
    except Exception:
        logger.exception("Failed to load task %s after runner exception", task_id)

    if task is not None:
        completed_at = database.now_iso()
        try:
            database.update_task(
                task_id,
                status="failed",
                error_message=error_message,
                completed_at=completed_at,
            )
        except Exception:
            logger.exception("Failed to mark task %s as failed", task_id)

        failed_stage = task.get("current_stage")
        if failed_stage and failed_stage != "done":
            try:
                database.update_stage(
                    task_id,
                    failed_stage,
                    status="failed",
                    completed_at=completed_at,
                    error_message=error_message,
                    last_message="Failed",
                )
            except Exception:
                logger.exception("Failed to mark task %s stage %s as failed", task_id, failed_stage)

    try:
        _append_failure_log(task_id, traceback_text)
    except Exception:
        logger.exception("Failed to write runner exception log for task %s", task_id)


def _loop(runner: Callable[[str], None]) -> None:
    while True:
        task_id = _queue.get()
        try:
            runner(task_id)
        except Exception as exc:
            logger.error(
                "Unhandled worker runner exception for task %s",
                task_id,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
            try:
                _record_runner_failure(task_id, exc)
            except Exception:
                logger.exception("Failed to record runner exception for task %s", task_id)
        finally:
            _queue.task_done()


def start(runner: Callable[[str], None]) -> None:
    global _thread
    with _lock:
        if _thread is not None:
            return
        _thread = threading.Thread(target=_loop, args=(runner,), daemon=True)
        _thread.start()
    pending = [t for t in database.list_tasks() if t["status"] == "queued"]
    for task in reversed(pending):
        _queue.put(task["id"])

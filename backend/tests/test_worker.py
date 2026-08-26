from __future__ import annotations

import queue
import threading

from backend.app import database, pipeline, worker
from backend.app.pipeline import PipelineRunner


def test_worker_picks_up_pending_and_new_tasks(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "worker.sqlite")
    database.init_db()
    pre_queued = [
        database.create_task(f"https://www.youtube.com/watch?v=v{i:011d}") for i in range(2)
    ]

    executed: list[str] = []
    target = len(pre_queued) + 1
    done = threading.Event()

    def runner(task_id: str) -> None:
        executed.append(task_id)
        if len(executed) == target:
            done.set()

    monkeypatch.setattr(worker, "_thread", None)
    worker.start(runner)
    worker.enqueue("late-task")

    assert done.wait(timeout=2.0)
    assert executed[:2] == pre_queued
    assert executed[-1] == "late-task"


def test_worker_isolates_runner_exception_and_processes_next_task(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "worker-isolation.sqlite")
    database.init_db()
    failed_task = database.create_task(
        "https://www.youtube.com/watch?v=failedtask1",
        task_id="failedtask1",
    )
    successful_task = database.create_task(
        "https://www.youtube.com/watch?v=successtask",
        task_id="successtask",
    )
    work_queue: queue.Queue[str] = queue.Queue()
    monkeypatch.setattr(worker, "_queue", work_queue)

    executed: list[str] = []
    second_finished = threading.Event()

    def runner(task_id: str) -> None:
        executed.append(task_id)
        if task_id == failed_task:
            raise RuntimeError("first runner exploded")
        database.update_task(
            task_id,
            status="succeeded",
            current_stage="done",
            completed_at=database.now_iso(),
        )
        second_finished.set()

    thread = threading.Thread(target=worker._loop, args=(runner,), daemon=True)
    thread.start()
    work_queue.put(failed_task)
    work_queue.put(successful_task)

    assert second_finished.wait(timeout=2.0)
    queue_joined = threading.Event()

    def join_queue() -> None:
        work_queue.join()
        queue_joined.set()

    threading.Thread(target=join_queue, daemon=True).start()
    assert queue_joined.wait(timeout=2.0)

    failed = database.get_task(failed_task)
    failed_stages = {stage["name"]: stage for stage in failed["stages"]}
    succeeded = database.get_task(successful_task)
    log_content = database.log_path(failed_task).read_text(encoding="utf-8")

    assert executed == [failed_task, successful_task]
    assert thread.is_alive()
    assert failed["status"] == "failed"
    assert failed["error_message"] == "first runner exploded"
    assert failed_stages["download"]["status"] == "failed"
    assert failed_stages["download"]["error_message"] == "first runner exploded"
    assert "Worker caught an unhandled runner exception" in log_content
    assert "RuntimeError: first runner exploded" in log_content
    assert succeeded["status"] == "succeeded"


def test_worker_preserves_succeeded_manual_stage_after_task_release_failure(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "worker-manual-release.sqlite")
    monkeypatch.setattr(database, "log_path", lambda task_id: tmp_path / f"{task_id}.log")
    database.init_db()
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=manualclean",
        task_id="manual-release-failure",
        execution_mode="manual",
    )
    monkeypatch.setattr(PipelineRunner, "_download", lambda self, task: None)
    monkeypatch.setattr(
        pipeline.gpu_memory,
        "release_task_memory",
        lambda: (_ for _ in ()).throw(RuntimeError("final release exploded")),
    )

    work_queue: queue.Queue[str] = queue.Queue()
    monkeypatch.setattr(worker, "_queue", work_queue)
    original_record_runner_failure = worker._record_runner_failure
    before_worker: dict[str, object] = {}
    failure_recorded = threading.Event()

    def capture_runner_failure(current_task_id: str, exc: Exception) -> None:
        before_worker["task"] = database.get_task(current_task_id)
        original_record_runner_failure(current_task_id, exc)
        failure_recorded.set()

    monkeypatch.setattr(worker, "_record_runner_failure", capture_runner_failure)
    thread = threading.Thread(target=worker._loop, args=(pipeline.run_task,), daemon=True)
    thread.start()
    work_queue.put(task_id)

    assert failure_recorded.wait(timeout=2.0)
    queue_joined = threading.Event()

    def join_queue() -> None:
        work_queue.join()
        queue_joined.set()

    threading.Thread(target=join_queue, daemon=True).start()
    assert queue_joined.wait(timeout=2.0)

    task_before_worker = before_worker["task"]
    stages_before_worker = {
        stage["name"]: stage for stage in task_before_worker["stages"]
    }
    task_after_worker = database.get_task(task_id)
    stages_after_worker = {
        stage["name"]: stage for stage in task_after_worker["stages"]
    }

    assert task_before_worker["status"] == "failed"
    assert task_before_worker["error_message"] == "final release exploded"
    assert stages_before_worker["download"]["status"] == "succeeded"
    assert task_after_worker["status"] == "failed"
    assert task_after_worker["error_message"] == "final release exploded"
    assert stages_after_worker["download"]["status"] == "succeeded"
    assert stages_after_worker["separate"]["status"] == "pending"


def test_worker_preserves_skipped_current_stage(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "worker-skipped-stage.sqlite")
    monkeypatch.setattr(database, "log_path", lambda task_id: tmp_path / f"{task_id}.log")
    database.init_db()
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=skippedstage",
        task_id="skipped-stage-failure",
    )
    database.update_task(task_id, status="paused", current_stage="asr_fix")
    database.update_stage(
        task_id,
        "asr_fix",
        status="skipped",
        completed_at=database.now_iso(),
    )

    worker._record_runner_failure(task_id, RuntimeError("runner exploded"))

    task = database.get_task(task_id)
    stages = {stage["name"]: stage for stage in task["stages"]}
    assert task["status"] == "failed"
    assert task["error_message"] == "runner exploded"
    assert stages["asr_fix"]["status"] == "skipped"
    assert stages["asr_fix"]["error_message"] is None


def test_worker_continues_when_failure_reporter_also_raises(monkeypatch, caplog):
    work_queue: queue.Queue[str] = queue.Queue()
    monkeypatch.setattr(worker, "_queue", work_queue)

    def fail_reporter(_task_id: str, _exc: Exception) -> None:
        raise RuntimeError("reporter exploded")

    monkeypatch.setattr(worker, "_record_runner_failure", fail_reporter)
    processed: list[str] = []
    second_finished = threading.Event()

    def runner(task_id: str) -> None:
        processed.append(task_id)
        if task_id == "first":
            raise RuntimeError("runner exploded")
        second_finished.set()

    thread = threading.Thread(target=worker._loop, args=(runner,), daemon=True)
    thread.start()
    work_queue.put("first")
    work_queue.put("second")

    assert second_finished.wait(timeout=2.0)
    queue_joined = threading.Event()

    def join_queue() -> None:
        work_queue.join()
        queue_joined.set()

    threading.Thread(target=join_queue, daemon=True).start()
    assert queue_joined.wait(timeout=2.0)

    assert thread.is_alive()
    assert processed == ["first", "second"]
    assert "Unhandled worker runner exception for task first" in caplog.text
    assert "Failed to record runner exception for task first" in caplog.text

from __future__ import annotations

import io
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import UploadFile

from backend.app.v1 import actions, imports, tasks
from backend.app.v1.contracts import RerunRequest, SettingsPatch
from backend.app.v1.errors import ApiError
from backend.app.v1.runtime import RUNTIME_LIMITS
from backend.tests.test_v1_tasks import ERROR, LATER, NOW, config, runtime, store


@pytest.fixture
def create(store, config, runtime, monkeypatch):
    runtime["limits"] = RUNTIME_LIMITS
    monkeypatch.setattr(actions, "now_iso", lambda: LATER)

    def create_one(task_id=None):
        return imports.import_video(
            store, task_id or str(uuid4()),
            UploadFile(filename="Original.mp4", file=io.BytesIO(b"example original video bytes")),
            config, runtime,
        )
    return create_one


def fail(store, task_id, *, external="none"):
    record = tasks.get_record(store, task_id)
    context = json.loads(record["stage_context_json"])
    context["external_operation"] = {"state": external, "may_still_run": external in {"pending", "unknown"}}
    tasks.update_task(store, task_id, record["attempt"], record["status"], status="failed", error_json=ERROR,
                      stage_context_json=context, finished_at=NOW)


def assert_error(code, callback):
    with pytest.raises(ApiError) as error:
        callback()
    assert error.value.content["error"]["code"] == code
    return error.value


def test_queued_cancel_and_repeated_cancel_are_immediate_and_idempotent(store, create):
    original = create()
    result = actions.cancel_task(store, original["id"])
    assert result["status"] == "cancelled"
    assert result["finished_at"] == LATER
    assert result["started_at"] is None
    assert result["external_operation"] == {"state": "none", "may_still_run": False}
    assert actions.cancel_task(store, original["id"]) == result


@pytest.mark.parametrize("status", ["running", "waiting"])
def test_active_cancel_waits_for_executor_and_preserves_remote_risk(store, create, status):
    original = create()
    record = tasks.claim_next(store)
    context = json.loads(record["stage_context_json"])
    if status == "waiting":
        context.update(next_poll_at=LATER, remote_task_id="existing-operation",
                       external_operation={"state": "pending", "may_still_run": True})
        tasks.update_task(store, original["id"], 1, "running", status="waiting", stage_context_json=context)
    result = actions.cancel_task(store, original["id"])
    assert result["status"] == "cancelling"
    assert result["finished_at"] is None
    assert result["external_operation"] == context["external_operation"]
    assert actions.cancel_task(store, original["id"]) == result
    assert tasks.claim_next(store) is None


def test_terminal_cancel_does_not_clear_failure(store, create):
    original = create()
    fail(store, original["id"])
    previous = tasks.get_task(store, original["id"])
    assert actions.cancel_task(store, original["id"]) == previous
    assert_error("TASK_NOT_FOUND", lambda: actions.cancel_task(store, str(uuid4())))


def test_retry_clears_attempt_outputs_and_retains_config_input_and_credentials(store, create):
    original = create()
    task_id = original["id"]
    root = store.root / "tasks" / task_id
    for name in ("work", "output"):
        (root / name).mkdir()
        (root / name / "previous.bin").write_bytes(b"old attempt")
    (root / "task.log").write_text("previous attempt log")
    previous = tasks.get_record(store, task_id)
    snapshot = json.loads(previous["stage_context_json"])
    fail(store, task_id)
    store.patch_settings(SettingsPatch.model_validate({"connection": {
        "adapter": "openai", "base_url": "https://changed.example.test/v1", "api_key": "changed-key",
    }}))
    result = actions.retry_task(store, task_id, 1)
    assert result["attempt"] == 2
    assert result["status"] == "queued"
    assert result["current_stage"] == "prepare"
    assert result["created_at"] == original["created_at"]
    assert result["updated_at"] == LATER
    assert result["config"] == original["config"]
    assert result["resolved_connections"] == original["resolved_connections"]
    assert result["outputs"] == {}
    assert result["error"] is None
    assert result["started_at"] is None and result["finished_at"] is None
    assert not (root / "work").exists() and not (root / "output").exists()
    assert (root / "task.log").read_text() == "previous attempt log"
    current = tasks.get_record(store, task_id)
    assert current["input_path"] == previous["input_path"]
    assert json.loads(current["stage_context_json"])["credential_refs"] == snapshot["credential_refs"]
    imports.begin_read(store, task_id)
    try:
        assert actions.retry_task(store, task_id, 1) == result
    finally:
        imports.end_read(store, task_id)
    assert_error("TASK_BUSY", lambda: actions.retry_task(store, task_id, 2))
    assert_error("ATTEMPT_CONFLICT", lambda: actions.retry_task(store, task_id, 3))


@pytest.mark.parametrize("external", ["pending", "unknown"])
def test_retry_rejects_external_risk_without_changing_attempt(store, create, external):
    task_id = create()["id"]
    fail(store, task_id, external=external)
    previous = tasks.get_record(store, task_id)
    assert_error("EXTERNAL_RESULT_UNKNOWN", lambda: actions.retry_task(store, task_id, 1))
    assert tasks.get_record(store, task_id) == previous


def test_retry_missing_input_and_cleanup_failure_remain_visible(store, create, monkeypatch):
    task_id = create()["id"]
    fail(store, task_id)
    root = store.root / "tasks" / task_id
    source = Path(tasks.get_record(store, task_id)["input_path"])
    original_bytes = source.read_bytes()
    source.unlink()
    assert_error("INPUT_MISSING", lambda: actions.retry_task(store, task_id, 1))
    source.write_bytes(original_bytes)
    (root / "work").mkdir()
    (root / "output").mkdir()
    actual_remove = actions.shutil.rmtree

    def denied(path):
        if path.name == "output":
            raise PermissionError("file is locked")
        return actual_remove(path)

    monkeypatch.setattr(actions.shutil, "rmtree", denied)
    assert_error("FILE_DELETE_FAILED", lambda: actions.retry_task(store, task_id, 1))
    assert tasks.get_task(store, task_id)["attempt"] == 1
    assert tasks.get_task(store, task_id)["status"] == "failed"
    assert not (root / "work").exists()
    assert (root / "output").exists()
    assert (store.path, task_id) not in imports._inflight


def test_rerun_copies_private_input_and_uses_current_connections(store, create, config, runtime):
    source = create()
    task_id = source["id"]
    actions.cancel_task(store, task_id)
    before = tasks.get_record(store, task_id)
    store.patch_settings(SettingsPatch.model_validate({"connection": {
        "adapter": "openai", "base_url": "https://new.example.test/v1", "api_key": "new-key",
    }}))
    request = RerunRequest(id=str(uuid4()), config=config)
    result = actions.rerun_task(store, task_id, request, runtime)
    assert result["id"] == request.id and result["attempt"] == 1
    assert result["status"] == "queued"
    assert result["resolved_connections"][0]["base_url"] == "https://new.example.test/v1"
    new_record = tasks.get_record(store, request.id)
    copied = Path(new_record["input_path"])
    assert copied != Path(before["input_path"])
    assert copied.read_bytes() == Path(before["input_path"]).read_bytes()
    assert copied.stat().st_ino != Path(before["input_path"]).stat().st_ino
    assert tasks.get_record(store, task_id) == before
    assert_error("TASK_EXISTS", lambda: actions.rerun_task(store, task_id, request, runtime))
    actions.delete_task(store, task_id)
    assert copied.read_bytes() == b"example original video bytes"


def test_rerun_requires_terminal_source_and_explicit_external_risk_confirmation(store, create, config, runtime):
    source = create()
    request = RerunRequest(id=str(uuid4()), config=config)
    assert_error("TASK_BUSY", lambda: actions.rerun_task(store, source["id"], request, runtime))
    fail(store, source["id"], external="unknown")
    assert_error("EXTERNAL_RESULT_UNKNOWN", lambda: actions.rerun_task(store, source["id"], request, runtime))
    assert tasks.get_record(store, request.id) is None
    request.acknowledge_external_risk = True
    assert actions.rerun_task(store, source["id"], request, runtime)["status"] == "queued"
    assert tasks.get_task(store, source["id"])["external_operation"]["may_still_run"] is True


def test_copy_failure_propagates_and_leaves_identifiable_residue(store, create, config, runtime, monkeypatch):
    source = create()
    actions.cancel_task(store, source["id"])
    source_path = Path(tasks.get_record(store, source["id"])["input_path"])
    request = RerunRequest(id=str(uuid4()), config=config)
    real_open = Path.open

    class BrokenRead(io.BytesIO):
        def read(self, size=-1):
            if self.tell():
                raise OSError("source read failed")
            return super().read(1)

    def open_path(path, *args, **kwargs):
        if path == source_path and args == ("rb",):
            return BrokenRead(b"partial")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_path)
    with pytest.raises(OSError, match="source read failed"):
        actions.rerun_task(store, source["id"], request, runtime)
    assert tasks.get_record(store, request.id) is None
    assert (store.root / "tasks" / request.id / "input" / "source.mp4").stat().st_size == 1
    assert (store.path, source["id"]) not in imports._inflight
    assert (store.path, request.id) not in imports._inflight
    assert_error("IMPORT_RESIDUE", lambda: actions.rerun_task(store, source["id"], request, runtime))


def test_delete_rejects_active_and_removes_only_terminal_task_files(store, create):
    first, other = create(), create()
    root = store.root / "tasks" / first["id"]
    assert_error("TASK_BUSY", lambda: actions.delete_task(store, first["id"]))
    actions.cancel_task(store, first["id"])
    actions.delete_task(store, first["id"])
    assert tasks.get_record(store, first["id"]) is None
    assert not root.exists()
    assert tasks.get_task(store, other["id"])["status"] == "queued"
    actions.delete_task(store, first["id"])


def test_delete_removes_orphan_import_but_rejects_inflight_and_readers(store, create):
    task_id = str(uuid4())
    root = store.root / "tasks" / task_id
    root.mkdir(parents=True)
    (root / "partial.mp4").write_bytes(b"partial")
    imports.begin_task_write(store, task_id)
    assert_error("TASK_BUSY", lambda: actions.delete_task(store, task_id))
    assert_error("TASK_BUSY", lambda: imports.begin_read(store, task_id))
    imports.end_task_write(store, task_id)
    imports.begin_read(store, task_id)
    imports.begin_read(store, task_id)
    assert_error("TASK_BUSY", lambda: actions.delete_task(store, task_id))
    imports.end_read(store, task_id)
    assert_error("TASK_BUSY", lambda: actions.delete_task(store, task_id))
    imports.end_read(store, task_id)
    actions.delete_task(store, task_id)
    assert not root.exists()


def test_delete_failure_retains_record_and_releases_reservation(store, create, monkeypatch):
    task_id = create()["id"]
    actions.cancel_task(store, task_id)
    previous = tasks.get_record(store, task_id)

    def denied(path):
        raise PermissionError("output is locked")

    monkeypatch.setattr(actions.shutil, "rmtree", denied)
    assert_error("FILE_DELETE_FAILED", lambda: actions.delete_task(store, task_id))
    assert tasks.get_record(store, task_id) == previous
    assert (store.path, task_id) not in imports._inflight


@pytest.mark.parametrize("task_id", ["../outside", "", "ABCDEF00-0000-0000-0000-000000000001"])
def test_file_actions_reject_noncanonical_task_ids(store, task_id):
    assert_error("INVALID_CONFIG", lambda: actions.delete_task(store, task_id))
    assert_error("INVALID_CONFIG", lambda: actions.retry_task(store, task_id, 1))
    assert_error("INVALID_CONFIG", lambda: actions.cancel_task(store, task_id))

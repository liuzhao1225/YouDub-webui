from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from pydantic import ValidationError

from backend.app.v1 import tasks
from backend.app.v1.contracts import SettingsPatch, Task, TaskConfig, TaskList
from backend.app.v1.errors import ApiError
from backend.app.v1.storage import Store


NOW = "2026-09-22T00:00:00.000Z"
LATER = "2026-09-22T00:00:10.000Z"
ERROR = {"code": "WORKER_EXITED", "message": "Worker stopped.", "field": None,
         "stage": "prepare", "action": "retry"}


class MemoryCredentials:
    def __init__(self):
        self.values = {}

    def get(self, reference):
        return self.values.get(reference)

    def set(self, reference, value):
        self.values[reference] = value

    def delete(self, reference):
        self.values.pop(reference, None)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(tasks, "now_iso", lambda: NOW)
    value = Store(tmp_path / "desktop", MemoryCredentials())
    value.patch_settings(SettingsPatch.model_validate({"connection": {
        "adapter": "openai", "base_url": "https://example.test/v1", "api_key": "original-key",
    }}))
    return value


@pytest.fixture
def config():
    return TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "subtitles",
        "keep_background": False,
        "asr": {"adapter": "whisper", "model": "test-whisper", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-openai", "device": "remote"},
        "tts": None, "separation": None,
    })


@pytest.fixture
def runtime():
    return {
        "devices": [{"id": "cpu", "available": True}],
        "capabilities": [{
            "adapter": adapter, "capability": kind, "execution": execution,
            "available": True, "unavailable_reason": None, "requires_api_key": execution == "remote",
            "models": [{"id": "test-" + adapter, "devices": [device],
                        "source_languages": ["en"], "target_languages": ["zh"]}],
        } for adapter, kind, execution, device in (
            ("whisper", "asr", "local", "cpu"), ("openai", "translation", "remote", "remote"),
        )],
    }


@pytest.fixture
def create(store, config, runtime):
    def create_one(**overrides):
        task_id = overrides.pop("task_id", str(uuid4()))
        return tasks.create_task(
            store, task_id=task_id, source_name="原视频.mp4", source_size_bytes=123,
            input_path=store.root / task_id / "input.mp4", config=config, runtime=runtime,
            **overrides,
        )
    return create_one


def test_create_read_and_list_match_public_contract_without_internal_data(store, create):
    result = create()
    assert Task.model_validate(result).status == "queued"
    assert result["current_stage"] == "prepare"
    assert result["attempt"] == 1
    assert result["stage_progress"] is None
    assert result["outputs"] == {}
    assert result["allowed_actions"] == ["cancel"]
    assert result["pipeline_version"] == "0.1.0"
    assert result["external_operation"] == {"state": "none", "may_still_run": False}
    assert tasks.get_task(store, result["id"]) == result
    record = tasks.get_record(store, result["id"])
    context = json.loads(record["stage_context_json"])
    assert context["input_files"] == {"video": record["input_path"]}
    reference = context["credential_refs"]["openai"]
    assert store.credentials.get(reference) == "original-key"
    serialized = json.dumps(result)
    assert reference not in serialized
    assert str(store.root) not in serialized
    assert "original-key" not in serialized
    with store.connect() as conn:
        assert "original-key" not in "\n".join(conn.iterdump())
    listed = tasks.list_tasks(store)
    assert TaskList.model_validate(listed).items[0].id == result["id"]
    assert not {"config", "resolved_connections", "outputs", "pipeline_version"}.intersection(listed["items"][0])


def test_missing_and_duplicate_tasks_return_contract_errors(store, create):
    task_id = str(uuid4())
    assert tasks.get_record(store, task_id) is None
    with pytest.raises(ApiError) as missing:
        tasks.get_task(store, task_id)
    assert missing.value.status_code == 404
    assert missing.value.content["error"]["code"] == "TASK_NOT_FOUND"
    original = create(task_id=task_id)
    with pytest.raises(ApiError) as duplicate:
        create(task_id=task_id)
    assert duplicate.value.status_code == 409
    assert duplicate.value.content["error"]["code"] == "TASK_EXISTS"
    assert tasks.get_task(store, task_id) == original


def test_config_connection_and_credential_snapshots_survive_default_changes(store, create, config):
    original = create()
    original_record = tasks.get_record(store, original["id"])
    reference = json.loads(original_record["stage_context_json"])["credential_refs"]["openai"]
    config.target_language = "ja"
    store.patch_settings(SettingsPatch.model_validate({"connection": {
        "adapter": "openai", "base_url": "https://new.example.test/v1", "api_key": "new-key",
    }}))
    assert tasks.get_task(store, original["id"]) == original
    assert tasks.get_record(Store(store.root, store.credentials), original["id"]) == original_record
    assert store.credentials.get(reference) == "original-key"
    assert original["resolved_connections"] == [{"adapter": "openai", "base_url": "https://example.test/v1"}]


def test_task_creation_rejects_unavailable_models_and_missing_credentials(store, create, runtime):
    runtime["capabilities"][0].update(available=False, unavailable_reason="Model assets missing.")
    with pytest.raises(ApiError) as unavailable:
        create()
    assert unavailable.value.content["error"]["code"] == "MODEL_NOT_READY"
    runtime["capabilities"][0].update(available=True, unavailable_reason=None)
    store.patch_settings(SettingsPatch.model_validate({"connection": {"adapter": "openai", "api_key": None}}))
    with pytest.raises(ApiError) as missing_key:
        create()
    assert missing_key.value.content["error"]["field"] == "translation.adapter"
    assert tasks.list_tasks(store)["items"] == []


def test_list_filters_and_pagination_are_ordered_and_exclude_private_fields(store, create):
    ids = [f"00000000-0000-0000-0000-{index:012d}" for index in range(1, 4)]
    for task_id in ids:
        create(task_id=task_id)
    tasks.update_task(store, ids[1], 1, "queued", status="cancelled", finished_at=NOW)
    first = tasks.list_tasks(store, limit=2)
    assert [item["id"] for item in first["items"]] == [ids[2], ids[1]]
    assert first["has_more"] is True
    last = tasks.list_tasks(store, limit=2, offset=2)
    assert [item["id"] for item in last["items"]] == [ids[0]]
    assert last["has_more"] is False
    assert [item["id"] for item in tasks.list_tasks(store, active=False)["items"]] == [ids[1]]
    assert len(tasks.list_tasks(store, active=True)["items"]) == 2
    assert len(tasks.list_tasks(store, status="cancelled")["items"]) == 1


@pytest.mark.parametrize("query", [
    {"limit": 0}, {"limit": 101}, {"offset": -1}, {"active": "true"},
    {"status": "unknown"}, {"status": "queued", "active": False},
])
def test_invalid_list_queries_are_rejected(store, query):
    with pytest.raises(ApiError) as error:
        tasks.list_tasks(store, **query)
    assert error.value.content["error"]["code"] == "INVALID_CONFIG"


def test_update_rejects_expired_attempt_status_and_immutable_fields(store, create, monkeypatch):
    task = create()
    task_id = task["id"]
    monkeypatch.setattr(tasks, "now_iso", lambda: LATER)
    assert not tasks.update_task(store, task_id, 2, "queued", status_message="stale attempt")
    assert not tasks.update_task(store, task_id, 1, "running", status_message="stale status")
    assert tasks.get_task(store, task_id) == task
    assert tasks.update_task(store, task_id, 1, {"queued", "running"}, status_message="Ready", stage_progress=0.25)
    updated = tasks.get_task(store, task_id)
    assert updated["message"] == "Ready"
    assert updated["stage_progress"] == 0.25
    assert updated["updated_at"] == LATER
    with pytest.raises(ValueError, match="Unsupported task update"):
        tasks.update_task(store, task_id, 1, "queued", config_json={})
    context = json.loads(tasks.get_record(store, task_id)["stage_context_json"])
    context["resolved_connections"][0]["base_url"] = "https://changed.example.test/v1"
    with pytest.raises(ValueError, match="immutable"):
        tasks.update_task(store, task_id, 1, "queued", stage_context_json=context)
    assert tasks.get_task(store, task_id) == updated


def test_failed_and_remote_uncertain_actions_are_explicit(store, create):
    task_id = create()["id"]
    assert tasks.update_task(store, task_id, 1, "queued", status="failed", error_json=ERROR, finished_at=NOW)
    assert tasks.get_task(store, task_id)["allowed_actions"] == ["retry", "rerun", "delete"]
    context = json.loads(tasks.get_record(store, task_id)["stage_context_json"])
    for state in ("pending", "unknown"):
        context["external_operation"] = {"state": state, "may_still_run": True}
        assert tasks.update_task(store, task_id, 1, "failed", stage_context_json=context)
        assert tasks.get_task(store, task_id)["allowed_actions"] == ["rerun", "delete"]


def test_worker_from_previous_attempt_cannot_overwrite_retry(store, create):
    task_id = create()["id"]
    tasks.claim_next(store)
    tasks.update_task(store, task_id, 1, "running", status="failed", error_json=ERROR, finished_at=NOW)
    # The retry action owns the separate transaction that increments attempt.
    with store.connect() as conn:
        conn.execute(
            "UPDATE tasks SET attempt=2,status='queued',error_json=NULL,finished_at=NULL,started_at=NULL WHERE id=?",
            (task_id,),
        )
    current = tasks.claim_next(store)
    assert current["attempt"] == 2
    assert not tasks.update_task(store, task_id, 1, "running", status="failed", error_json=ERROR, finished_at=NOW)
    assert tasks.get_record(store, task_id) == current


def test_success_requires_actual_output_descriptors_and_terminal_timestamp(store, create):
    task_id = create()["id"]
    with pytest.raises(ValidationError, match="missing outputs"):
        tasks.update_task(store, task_id, 1, "queued", status="succeeded", current_stage="done", finished_at=NOW)
    assert tasks.get_task(store, task_id)["status"] == "queued"
    outputs = {
        "video": {"url": f"/api/v1/tasks/{task_id}/outputs/video", "file_name": "result.mp4",
                  "mime_type": "video/mp4", "size_bytes": 100, "duration_ms": 1000, "timeline": "source"},
    }
    for name in ("source_subtitles", "translated_subtitles"):
        outputs[name] = {"url": f"/api/v1/tasks/{task_id}/outputs/{name}", "file_name": name + ".srt",
                         "mime_type": "application/x-subrip", "size_bytes": 20, "duration_ms": None, "timeline": "source"}
    assert tasks.update_task(store, task_id, 1, "queued", status="succeeded", current_stage="done", finished_at=NOW,
                             outputs_json=outputs)
    assert tasks.get_task(store, task_id)["allowed_actions"] == ["rerun", "delete"]


def test_concurrent_claims_have_one_winner_and_do_not_skip_active_task(store, create):
    for index in range(1, 4):
        create(task_id=f"00000000-0000-0000-0000-{index:012d}")
    barrier = Barrier(2)

    def claim():
        barrier.wait()
        return tasks.claim_next(store)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(claim) for _ in range(2)]
        results = [future.result(timeout=10) for future in futures]
    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    record = winners[0]
    assert record["id"].endswith("000000000001")
    assert record["status"] == "running"
    assert record["started_at"] == NOW
    assert tasks.claim_next(store) is None
    tasks.update_task(store, record["id"], 1, "running", status="cancelling")
    assert tasks.claim_next(store) is None
    tasks.update_task(store, record["id"], 1, "cancelling", status="cancelled", finished_at=NOW)
    assert tasks.claim_next(store)["id"].endswith("000000000002")


def test_between_stage_queue_keeps_same_task_ahead_of_earlier_queued_peers(store, create):
    first = create(task_id="00000000-0000-0000-0000-000000000001")
    second = create(task_id="00000000-0000-0000-0000-000000000002")
    assert tasks.claim_next(store)["id"] == first["id"]
    tasks.update_task(store, first["id"], 1, "running", status="queued", current_stage="asr", queued_at=LATER)
    resumed = tasks.claim_next(store)
    assert resumed["id"] == first["id"]
    assert resumed["current_stage"] == "asr"
    assert tasks.get_task(store, second["id"])["started_at"] is None


def test_waiting_reserves_slot_and_due_poll_resumes_same_task(store, create, monkeypatch):
    first = create()
    record = tasks.claim_next(store)
    create()
    context = json.loads(record["stage_context_json"])
    context.update(next_poll_at=LATER, external_operation={"state": "pending", "may_still_run": True})
    tasks.update_task(store, first["id"], 1, "running", status="waiting", current_stage="asr",
                      wait_reason="remote_result", stage_context_json=context)
    assert tasks.claim_next(store) is None
    monkeypatch.setattr(tasks, "now_iso", lambda: LATER)
    resumed = tasks.claim_next(store)
    assert resumed["id"] == first["id"]
    assert resumed["status"] == "running"
    assert resumed["started_at"] == NOW
    assert resumed["wait_reason"] is None


def test_invalid_wait_schedule_raises_instead_of_starting_another_task(store, create):
    first = create()
    tasks.claim_next(store)
    create()
    tasks.update_task(store, first["id"], 1, "running", status="waiting")
    with pytest.raises(ValueError, match="missing next_poll_at"):
        tasks.claim_next(store)
    assert tasks.get_task(store, first["id"])["status"] == "waiting"

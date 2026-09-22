from __future__ import annotations

import json
import asyncio
import shutil
import subprocess
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.app import auth, database, main, worker
from backend.app.config import ffmpeg_binary
from backend.app.v1 import actions, executor, files, media, router, tasks
from backend.app.v1.contracts import Task, TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.runtime import RUNTIME_LIMITS
from backend.app.v1.steps import Completed, Waiting
from backend.app.v1.storage import Store
from backend.tests.conftest import TEST_AUTH_PASSWORD
from backend.tests.test_v1_tasks import config, runtime, store  # shared isolated fixtures


@pytest.mark.parametrize("terminal", [None, "succeeded", "failed"])
def test_sync_remote_state_is_durable_before_call_and_cleared_only_on_receipt(client, store, config, video, terminal):
    task_id = upload(client, video, config).json()["id"]

    def remote(context, progress):
        context.set_external_state("pending")
        assert tasks.get_task(store, task_id)["external_operation"] == {"state": "pending", "may_still_run": True}
        if terminal:
            context.set_external_state(terminal)
        raise ApiError(502, "INVALID_PROVIDER_RESULT", "Invalid test response")

    executor.run_step(store, tasks.claim_next(store), remote)
    result = tasks.get_task(store, task_id)
    assert result["external_operation"] == {"state": terminal or "unknown", "may_still_run": terminal is None}
    assert ("retry" in result["allowed_actions"]) == (terminal is not None)


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    path = tmp_path_factory.mktemp("v1-task-media") / "sample.mp4"
    subprocess.run([ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True, timeout=30)
    return path


@pytest.fixture
def client(monkeypatch, tmp_path, store, runtime):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "auth.sqlite")
    database.init_db()
    main.app.dependency_overrides[router.get_store] = lambda: store
    monkeypatch.setattr(router, "runtime_snapshot", lambda settings: {**runtime, "limits": dict(RUNTIME_LIMITS)})
    enqueued = []
    monkeypatch.setattr(worker, "enqueue", enqueued.append)
    client = TestClient(main.app)
    login = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    assert login.status_code == 200
    client.headers[auth.CSRF_HEADER_NAME] = login.json()["csrf_token"]
    client.enqueued = enqueued
    yield client
    client.close()
    main.app.dependency_overrides.pop(router.get_store, None)


def upload(client, video, config, task_id=None, *, filename="sample.mp4"):
    return client.post("/api/v1/tasks", data={"id": task_id or str(uuid4())}, files={
        "file": (filename, video.read_bytes(), "video/mp4"),
        "config": ("blob", config.model_dump_json(), "application/json"),
    })


def test_multipart_blob_import_preserves_id_config_and_private_input(client, store, config, video):
    task_id = str(uuid4())
    response = upload(client, video, config, task_id, filename="C:\\fakepath\\Original clip.mp4")
    assert response.status_code == 201, response.text
    result = Task.model_validate(response.json())
    assert result.id == task_id
    assert result.source_name == "Original clip.mp4"
    assert result.config == config
    assert result.status == "queued" and result.attempt == 1
    assert client.enqueued == [f"mvp-{task_id}"]
    assert (store.root / "tasks" / task_id / "input/source.mp4").read_bytes() == video.read_bytes()
    assert "original-key" not in response.text and "credential_ref" not in response.text
    assert client.get(f"/api/v1/tasks/{task_id}").json() == response.json()


def test_duplicate_import_does_not_replace_input_or_enqueue_again(client, store, config, video):
    task_id = str(uuid4())
    assert upload(client, video, config, task_id).status_code == 201
    again = upload(client, video, config, task_id)
    assert again.status_code == 409 and again.json()["error"]["code"] == "TASK_EXISTS"
    assert len(client.enqueued) == 1
    assert (store.root / "tasks" / task_id / "input/source.mp4").read_bytes() == video.read_bytes()


def test_upload_failure_keeps_same_id_residue_visible(client, store, config, video, monkeypatch):
    original = router.runtime_snapshot
    monkeypatch.setattr(router, "runtime_snapshot", lambda settings: {
        **original(settings), "limits": {**RUNTIME_LIMITS, "max_file_bytes": 1},
    })
    task_id = str(uuid4())
    response = upload(client, video, config, task_id)
    assert response.status_code == 413 and tasks.get_record(store, task_id) is None
    assert (store.root / "tasks" / task_id).is_dir()
    assert upload(client, video, config, task_id).json()["error"]["code"] == "IMPORT_RESIDUE"
    assert client.enqueued == []


@pytest.mark.parametrize("task_id", ["../escape", "not-a-uuid"])
def test_upload_id_cannot_escape_task_directory(client, store, config, video, task_id):
    assert upload(client, video, config, task_id).status_code == 422
    assert tasks.list_tasks(store)["items"] == []


def test_task_list_filters_and_not_found_are_structured(client, config, video):
    first = upload(client, video, config).json()["id"]
    second = upload(client, video, config).json()["id"]
    page = client.get("/api/v1/tasks?limit=1&offset=0&active=true").json()
    assert page["has_more"] and len(page["items"]) == 1
    assert page["items"][0]["id"] in {first, second}
    assert "config" not in page["items"][0]
    invalid = client.get("/api/v1/tasks?status=queued&active=false")
    assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "INVALID_CONFIG"
    missing = client.get(f"/api/v1/tasks/{uuid4()}")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "TASK_NOT_FOUND"


def mock_pipeline(context, progress):
    """Only prepare uses real media; remaining steps are explicit test doubles."""
    progress(0.5, "Test step")
    if context.stage == "prepare":
        return media.prepare(context, progress)
    if context.stage != "export":
        result = context.work_dir / f"{context.stage}.json"
        result.write_text('{"mock":true}')
        return Completed({context.stage: result})
    output = context.work_dir.parent / "output"
    video = output / "video.mp4"
    shutil.copyfile(context.input_files["video"], video)
    files = {"video": video}
    for kind in ("source_subtitles", "translated_subtitles"):
        path = output / f"{kind}.srt"
        path.write_text("1\n00:00:00,000 --> 00:00:01,000\nMock subtitle\n")
        files[kind] = path
    return Completed(files)


def test_task_pipeline_reaches_registered_outputs_and_serves_ranges(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    seen = []
    def step(context, progress):
        seen.append(context.stage)
        return mock_pipeline(context, progress)
    executor.run_task(store, task_id, step)
    result = client.get(f"/api/v1/tasks/{task_id}").json()
    assert result["status"] == "succeeded", result
    assert result["source_duration_ms"] >= 1000
    assert seen == ["prepare", "asr", "translate", "export"]
    assert set(result["outputs"]) == {"video", "source_subtitles", "translated_subtitles"}
    url = result["outputs"]["video"]["url"]
    full = client.get(url)
    assert full.status_code == 200 and full.content == video.read_bytes()
    part = client.get(url, headers={"Range": "bytes=0-15"})
    assert part.status_code == 206 and part.content == full.content[:16]
    assert client.get(url, headers={"Range": "bytes=-16"}).content == full.content[-16:]
    long_suffix = client.get(url, headers={"Range": "bytes=-999999999"})
    assert long_suffix.status_code == 206 and long_suffix.content == full.content
    head = client.head(url, headers={"Range": "bytes=0-15"})
    assert head.status_code == 200 and not head.content
    assert int(head.headers["content-length"]) == len(full.content)
    invalid = client.get(url, headers={"Range": "bytes=0-1,3-4"})
    assert invalid.status_code == 416 and invalid.json()["error"]["code"] == "RANGE_NOT_SATISFIABLE"
    assert invalid.headers["content-range"] == f"bytes */{len(full.content)}"
    assert "attachment" in client.get(url + "?download=true").headers["content-disposition"]
    subtitle = client.get(result["outputs"]["source_subtitles"]["url"], headers={"Range": "bytes=0-1"})
    assert subtitle.status_code == 200 and b"Mock subtitle" in subtitle.content
    assert len(client.get(f"/api/v1/tasks/{task_id}/log?lines=2").text.splitlines()) == 2


def test_remote_poll_uses_same_id_and_holds_single_task_slot(client, store, config, video):
    first = upload(client, video, config).json()["id"]
    second = upload(client, video, config).json()["id"]
    # Equal fixture timestamps use UUID order, so retain the actual first claim.
    record = tasks.claim_next(store)
    active = record["id"]
    executor.run_step(store, record, mock_pipeline)
    record = tasks.claim_next(store)
    executor.run_step(store, record, lambda context, progress: Waiting("remote-operation-1", "2099-01-01T00:00:00.000Z"))
    assert tasks.claim_next(store) is None
    waiting = tasks.get_record(store, active)
    saved = json.loads(waiting["stage_context_json"])
    saved["next_poll_at"] = "2020-01-01T00:00:00.000Z"
    tasks.update_task(store, active, 1, "waiting", stage_context_json=saved)
    def poll(context, progress):
        assert context.remote_task_id == "remote-operation-1"
        return mock_pipeline(context, progress)
    executor.run_step(store, tasks.claim_next(store), poll)
    assert tasks.get_task(store, active)["external_operation"] == {"state": "succeeded", "may_still_run": False}
    other = second if active == first else first
    assert tasks.get_task(store, other)["started_at"] is None


def test_worker_token_order_cannot_leave_a_queued_task_stranded(client, store, config, video):
    # The DB can order tasks differently from the in-memory enqueue calls.
    later = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    earlier = "00000000-0000-4000-8000-000000000001"
    assert upload(client, video, config, later).status_code == 201
    assert upload(client, video, config, earlier).status_code == 201
    seen = []

    def fail(context, progress):
        seen.append(context.task_id)
        raise RuntimeError("intentional test failure")

    for token in client.enqueued:
        executor.run_task(store, token.removeprefix("mvp-"), fail)
    assert seen == [earlier, later]
    assert tasks.get_task(store, later)["status"] == "failed"
    assert tasks.get_task(store, earlier)["status"] == "failed"


def test_failed_step_is_visible_and_secrets_are_redacted(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    def fail(context, progress):
        raise RuntimeError("provider rejected original-key")
    executor.run_task(store, task_id, fail)
    response = client.get(f"/api/v1/tasks/{task_id}")
    assert response.json()["status"] == "failed"
    assert response.json()["error"]["stage"] == "prepare"
    log = client.get(f"/api/v1/tasks/{task_id}/log").text
    assert "RuntimeError" in log and "[redacted]" in log
    assert "original-key" not in log + response.text


def test_export_cannot_succeed_with_missing_artifacts(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    def step(context, progress):
        if context.stage == "export":
            return Completed({})
        return mock_pipeline(context, progress)
    executor.run_task(store, task_id, step)
    result = tasks.get_task(store, task_id)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "STAGE_OUTPUT_MISSING"
    assert result["outputs"] == {}


def test_startup_reports_interrupted_steps_without_resubmission(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    tasks.claim_next(store)
    assert executor.startup_tasks(store) == []
    result = tasks.get_task(store, task_id)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "APP_INTERRUPTED"


def test_shared_worker_dispatches_legacy_and_v1_without_new_executor_thread(monkeypatch, store):
    calls = []
    monkeypatch.setattr(main, "get_v1_store", lambda: store)
    monkeypatch.setattr(main, "run_task", lambda task_id: calls.append(("legacy", task_id)))
    monkeypatch.setattr(main.v1_executor, "run_task", lambda selected, task_id: calls.append((selected, task_id)))
    main.dispatch_task("legacy-id")
    main.dispatch_task("mvp-123")
    assert calls == [("legacy", "legacy-id"), (store, "123")]


def test_cancel_retry_rerun_and_delete_api(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    url = f"/api/v1/tasks/{task_id}"
    assert client.delete(url).json()["error"]["code"] == "TASK_BUSY"
    assert client.post(url + "/cancel").json()["status"] == "cancelled"
    retried = client.post(url + "/retry", json={"expected_attempt": 1})
    assert retried.status_code == 200 and retried.json()["attempt"] == 2
    assert client.post(url + "/retry", json={"expected_attempt": 1}).json()["attempt"] == 2
    assert client.post(url + "/retry", json={"expected_attempt": 4}).status_code == 409
    client.post(url + "/cancel")
    new_id = str(uuid4())
    rerun = client.post(url + "/rerun", json={"id": new_id, "config": config.model_dump(mode="json")})
    assert rerun.status_code == 201 and rerun.json()["attempt"] == 1
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
    assert (store.root / "tasks" / new_id / "input/source.mp4").read_bytes() == video.read_bytes()


def test_local_cancel_is_finalized_only_after_runner_stops(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    seen = []

    def step(context, progress):
        seen.append(context.stage)
        response = client.post(f"/api/v1/tasks/{task_id}/cancel")
        assert response.status_code == 202 and response.json()["status"] == "cancelling"
        assert client.delete(f"/api/v1/tasks/{task_id}").status_code == 409
        context.check_cancel()
        pytest.fail("cancelled local step continued")

    executor.run_task(store, task_id, step)
    result = tasks.get_task(store, task_id)
    assert seen == ["prepare"] and result["status"] == "cancelled"
    assert result["outputs"] == {} and result["error"] is None
    assert "retry" in result["allowed_actions"]


def test_cancellation_preserves_remote_acceptance_during_submit(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]

    def accepted_after_cancel(context, progress):
        client.post(f"/api/v1/tasks/{task_id}/cancel")
        return Waiting("accepted-remote-id", "2099-01-01T00:00:00.000Z")

    executor.run_task(store, task_id, accepted_after_cancel)
    result = tasks.get_task(store, task_id)
    assert result["status"] == "cancelled"
    assert result["external_operation"] == {"state": "unknown", "may_still_run": True}
    assert json.loads(tasks.get_record(store, task_id)["stage_context_json"])["remote_task_id"] == "accepted-remote-id"
    url = f"/api/v1/tasks/{task_id}"
    assert client.post(url + "/retry", json={"expected_attempt": 1}).json()["error"]["code"] == "EXTERNAL_RESULT_UNKNOWN"
    body = {"id": str(uuid4()), "config": config.model_dump(mode="json")}
    assert client.post(url + "/rerun", json=body).status_code == 409
    assert client.post(url + "/rerun", json={**body, "acknowledge_external_risk": True}).status_code == 201


def test_cancel_waiting_stops_polling_without_claiming_remote_cancellation(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    executor.run_step(store, tasks.claim_next(store), lambda context, progress: Waiting("pending", "2099-01-01T00:00:00.000Z"))
    assert client.post(f"/api/v1/tasks/{task_id}/cancel").status_code == 202
    executor.run_task(store, task_id, lambda context, progress: pytest.fail("cancelled remote task was polled"))
    assert tasks.get_task(store, task_id)["status"] == "cancelled"
    assert tasks.get_task(store, task_id)["external_operation"]["may_still_run"]


@pytest.mark.parametrize("cancel", [False, True])
def test_invalid_poll_time_keeps_accepted_remote_receipt(client, store, config, video, cancel):
    task_id = upload(client, video, config).json()["id"]

    def invalid_receipt(context, progress):
        if cancel:
            client.post(f"/api/v1/tasks/{task_id}/cancel")
        return Waiting("accepted-provider-operation", "2026-09-22T12:00:00Z")

    executor.run_task(store, task_id, invalid_receipt)
    task = tasks.get_task(store, task_id)
    assert task["status"] == ("cancelled" if cancel else "failed")
    assert task["external_operation"] == {"state": "unknown", "may_still_run": True}
    assert "retry" not in task["allowed_actions"]
    saved = json.loads(tasks.get_record(store, task_id)["stage_context_json"])
    assert saved["remote_task_id"] == "accepted-provider-operation"


def test_download_blocks_delete_until_response_is_closed(client, store, config, video):
    task_id = upload(client, video, config).json()["id"]
    executor.run_task(store, task_id, mock_pipeline)
    scope = {"type": "http", "method": "GET", "path": "/", "headers": []}
    response = files.output_response(store, task_id, "video", Request(scope), False)
    with pytest.raises(ApiError) as error:
        actions.delete_task(store, task_id)
    assert error.value.content["error"]["code"] == "TASK_BUSY"

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body":
            raise ConnectionError("test client disconnected")

    with pytest.raises(ConnectionError):
        asyncio.run(response(scope, receive, send))
    actions.delete_task(store, task_id)
    assert tasks.get_record(store, task_id) is None

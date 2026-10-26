from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest

from backend.workers.bridge import Bridge
from backend.workers.protocol import WorkerError
from backend.workers.store import SqliteStore

NOW = "2026-10-08T08:00:00.000Z"
LATER = "2026-10-08T08:00:01.000Z"


def task(**changes):
    return {"id": str(uuid4()), "revision": 0, "attempt": 1, "status": "queued",
            "createdAt": NOW, "updatedAt": NOW, "queuedAt": NOW, "startedAt": None, "finishedAt": None,
            "nextPollAt": None, "sourceName": "clip.mp4", "plan": {"steps": [{"id": "third-party-step"}]},
            "config": {}, "inputs": {}, "steps": [], "artifacts": {}, "outputs": [],
            "workflowId": "third-party", "workflowVersion": "1", "credentialRefs": {}, "connections": [],
            "externalRequests": {}, "error": None, **changes}


def old_database(root, status="succeeded"):
    root.mkdir()
    path = root / "desktop.sqlite"
    with sqlite3.connect(path) as conn:
        conn.executescript((Path(__file__).parents[1] / "app" / "v1" / "schema.sql").read_text())
        record = {"id": str(uuid4()), "attempt": 3, "source_name": "old.mp4", "source_size_bytes": 128,
                  "source_duration_ms": 1000, "input_path": str(root / "input.mp4"), "config_json": "{}",
                  "status": status, "current_stage": "done" if status == "succeeded" else "asr", "stage_progress": 1,
                  "wait_reason": None, "status_message": "original message", "outputs_json": "{}",
                  "stage_context_json": '{"external_operation":{"state":"none","may_still_run":false}}',
                  "error_json": None, "created_at": NOW, "updated_at": NOW, "queued_at": NOW,
                  "started_at": NOW, "finished_at": NOW if status == "succeeded" else None}
        conn.execute(f"INSERT INTO tasks ({','.join(record)}) VALUES ({','.join('?' for _ in record)})", tuple(record.values()))
    return record


def test_schema_migration_preserves_all_historical_values(tmp_path):
    root = tmp_path / "data"
    raw = old_database(root)
    store = SqliteStore(root)
    history = store.get(raw["id"])
    assert history["legacy"] is True
    for key, value in raw.items():
        assert history["rawSnapshot"][key] == value
    created = store.create(task())
    assert created["plan"]["steps"][0]["id"] == "third-party-step"
    with store.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
        assert conn.execute("SELECT current_stage FROM tasks WHERE id=?", (created["id"],)).fetchone()[0] is None


def test_active_legacy_task_stops_migration_without_changing_schema_or_record(tmp_path):
    root = tmp_path / "data"
    raw = old_database(root, "waiting")
    with pytest.raises(WorkerError) as caught:
        SqliteStore(root)
    assert caught.value.code == "MIGRATION_ACTIVE_TASKS"
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert dict(conn.execute("SELECT * FROM tasks").fetchone()) == raw


def test_two_connections_can_only_claim_one_task_and_waiting_keeps_slot(tmp_path):
    store = SqliteStore(tmp_path / "data")
    one, two = store.create(task()), store.create(task())
    barrier = Barrier(2)
    def claim():
        another = SqliteStore(store.root)
        barrier.wait()
        return another.claim(NOW)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: claim(), range(2)))
    assert sum(item is not None for item in results) == 1
    active = next(item for item in results if item)
    waiting = store.cas(active["id"], active["revision"], {**active, "status": "waiting", "nextPollAt": LATER})
    assert store.claim(NOW) is None
    resumed = store.claim(LATER)
    assert resumed["id"] == active["id"] and resumed["status"] == "running"
    assert store.get((two if one["id"] == active["id"] else one)["id"])["status"] == "queued"


def test_cas_rejects_late_writes_and_mutated_execution_snapshot(tmp_path):
    store = SqliteStore(tmp_path)
    original = store.create(task())
    updated = store.cas(original["id"], original["revision"], {**original, "message": "first"})
    with pytest.raises(WorkerError) as error:
        store.cas(original["id"], original["revision"], {**original, "message": "late"})
    assert error.value.code == "REVISION_CONFLICT"
    with pytest.raises(WorkerError) as error:
        store.cas(updated["id"], updated["revision"], {**updated, "plan": {"steps": []}})
    assert error.value.code == "IMMUTABLE_SNAPSHOT"
    assert store.get(updated["id"])["message"] == "first"


def test_v2_migration_is_transactional_and_preserves_terminal_tasks(tmp_path):
    root = tmp_path / "data"
    previous = SqliteStore(root)
    record = previous.create(task(status="succeeded", finishedAt=NOW))
    with previous.connect() as conn:
        conn.execute("DROP TABLE workflow_documents")
        conn.execute("PRAGMA user_version=2")
    reopened = SqliteStore(root)
    assert reopened.get(record["id"]) == record
    assert reopened.workflow_list()["items"] == []
    active = reopened.create(task())
    with reopened.connect() as conn:
        conn.execute("DROP TABLE workflow_documents")
        conn.execute("PRAGMA user_version=2")
    with pytest.raises(WorkerError) as error:
        SqliteStore(root)
    assert error.value.code == "MIGRATION_ACTIVE_TASKS"
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
        assert conn.execute("SELECT status FROM tasks WHERE id=?", (active["id"],)).fetchone()[0] == "queued"
        assert not conn.execute("SELECT name FROM sqlite_master WHERE name='workflow_documents'").fetchone()


def test_paused_task_is_active_but_releases_execution_slot_and_survives_restart(tmp_path):
    store = SqliteStore(tmp_path)
    paused = store.create(task(status="paused", graphSnapshot={"id": "review"},
                               steps=[{"id": "recognize", "status": "awaiting_review"}]))
    queued = store.create(task())
    assert len(store.list(active=True)["items"]) == 2
    claimed = store.claim(NOW)
    assert claimed["id"] == queued["id"]
    reopened = SqliteStore(tmp_path)
    assert reopened.get(paused["id"]) == paused
    for name in ("graphSnapshot", "workflowSource", "nodeRuntimeInputs"):
        with pytest.raises(WorkerError) as error:
            reopened.cas(paused["id"], paused["revision"], {**paused, name: {"changed": True}})
        assert error.value.code == "IMMUTABLE_SNAPSHOT"


def test_multiple_review_nodes_persist_without_claiming_the_execution_slot(tmp_path):
    store = SqliteStore(tmp_path)
    paused = store.create(task(status="paused", graphSnapshot={"id": "branches"}, steps=[
        {"id": "left", "status": "awaiting_review"},
        {"id": "right", "status": "awaiting_review"},
        {"id": "join", "status": "pending"},
    ]))
    assert store.claim(NOW) is None
    assert SqliteStore(tmp_path).get(paused["id"]) == paused
    with pytest.raises(WorkerError) as error:
        store.create(task(status="paused", steps=[]))
    assert error.value.code == "INVALID_TASK"


def test_workflow_crud_roundtrip_and_concurrent_saves_keep_winning_document(tmp_path):
    bridge = Bridge(tmp_path)
    document = {"id": "user-subtitles", "title": "字幕", "nodes": [{"id": "recognize"}], "edges": []}
    saved = bridge.call("store.workflow_create", {"document": document})
    assert saved["document"] == document and saved["revision"] == 1
    changed = {**document, "title": "配音"}
    updated = bridge.call("store.workflow_update", {"id": document["id"], "expectedRevision": 1, "document": changed})
    assert updated["revision"] == 2
    with pytest.raises(WorkerError) as error:
        bridge.call("store.workflow_update", {"id": document["id"], "expectedRevision": 1, "document": document})
    assert error.value.code == "REVISION_CONFLICT"
    assert bridge.call("store.workflow_get", {"id": document["id"]})["document"] == changed
    assert bridge.call("store.workflow_list", {})["items"] == [updated]
    with pytest.raises(WorkerError) as error:
        bridge.call("store.workflow_delete", {"id": document["id"], "expectedRevision": 1})
    assert error.value.code == "REVISION_CONFLICT"
    bridge.call("store.workflow_delete", {"id": document["id"], "expectedRevision": 2})
    assert bridge.call("store.workflow_list", {})["items"] == []


def test_legacy_input_is_registered_only_within_its_own_task_directory(tmp_path):
    root = tmp_path / "data"
    raw = old_database(root)
    source = root / "tasks" / raw["id"] / "input" / "source.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        conn.execute("UPDATE tasks SET input_path=?", (str(source),))
    store = SqliteStore(root)
    migrated = store.get(raw["id"])
    artifact = migrated["artifacts"][migrated["inputs"]["video"]["id"]]
    assert artifact["invocationId"] == "input" and artifact["path"] == "input/source.mp4"
    with store.connect() as conn:
        conn.execute("UPDATE tasks SET input_path=?", (str(Path(__file__)),))
    assert store.get(raw["id"])["inputs"] == {}


def test_legacy_outputs_register_only_existing_files_inside_task_directory(tmp_path):
    root = tmp_path / "data"
    raw = old_database(root)
    output = root / "tasks" / raw["id"] / "output" / "video.mp4"
    output.parent.mkdir(parents=True)
    output.write_bytes(b"video")
    public = {"mime_type": "video/mp4", "file_name": "video.mp4", "size_bytes": 5}
    paths = {"video": "output/video.mp4", "outside": str(Path(__file__)), "missing": "output/missing.mp4"}
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        conn.execute("UPDATE tasks SET outputs_json=?,stage_context_json=?",
                     (json.dumps({key: public for key in paths}), json.dumps({"output_paths": paths})))
    migrated = SqliteStore(root).get(raw["id"])
    assert [output["id"] for output in migrated["outputs"]] == ["video"]
    assert next(iter(migrated["artifacts"].values()))["path"] == "output/video.mp4"


def test_local_runtime_probe_dispatches_to_provider(tmp_path, monkeypatch):
    from backend.app.v1 import runtime
    bridge = Bridge(tmp_path)
    monkeypatch.setattr(runtime, "probe_capability", lambda adapter: {"adapter": adapter})
    assert bridge.call("runtime.probe", {"adapter": "whisper"}) == {"adapter": "whisper"}


def test_local_runtime_probe_refreshes_media_paths_after_installation(tmp_path, monkeypatch):
    import os
    from backend.app.v1 import runtime
    from backend.app.config import ffmpeg_binary, ffprobe_binary
    monkeypatch.setenv("FFMPEG_PATH", "not-yet-installed/ffmpeg.exe")
    monkeypatch.setenv("FFPROBE_PATH", "not-yet-installed/ffprobe.exe")
    monkeypatch.setenv("PATH", "system-tools")
    bridge = Bridge(tmp_path)
    monkeypatch.setattr(runtime, "probe_capability", lambda adapter: (ffmpeg_binary(), ffprobe_binary(), os.environ["PATH"]))
    installed = {"FFMPEG_PATH": "installed/bin/ffmpeg.exe", "FFPROBE_PATH": "installed/bin/ffprobe.exe", "PATH": "installed/bin;system-tools"}
    assert bridge.call("runtime.probe", {"adapter": "whisper", "mediaEnvironment": installed}) == tuple(installed.values())


def test_current_store_rejects_redirected_database_without_touching_target(tmp_path):
    from backend.app.runtime_security import RuntimeSecurityError
    root = tmp_path / "store"
    root.mkdir()
    outside = tmp_path / "outside.sqlite"
    outside.write_bytes(b"existing-data")
    try:
        (root / "desktop.sqlite").symlink_to(outside)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 1314:
            pytest.skip("File symlinks require Windows Developer Mode or administrator privileges.")
        raise
    with pytest.raises(RuntimeSecurityError):
        SqliteStore(root)
    assert outside.read_bytes() == b"existing-data"

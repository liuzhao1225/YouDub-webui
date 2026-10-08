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
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
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


class Credentials:
    def __init__(self):
        self.values = {}
    def get(self, ref):
        return self.values.get(ref)
    def set(self, ref, value):
        self.values[ref] = value
    def delete(self, ref):
        del self.values[ref]


def test_rotated_connection_keeps_credentials_pinned_by_plugin_task(tmp_path):
    credentials = Credentials()
    bridge = Bridge(tmp_path, credentials=credentials)
    bridge.call("settings.patch", {"patch": {"connection": {"adapter": "openai", "base_url": "https://example.test/v1", "api_key": "first-key"}}})
    ref = bridge.call("settings.raw", {})["connections"][0]["credential_ref"]
    bridge.store.create(task(credentialRefs={"openai": ref}))
    result = bridge.call("settings.patch", {"patch": {"connection": {"adapter": "openai", "api_key": "second-key"}}})
    assert credentials.get(ref) == "first-key"
    assert result["connections"][0]["has_api_key"] is True
    assert "first-key" not in json.dumps(result) and "second-key" not in json.dumps(result)


def test_auth_records_migrate_once_and_login_reservation_is_atomic(tmp_path):
    old = tmp_path / "old.sqlite"
    with sqlite3.connect(old) as conn:
        conn.execute("CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,credential_version TEXT,created_at TEXT,expires_at TEXT)")
        conn.execute("INSERT INTO auth_sessions VALUES('token','credential',?,?)", (NOW, LATER))
        conn.execute("INSERT INTO auth_sessions VALUES('second','credential-2',?,?)", (NOW, LATER))
    original_bytes = old.read_bytes()
    store = SqliteStore(tmp_path / "data", old)
    assert store.auth("get_session", {"token_hash": "token"})["credential_version"] == "credential"
    assert store.auth("get_session", {"token_hash": "second"})["credential_version"] == "credential-2"
    store.auth("delete_session", {"token_hash": "token"})
    reopened = SqliteStore(store.root, old)
    assert reopened.auth("get_session", {"token_hash": "token"}) is None
    assert reopened.auth("get_session", {"token_hash": "second"})["credential_version"] == "credential-2"
    assert old.read_bytes() == original_bytes
    params = {"client_hash": "client", "now": NOW, "stale_before": "2026-10-08T07:59:00.000Z", "max_attempts": 2}
    assert store.auth("reserve_login_attempt", params)["allowed"] is True
    assert store.auth("reserve_login_attempt", params)["allowed"] is True
    assert store.auth("reserve_login_attempt", params) == {"allowed": False, "window_started_at": NOW}


def test_local_runtime_probe_does_not_read_credentials(tmp_path, monkeypatch):
    from backend.app.v1 import runtime
    bridge = Bridge(tmp_path, credentials=Credentials())
    monkeypatch.setattr(bridge, "settings", lambda: pytest.fail("local probe must not read keyring"))
    monkeypatch.setattr(runtime, "probe_capability", lambda adapter: {"adapter": adapter})
    assert bridge.call("runtime.probe", {"adapter": "whisper"}) == {"adapter": "whisper"}


def test_settings_connection_omission_rotation_clear_and_address_binding(tmp_path):
    credentials = Credentials()
    bridge = Bridge(tmp_path, credentials=credentials)
    def patch(**values):
        return bridge.call("settings.patch", {"patch": {"connection": {"adapter": "openai", **values}}})
    patch(base_url="https://first.example/v1", api_key="synthetic-secret")
    original = bridge.call("settings.raw", {})["connections"][0]["credential_ref"]
    assert patch(base_url="https://first.example/v1")["connections"][0]["has_api_key"]
    assert bridge.call("settings.raw", {})["connections"][0]["credential_ref"] == original
    patch(api_key="replacement-secret")
    assert original not in credentials.values
    assert len(credentials.values) == 1
    assert not patch(base_url="https://second.example/v1")["connections"][0]["has_api_key"]
    assert not credentials.values
    patch(api_key="last-secret")
    assert not patch(api_key=None)["connections"][0]["has_api_key"]
    assert not credentials.values
    with bridge.store.connect() as conn:
        assert "secret" not in "\n".join(conn.iterdump())


def test_settings_failures_are_visible_before_and_after_credential_write(tmp_path, monkeypatch):
    from backend.app.v1.credentials import CredentialStoreError
    credentials = Credentials()
    bridge = Bridge(tmp_path, credentials=credentials)
    patch = {"connection": {"adapter": "openai", "base_url": "https://example.test/v1", "api_key": "synthetic-key"}}
    with monkeypatch.context() as scoped:
        def fail_keyring(*args):
            raise CredentialStoreError("keyring locked")
        scoped.setattr(credentials, "set", fail_keyring)
        with pytest.raises(CredentialStoreError, match="keyring locked"):
            bridge.patch_settings(patch)
    assert bridge.store.settings_values() == {}
    def fail_store(*args):
        raise sqlite3.OperationalError("synthetic write failure")
    monkeypatch.setattr(bridge.store, "write_setting", fail_store)
    with pytest.raises(WorkerError) as error:
        bridge.patch_settings(patch)
    assert error.value.code == "SETTINGS_PARTIALLY_APPLIED"
    assert len(credentials.values) == 1
    assert bridge.store.settings_values() == {}


def test_current_store_rejects_redirected_database_without_touching_target(tmp_path):
    from backend.app.runtime_security import RuntimeSecurityError
    root = tmp_path / "store"
    root.mkdir()
    outside = tmp_path / "outside.sqlite"
    outside.write_bytes(b"existing-data")
    (root / "desktop.sqlite").symlink_to(outside)
    with pytest.raises(RuntimeSecurityError):
        SqliteStore(root)
    assert outside.read_bytes() == b"existing-data"

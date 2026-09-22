from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import auth, database, main
from backend.app.v1 import router, runtime
from backend.app.v1.contracts import SettingsPatch
from backend.app.v1.credentials import CredentialStoreError
from backend.app.v1.errors import ApiError
from backend.app.v1.storage import Store
from backend.tests.conftest import TEST_AUTH_PASSWORD


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
def store(tmp_path):
    return Store(tmp_path / "desktop", MemoryCredentials())


@pytest.fixture
def client(monkeypatch, tmp_path, store):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "auth.sqlite")
    database.init_db()
    main.app.dependency_overrides[router.get_store] = lambda: store
    monkeypatch.setattr(runtime, "_detect_devices", lambda: [
        {"id": "cpu", "name": "CPU", "available": True, "unavailable_reason": None},
    ])
    client = TestClient(main.app)
    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    assert response.status_code == 200
    client.headers[auth.CSRF_HEADER_NAME] = response.json()["csrf_token"]
    yield client
    client.close()
    main.app.dependency_overrides.pop(router.get_store, None)


def patch(client, **connection):
    return client.patch("/api/v1/settings", json={"connection": {"adapter": "openai", **connection}})


def test_initial_settings_and_runtime_use_v1_contract(client):
    assert client.get("/api/v1/settings").json() == {"defaults": None, "connections": [], "ui_language": "en"}
    response = client.get("/api/v1/runtime")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["api_version"] == "v1"
    assert response.json()["limits"]["max_active_tasks"] == 1
    assert all(not item["available"] for item in response.json()["capabilities"])
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ready", "instance_id": response.json()["instance_id"]}


def test_settings_persist_across_store_instances(client, store):
    response = client.patch("/api/v1/settings", json={"ui_language": "zh"})
    assert response.status_code == 200
    assert Store(store.root, store.credentials).read_settings()["ui_language"] == "zh"
    with store.connect() as conn:
        assert {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")} == {"tasks", "settings"}


def test_credential_is_write_only_and_not_stored_in_sqlite(client, store):
    response = patch(client, base_url="https://example.com/v1", api_key="secret-provider-key")
    assert response.status_code == 200
    assert response.json()["connections"] == [{"adapter": "openai", "base_url": "https://example.com/v1", "has_api_key": True}]
    assert "secret-provider-key" not in response.text
    with store.connect() as conn:
        dump = "\n".join(conn.iterdump())
    assert "secret-provider-key" not in dump
    assert "credential_ref" in dump
    assert "secret-provider-key" in store.credentials.values.values()


def test_connection_key_omission_rotation_clear_and_address_binding(client, store):
    assert patch(client, base_url="https://first.example/v1", api_key="key-one").status_code == 200
    first_reference = store._settings_values()["connections"][0]["credential_ref"]
    assert patch(client, base_url="https://first.example/v1").json()["connections"][0]["has_api_key"] is True
    assert patch(client, base_url="https://second.example/v1").json()["connections"][0]["has_api_key"] is False
    assert first_reference not in store.credentials.values
    assert store._settings_values()["connections"][0]["credential_ref"] is None
    assert patch(client, api_key="key-two").json()["connections"][0]["has_api_key"] is True
    second_reference = store._settings_values()["connections"][0]["credential_ref"]
    assert second_reference != first_reference
    assert patch(client, api_key=None).json()["connections"][0]["has_api_key"] is False
    assert second_reference not in store.credentials.values


def test_replaced_keys_are_removed_before_clearing_current_key(client, store):
    assert patch(client, base_url="https://example.com/v1", api_key="key-one").status_code == 200
    assert patch(client, api_key="key-two").status_code == 200
    assert list(store.credentials.values.values()) == ["key-two"]
    assert patch(client, api_key=None).status_code == 200
    assert store.credentials.values == {}


def test_changing_default_connection_preserves_a_task_credential_reference(client, store):
    assert patch(client, base_url="https://example.com/v1", api_key="task-key").status_code == 200
    reference = store._settings_values()["connections"][0]["credential_ref"]
    with store.connect() as conn:
        conn.execute(
            "INSERT INTO tasks (id,source_name,source_size_bytes,input_path,config_json,status,current_stage,"
            "created_at,updated_at,queued_at,stage_context_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            ("8d129c98-8e49-4afb-af3a-0b4da4a5533f", "input.mp4", 10, "input/input.mp4", "{}", "queued", "prepare",
             "2026-09-22T00:00:00.000Z", "2026-09-22T00:00:00.000Z", "2026-09-22T00:00:00.000Z",
             json.dumps({"credential_refs": {"openai": reference}})),
        )
    assert patch(client, api_key="new-default-key").status_code == 200
    assert store.credentials.get(reference) == "task-key"
    assert patch(client, base_url="https://another.example/v1").status_code == 200
    assert list(store.credentials.values.values()) == ["task-key"]


@pytest.mark.parametrize("body", [
    {"ui_language": "zh", "defaults": None},
    {"connection": {"adapter": "openai", "api_key": ""}},
    {"connection": {"adapter": "openai", "base_url": "https://name:secret@example.com"}},
    {"connection": {"adapter": "openai", "base_url": "https://example.com?api_key=secret"}},
    {"connection": {"adapter": "unknown", "base_url": "https://example.com"}},
])
def test_invalid_settings_return_structured_error_without_echoing_secrets(client, body):
    response = client.patch("/api/v1/settings", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CONFIG"
    assert "secret" not in response.text


def test_new_connection_requires_address(client):
    response = patch(client, api_key="new-key")
    assert response.status_code == 422
    assert response.json()["error"]["field"] == "connection.base_url"


def test_v1_uses_existing_session_and_csrf_with_structured_errors(client):
    del client.headers[auth.CSRF_HEADER_NAME]
    assert client.patch("/api/v1/settings", json={"ui_language": "zh"}).json()["error"]["code"] == "CSRF_INVALID"
    client.cookies.clear()
    response = client.get("/api/v1/settings")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_v1_origin_rejection_is_structured(client):
    response = client.patch("/api/v1/settings", json={"ui_language": "zh"}, headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"


def test_os_credential_failure_does_not_claim_save_success(client, store, monkeypatch):
    def unavailable(reference, value):
        raise CredentialStoreError("OS credential store is unavailable.")
    monkeypatch.setattr(store.credentials, "set", unavailable)
    response = patch(client, base_url="https://example.com/v1", api_key="secret-key")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "RUNTIME_UNAVAILABLE"
    assert store.read_settings()["connections"] == []


def test_database_failure_after_credential_write_is_reported_as_partial(client, store, monkeypatch):
    def fail_save(key, value):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(store, "_save_setting", fail_save)
    response = patch(client, base_url="https://example.com/v1", api_key="secret-key")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "SETTINGS_PARTIALLY_APPLIED"
    assert store.credentials.values
    assert store.read_settings()["connections"] == []


def test_defaults_are_saved_by_value(store):
    doc = json.loads((Path(__file__).parents[2] / "docs/design/youdub-api-v0.1.openapi.json").read_text())
    data = doc["paths"]["/api/v1/settings"]["patch"]["requestBody"]["content"]["application/json"]["examples"]["defaults"]["value"]
    patch_body = SettingsPatch.model_validate(data)
    store.patch_settings(patch_body)
    patch_body.defaults.target_language = "ja"
    assert store.read_settings()["defaults"]["target_language"] == "zh"


def test_legacy_database_cannot_be_reinterpreted_as_mvp(tmp_path):
    root = tmp_path / "legacy"
    root.mkdir()
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        conn.execute("CREATE TABLE tasks (id TEXT, url TEXT)")
    with pytest.raises(ApiError, match="new MVP database"):
        Store(root, MemoryCredentials())


def test_invalid_database_returns_an_actionable_api_error(client, tmp_path):
    root = tmp_path / "unsupported"
    root.mkdir()
    with sqlite3.connect(root / "desktop.sqlite") as conn:
        conn.execute("PRAGMA user_version=99")
    main.app.dependency_overrides[router.get_store] = lambda: Store(root, MemoryCredentials())
    response = client.get("/api/v1/settings")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "RUNTIME_UNAVAILABLE"
    assert "99" in response.json()["error"]["message"]

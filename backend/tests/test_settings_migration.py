from copy import deepcopy
import sqlite3

import pytest

from backend.workers.bridge import Bridge
from backend.workers.protocol import WorkerError
from backend.workers.store import SqliteStore


def defaults():
    return {"source_language": "auto", "target_language": "ja", "output_mode": "subtitles", "keep_background": False,
            "asr": {"adapter": "whisper", "model": "small", "device": "cpu", "initial_prompt": "Names"},
            "translation": {"adapter": "openai", "model": "qwen3-max", "device": "remote"}, "tts": None, "separation": None}


def test_connection_model_migration_only_fills_matching_missing_model_and_is_idempotent(tmp_path):
    store = SqliteStore(tmp_path)
    store.write_setting("defaults", defaults())
    connections = [{"adapter": "openai", "base_url": "https://example.test/v1", "credential_ref": "key-ref"},
                   {"adapter": "other", "base_url": "https://other.test/v1", "credential_ref": None}]
    store.write_setting("connections", connections)
    bridge = Bridge(tmp_path)
    migrated = bridge.store.settings_values()
    assert migrated["connections"][0] == {**connections[0], "model": "qwen3-max"}
    assert migrated["connections"][1] == connections[1]
    assert migrated["defaults"] == defaults()
    migrated["connections"][0]["model"] = "new-model"
    bridge.store.write_setting("connections", migrated["connections"])
    reopened = Bridge(tmp_path)
    assert reopened.call("settings.raw", {})["connections"][0]["model"] == "new-model"


def test_empty_install_does_not_create_defaults_or_connection(tmp_path):
    bridge = Bridge(tmp_path)
    assert bridge.store.settings_values() == {}


def test_default_workflow_commit_is_atomic_preserves_source_and_never_recreates_deleted_workflow(tmp_path):
    store = SqliteStore(tmp_path)
    source = defaults()
    store.write_setting("defaults", source)
    store.write_setting("plugin:youdub.localize", {"translationSetupSkipped": True})
    document = {"id": "user.legacy-defaults-v1", "title": "原默认处理配置"}
    with store.connect() as conn:
        conn.execute("CREATE TRIGGER fail_marker BEFORE UPDATE ON settings WHEN NEW.key='plugin:youdub.localize' BEGIN SELECT RAISE(ABORT, 'marker failure'); END")
    with pytest.raises(sqlite3.IntegrityError, match="marker failure"):
        store.workflow_migrate_defaults(document, source)
    assert store.workflow_list()["items"] == []
    assert "defaultsMigration" not in store.settings_values()["plugin:youdub.localize"]
    with store.connect() as conn:
        conn.execute("DROP TRIGGER fail_marker")
    state = store.workflow_migrate_defaults(document, source)
    assert state == {"version": 1, "status": "complete", "documentId": document["id"], "revision": 1}
    store.workflow_update(document["id"], {**document, "title": "Edited by user"}, 1)
    assert store.workflow_migrate_defaults(document, source) == state
    assert store.workflow_get(document["id"])["document"]["title"] == "Edited by user"
    store.workflow_delete(document["id"], 2)
    assert store.workflow_migrate_defaults(document, source) == state
    assert store.workflow_list()["items"] == []
    assert store.settings_values()["defaults"] == source
    assert store.settings_values()["plugin:youdub.localize"]["translationSetupSkipped"]


def test_default_workflow_migration_does_not_overwrite_existing_document_or_concurrent_defaults(tmp_path):
    store = SqliteStore(tmp_path)
    source = defaults()
    store.write_setting("defaults", source)
    document = {"id": "user.legacy-defaults-v1", "title": "My existing workflow"}
    store.workflow_create(document)
    with pytest.raises(WorkerError) as error:
        store.workflow_migrate_defaults({**document, "title": "Migrated"}, source)
    assert error.value.code == "WORKFLOW_DOCUMENT_EXISTS"
    assert store.workflow_get(document["id"])["document"] == document
    store.workflow_delete(document["id"], 1)
    newer = deepcopy(source)
    newer["target_language"] = "zh"
    store.write_setting("defaults", newer)
    with pytest.raises(WorkerError) as error:
        store.workflow_migrate_defaults(document, source)
    assert error.value.code == "REVISION_CONFLICT"
    assert store.workflow_list()["items"] == []
    assert store.settings_values()["defaults"] == newer

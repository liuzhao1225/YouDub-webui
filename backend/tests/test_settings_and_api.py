from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from backend.app import config, database
from backend.app import main
from backend.app import worker


def configure_tmp_runtime(monkeypatch, tmp_path):
    workfolder = tmp_path / "workfolder"
    workfolder.mkdir()
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.sqlite")
    monkeypatch.setattr(main, "YOUTUBE_COOKIE_PATH", tmp_path / "cookies" / "youtube.txt")
    monkeypatch.setattr(main, "WORKFOLDER", workfolder)
    monkeypatch.setattr(config, "WORKFOLDER", workfolder)
    monkeypatch.setattr(config, "LOG_DIR", log_dir)
    monkeypatch.setattr(worker, "start", lambda runner: None)
    monkeypatch.setattr(worker, "enqueue", lambda task_id: None)
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: None)
    database.init_db()


def test_openai_key_is_masked(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test-secret", "test-model")
    client = TestClient(main.app)

    response = client.get("/api/settings/openai")

    assert response.status_code == 200
    body = response.json()
    assert body["api_key"] == "********"
    assert body["has_api_key"] is True
    assert "sk-test-secret" not in str(body)


def test_masked_openai_key_is_not_saved_back(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test-secret", "test-model")
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "********",
            "clear_api_key": False,
            "model": "next-model",
        },
    )

    assert response.status_code == 200
    settings = database.get_openai_settings()
    assert settings["api_key"] == "sk-test-secret"
    assert settings["model"] == "next-model"


def test_openai_key_can_be_cleared(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test-secret", "test-model")
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "",
            "clear_api_key": True,
            "model": "next-model",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["api_key"] == ""
    assert body["has_api_key"] is False
    settings = database.get_openai_settings()
    assert settings["api_key"] == ""
    assert settings["model"] == "next-model"


@pytest.mark.parametrize(
    ("api_key", "expected"),
    [
        ("", "sk-test-secret"),
        ("********", "sk-test-secret"),
        ("sk-new", "sk-new"),
    ],
)
def test_openai_key_save_modes_without_clear(monkeypatch, tmp_path, api_key, expected):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test-secret", "test-model")
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": api_key,
            "clear_api_key": False,
            "model": "next-model",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["api_key"] == "********"
    assert body["has_api_key"] is True
    settings = database.get_openai_settings()
    assert settings["api_key"] == expected
    assert settings["model"] == "next-model"


def test_cookie_response_does_not_leak_content(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post("/api/cookies/youtube", json={"content": "secret-cookie-content"})

    assert response.status_code == 200
    assert response.json()["content"] == ""
    assert "secret-cookie-content" not in response.text


def test_task_id_is_video_id_and_dedupes_existing(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    client = TestClient(main.app)
    payload = {"url": "https://www.youtube.com/watch?v=abcdefghijk"}

    first = client.post("/api/tasks", json=payload)
    second = client.post("/api/tasks", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == "abcdefghijk"
    assert second.json()["id"] == "abcdefghijk"
    assert enqueued == ["abcdefghijk"]


def test_different_videos_create_separate_tasks(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    client = TestClient(main.app)

    a = client.post("/api/tasks", json={"url": "https://www.youtube.com/watch?v=abcdefghijk"})
    b = client.post("/api/tasks", json={"url": "https://youtu.be/zyxwvutsrqp"})

    assert a.json()["id"] == "abcdefghijk"
    assert b.json()["id"] == "zyxwvutsrqp"
    assert enqueued == ["abcdefghijk", "zyxwvutsrqp"]


def test_list_tasks_returns_history_newest_first(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    older = database.create_task("https://www.youtube.com/watch?v=oldvideoidx")
    newer = database.create_task("https://www.youtube.com/watch?v=newvideoidx")
    client = TestClient(main.app)

    response = client.get("/api/tasks")

    assert response.status_code == 200
    body = response.json()
    ids = [task["id"] for task in body["tasks"]]
    assert ids == [newer, older]
    assert "stages" not in body["tasks"][0]
    assert set(body["tasks"][0].keys()) >= {"id", "url", "title", "status", "final_video_path"}


def test_delete_task_removes_session_log_and_record(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=delvideoidx", task_id="delvideoidx")
    session = config.WORKFOLDER / "uploader" / "title__delvideoidx"
    (session / "media").mkdir(parents=True)
    (session / "media" / "video_source.mp4").write_bytes(b"mp4")
    database.update_task(task_id, session_path=str(session))
    log_file = database.log_path(task_id)
    log_file.write_text("hello", encoding="utf-8")

    client = TestClient(main.app)
    response = client.delete(f"/api/tasks/{task_id}")

    assert response.status_code == 204
    assert database.get_task(task_id) is None
    assert not session.exists()
    assert not log_file.exists()


def test_delete_task_returns_404_for_unknown(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.delete("/api/tasks/does-not-exist")

    assert response.status_code == 404


def test_delete_task_rejects_running_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=runningvidx", task_id="runningvidx")
    database.update_task(task_id, status="running")

    client = TestClient(main.app)
    response = client.delete(f"/api/tasks/{task_id}")

    assert response.status_code == 409
    assert database.get_task(task_id) is not None


def test_rerun_task_purges_session_and_requeues(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))

    task_id = database.create_task("https://www.youtube.com/watch?v=rerunvideox", task_id="rerunvideox")
    session = config.WORKFOLDER / "uploader" / "title__rerunvideox"
    (session / "media").mkdir(parents=True)
    (session / "media" / "video_source.mp4").write_bytes(b"old")
    database.update_task(task_id, session_path=str(session), status="failed")
    log_file = database.log_path(task_id)
    log_file.write_text("old run", encoding="utf-8")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/rerun")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == task_id
    assert body["status"] == "queued"
    assert body["session_path"] is None
    assert enqueued == [task_id]
    assert not session.exists()
    assert not log_file.exists()


def test_rerun_task_returns_404_for_unknown(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post("/api/tasks/missing/rerun")

    assert response.status_code == 404


def test_rerun_task_rejects_running_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    task_id = database.create_task("https://www.youtube.com/watch?v=runrerunvid", task_id="runrerunvid")
    database.update_task(task_id, status="running")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/rerun")

    assert response.status_code == 409
    assert enqueued == []
    assert database.get_task(task_id)["status"] == "running"


def test_delete_task_skips_session_outside_workfolder(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=outsidevidx", task_id="outsidevidx")
    outside = tmp_path / "elsewhere" / "session"
    (outside / "media").mkdir(parents=True)
    (outside / "media" / "video_source.mp4").write_bytes(b"mp4")
    database.update_task(task_id, session_path=str(outside))

    client = TestClient(main.app)
    response = client.delete(f"/api/tasks/{task_id}")

    assert response.status_code == 204
    assert database.get_task(task_id) is None
    assert outside.exists(), "Sessions outside WORKFOLDER must not be deleted."


def test_cors_origins_include_runtime_configuration(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://172.27.2.90:3000, http://100.94.222.54:3000")

    origins = main.cors_origins()

    assert "http://localhost:3000" in origins
    assert "http://172.27.2.90:3000" in origins
    assert "http://100.94.222.54:3000" in origins


def test_cors_origin_regex_allows_common_development_hosts(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGIN_REGEX", raising=False)

    regex = re.compile(main.cors_origin_regex())

    assert regex.fullmatch("http://0.0.0.0:3000")
    assert regex.fullmatch("http://192.168.1.2:3000")
    assert regex.fullmatch("http://10.0.0.5:3000")
    assert regex.fullmatch("http://172.27.2.90:3000")
    assert regex.fullmatch("http://100.94.222.54:3000")
    assert not regex.fullmatch("http://example.com:3000")
    assert not regex.fullmatch("http://192.168.1.2:4000")


def test_openai_models_use_form_key_without_leaking_it(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    captured = {}

    def fake_list_models(*, base_url: str, api_key: str) -> list[str]:
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        return ["gpt-test", "qwen-test"]

    monkeypatch.setattr(main, "list_openai_models", fake_list_models)
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai/models",
        json={"base_url": "https://example.com/v1", "api_key": "sk-secret-models"},
    )

    assert response.status_code == 200
    assert response.json() == {"models": ["gpt-test", "qwen-test"]}
    assert captured == {"base_url": "https://example.com/v1", "api_key": "sk-secret-models"}
    assert "sk-secret-models" not in response.text


def test_openai_models_can_use_saved_key(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://saved.example/v1", "sk-saved", "saved-model")
    captured = {}

    def fake_list_models(*, base_url: str, api_key: str) -> list[str]:
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        return ["saved-model"]

    monkeypatch.setattr(main, "list_openai_models", fake_list_models)
    client = TestClient(main.app)

    response = client.post("/api/settings/openai/models", json={"base_url": "", "api_key": ""})

    assert response.status_code == 200
    assert response.json() == {"models": ["saved-model"]}
    assert captured == {"base_url": "https://saved.example/v1", "api_key": "sk-saved"}


def test_openai_settings_include_translate_concurrency(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_TRANSLATE_CONCURRENCY", raising=False)
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.get("/api/settings/openai")

    assert response.status_code == 200
    assert response.json()["translate_concurrency"] == "50"


def test_openai_settings_persists_translate_concurrency(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "",
            "model": "model",
            "translate_concurrency": " 32 ",
        },
    )

    assert response.status_code == 200
    assert response.json()["translate_concurrency"] == "32"
    assert database.get_openai_settings()["translate_concurrency"] == "32"


@pytest.mark.parametrize("value", ["abc", "1.5", "0", "-1", "201"])
def test_openai_settings_rejects_invalid_translate_concurrency(monkeypatch, tmp_path, value):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test", "model", "64")
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "",
            "clear_api_key": False,
            "model": "model",
            "translate_concurrency": value,
        },
    )

    assert response.status_code == 422
    assert database.get_openai_settings()["translate_concurrency"] == "64"


def test_openai_settings_empty_translate_concurrency_preserves_existing(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    database.save_openai_settings("https://example.com/v1", "sk-test", "model", "64")
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "",
            "clear_api_key": False,
            "model": "next-model",
            "translate_concurrency": "",
        },
    )

    assert response.status_code == 200
    assert response.json()["translate_concurrency"] == "64"
    settings = database.get_openai_settings()
    assert settings["translate_concurrency"] == "64"
    assert settings["model"] == "next-model"


@pytest.mark.parametrize("value", ["1", "200"])
def test_openai_settings_accepts_translate_concurrency_boundaries(monkeypatch, tmp_path, value):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/settings/openai",
        json={
            "base_url": "https://example.com/v1",
            "api_key": "",
            "clear_api_key": False,
            "model": "model",
            "translate_concurrency": value,
        },
    )

    assert response.status_code == 200
    assert response.json()["translate_concurrency"] == value
    assert database.get_openai_settings()["translate_concurrency"] == value


def test_resume_task_requeues_failed_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    task_id = database.create_task("https://www.youtube.com/watch?v=resumevideox", task_id="resumevideox")
    database.update_task(task_id, status="failed", error_message="boom", completed_at=database.now_iso())
    database.update_stage(task_id, "asr", status="failed", error_message="boom")
    database.update_stage(task_id, "download", status="succeeded")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/resume")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["error_message"] is None
    stages = {s["name"]: s for s in body["stages"]}
    assert stages["download"]["status"] == "succeeded"
    assert stages["asr"]["status"] == "pending"
    assert stages["asr"]["error_message"] is None
    assert enqueued == [task_id]


def test_resume_task_rejects_non_failed(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=okvideoxxxx", task_id="okvideoxxxx")
    database.update_task(task_id, status="succeeded")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/resume")

    assert response.status_code == 409


def test_ytdlp_proxy_port_settings(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    saved = client.post("/api/settings/ytdlp", json={"proxy_port": "7890"})
    loaded = client.get("/api/settings/ytdlp")

    assert saved.status_code == 200
    assert loaded.status_code == 200
    assert loaded.json() == {"proxy_port": "7890"}


def test_ytdlp_proxy_port_rejects_invalid_value(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post("/api/settings/ytdlp", json={"proxy_port": "70000"})

    assert response.status_code == 422


def test_upload_local_video_creates_task_and_saved_file(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    client = TestClient(main.app)

    response = client.post(
        "/api/tasks/upload",
        data={"direction": "zh-en"},
        files={"file": ("clip.mp4", b"mp4data", "video/mp4")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "clip"
    assert body["url"].startswith(f"local://upload/{body['id']}?direction=zh-en")
    assert enqueued == [body["id"]]
    saved = list((config.WORKFOLDER / "_uploads" / body["id"]).iterdir())
    assert len(saved) == 1
    assert saved[0].read_bytes() == b"mp4data"


def test_create_task_rejects_local_upload_url(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)
    response = client.post("/api/tasks", json={"url": "local://upload/fake?direction=en-zh"})
    assert response.status_code == 422


def test_create_task_rejects_unavailable_cuda_runtime(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main,
        "validate_runtime_device",
        lambda: (_ for _ in ()).throw(RuntimeError("DEVICE=cuda is not available")),
    )
    client = TestClient(main.app)
    response = client.post("/api/tasks", json={"url": "https://www.youtube.com/watch?v=okvideoxxxx"})
    assert response.status_code == 409
    assert response.json()["detail"] == "DEVICE=cuda is not available"


def test_delete_local_video_removes_upload(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)
    upload = client.post(
        "/api/tasks/upload",
        data={"direction": "en-zh"},
        files={"file": ("clip.mp4", b"mp4data", "video/mp4")},
    )
    task_id = upload.json()["id"]
    upload_root = config.WORKFOLDER / "_uploads" / task_id
    assert upload_root.exists()

    response = client.delete(f"/api/tasks/{task_id}")

    assert response.status_code == 204
    assert not upload_root.exists()
    assert database.get_task(task_id) is None

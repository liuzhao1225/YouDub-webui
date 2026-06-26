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


def make_history_task(
    task_id: str,
    *,
    url: str | None = None,
    title: str | None = None,
    status: str = "queued",
    execution_mode: str = "auto",
    created_at: str = "2024-01-01T00:00:00+00:00",
    started_at: str | None = None,
    completed_at: str | None = None,
) -> str:
    task_url = url or f"https://example.com/{task_id}"
    database.create_task(task_url, task_id=task_id, execution_mode=execution_mode)
    database.update_task(
        task_id,
        title=title,
        status=status,
        created_at=created_at,
        started_at=started_at,
        completed_at=completed_at,
    )
    return task_id


def task_ids(response):
    return [task["id"] for task in response.json()["tasks"]]


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
    assert body["total"] == 2
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert "stages" not in body["tasks"][0]
    assert set(body["tasks"][0].keys()) >= {"id", "url", "title", "status", "final_video_path"}


def test_list_tasks_search_matches_title_url_and_id(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    alpha = make_history_task("alpha-task", title="Alpha Clip")
    beta = make_history_task("beta-task", url="https://example.com/special-url-token")
    gamma = make_history_task("gamma-task")
    client = TestClient(main.app)

    assert task_ids(client.get("/api/tasks?q=alpha")) == [alpha]
    assert task_ids(client.get("/api/tasks?q=special-url-token")) == [beta]
    assert task_ids(client.get("/api/tasks?q=gamma-task")) == [gamma]


def test_list_tasks_filters_status_and_execution_mode(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    target = make_history_task(
        "manual-success",
        status="succeeded",
        execution_mode="manual",
        created_at="2024-01-03T00:00:00+00:00",
    )
    make_history_task(
        "auto-success",
        status="succeeded",
        execution_mode="auto",
        created_at="2024-01-02T00:00:00+00:00",
    )
    make_history_task(
        "manual-failed",
        status="failed",
        execution_mode="manual",
        created_at="2024-01-01T00:00:00+00:00",
    )
    client = TestClient(main.app)

    response = client.get("/api/tasks?status=succeeded&execution_mode=manual")

    assert response.status_code == 200
    assert task_ids(response) == [target]
    assert response.json()["total"] == 1


def test_list_tasks_paginates_with_total(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    for index in range(1, 6):
        make_history_task(
            f"page-task-{index}",
            created_at=f"2024-01-0{index}T00:00:00+00:00",
        )
    client = TestClient(main.app)

    response = client.get("/api/tasks?page=2&page_size=2")

    assert response.status_code == 200
    body = response.json()
    assert task_ids(response) == ["page-task-3", "page-task-2"]
    assert body["total"] == 5
    assert body["page"] == 2
    assert body["page_size"] == 2


def test_list_tasks_sorts_by_created_status_and_title(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    charlie = make_history_task(
        "charlie-task",
        title="Charlie",
        status="succeeded",
        created_at="2024-01-01T00:00:00+00:00",
    )
    alpha = make_history_task(
        "alpha-task",
        title="Alpha",
        status="queued",
        created_at="2024-01-02T00:00:00+00:00",
    )
    bravo = make_history_task(
        "bravo-task",
        title="Bravo",
        status="running",
        created_at="2024-01-03T00:00:00+00:00",
    )
    client = TestClient(main.app)

    assert task_ids(client.get("/api/tasks?sort=created_asc")) == [charlie, alpha, bravo]
    assert task_ids(client.get("/api/tasks?sort=status_asc")) == [alpha, bravo, charlie]
    assert task_ids(client.get("/api/tasks?sort=status_desc")) == [charlie, bravo, alpha]
    assert task_ids(client.get("/api/tasks?sort=title_asc")) == [alpha, bravo, charlie]
    assert task_ids(client.get("/api/tasks?sort=title_desc")) == [charlie, bravo, alpha]


@pytest.mark.parametrize(
    "query",
    [
        "page=0",
        "page_size=0",
        "page_size=101",
        "status=done",
        "execution_mode=batch",
        "sort=unknown",
    ],
)
def test_list_tasks_rejects_invalid_query_params(monkeypatch, tmp_path, query):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.get(f"/api/tasks?{query}")

    assert response.status_code == 422


def test_task_detail_includes_stage_progress(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=progressapi")
    database.update_stage(task_id, "tts", progress=42, last_message="Prepared 21/50 TTS clips")
    client = TestClient(main.app)

    response = client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 200
    stages = {stage["name"]: stage for stage in response.json()["stages"]}
    assert stages["tts"]["progress"] == 42
    assert stages["tts"]["last_message"] == "Prepared 21/50 TTS clips"


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
    database.update_stage(task_id, "asr", status="failed", progress=33, error_message="boom")
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
    assert stages["asr"]["progress"] is None
    assert stages["asr"]["error_message"] is None
    assert enqueued == [task_id]


def test_resume_task_rejects_non_failed(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=okvideoxxxx", task_id="okvideoxxxx")
    database.update_task(task_id, status="succeeded")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/resume")

    assert response.status_code == 409


def test_continue_task_requeues_paused_manual_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=continuestep",
        task_id="continuestep",
        execution_mode="manual",
    )
    database.update_task(task_id, status="paused")
    database.update_stage(task_id, "download", status="succeeded", completed_at=database.now_iso())
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda tid: enqueued.append(tid))

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/continue")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["execution_mode"] == "manual"
    assert enqueued == [task_id]


def test_continue_task_can_switch_to_auto(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=continuestepauto",
        task_id="continuestepauto",
        execution_mode="manual",
    )
    database.update_task(task_id, status="paused")
    database.update_stage(task_id, "download", status="succeeded", completed_at=database.now_iso())
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda tid: enqueued.append(tid))

    client = TestClient(main.app)
    response = client.post(
        f"/api/tasks/{task_id}/continue",
        json={"execution_mode": "auto"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["execution_mode"] == "auto"
    assert enqueued == [task_id]


def test_continue_task_rejects_auto_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=autocontinue", task_id="autocontinue")
    database.update_task(task_id, status="paused")

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/continue")

    assert response.status_code == 409


def test_redo_stage_requeues_manual_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    session = tmp_path / "workfolder" / "redo-session"
    metadata = session / "metadata"
    metadata.mkdir(parents=True)
    translation = metadata / "translation.zh.json"
    asr_fixed = metadata / "asr_fixed.json"
    translation.write_text("{}", encoding="utf-8")
    asr_fixed.write_text("{}", encoding="utf-8")

    task_id = database.create_task(
        "https://www.youtube.com/watch?v=redostgapi1",
        task_id="redostgapi1",
        execution_mode="manual",
    )
    database.update_task(task_id, status="paused", session_path=str(session))
    for stage in ("download", "separate", "asr", "asr_fix", "translate"):
        database.update_stage(task_id, stage, status="succeeded", completed_at=database.now_iso())
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda tid: enqueued.append(tid))

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/stages/translate/redo")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert not translation.exists()
    assert asr_fixed.exists()
    translate_stage = next(stage for stage in body["stages"] if stage["name"] == "translate")
    split_stage = next(stage for stage in body["stages"] if stage["name"] == "split_audio")
    assert translate_stage["status"] == "pending"
    assert split_stage["status"] == "pending"
    assert enqueued == [task_id]


def test_redo_stage_runtime_failure_preserves_artifacts_and_state(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    session = tmp_path / "workfolder" / "redo-runtime-session"
    metadata = session / "metadata"
    tts_dir = session / "segments" / "tts"
    metadata.mkdir(parents=True)
    tts_dir.mkdir(parents=True)
    translation = metadata / "translation.zh.json"
    tts_file = tts_dir / "0001.wav"
    translation.write_text("{}", encoding="utf-8")
    tts_file.write_bytes(b"wav")

    task_id = database.create_task(
        "https://www.youtube.com/watch?v=redoruntime",
        task_id="redoruntime",
        execution_mode="manual",
    )
    database.update_task(task_id, status="paused", session_path=str(session), current_stage="merge_video")
    for stage in ("download", "separate", "asr", "asr_fix", "translate", "split_audio", "tts"):
        database.update_stage(task_id, stage, status="succeeded", completed_at=database.now_iso())
    monkeypatch.setattr(
        main,
        "validate_runtime_device",
        lambda: (_ for _ in ()).throw(RuntimeError("runtime unavailable")),
    )
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda tid: enqueued.append(tid))

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/stages/translate/redo")

    assert response.status_code == 409
    assert response.json()["detail"] == "runtime unavailable"
    assert translation.exists()
    assert tts_file.exists()
    assert enqueued == []
    task = database.get_task(task_id)
    stages = {stage["name"]: stage for stage in task["stages"]}
    assert task["status"] == "paused"
    assert stages["translate"]["status"] == "succeeded"
    assert stages["tts"]["status"] == "succeeded"


def test_redo_stage_rejects_auto_task(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=redostgauto", task_id="redostgauto")
    database.update_task(task_id, status="paused")
    database.update_stage(task_id, "download", status="succeeded", completed_at=database.now_iso())

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/stages/download/redo")

    assert response.status_code == 409


def test_redo_stage_rejects_pending_stage(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=redostgpnd1",
        task_id="redostgpnd1",
        execution_mode="manual",
    )
    database.update_task(task_id, status="paused")
    database.update_stage(task_id, "download", status="succeeded", completed_at=database.now_iso())

    client = TestClient(main.app)
    response = client.post(f"/api/tasks/{task_id}/stages/translate/redo")

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
    saved = list((config.WORKFOLDER / "_uploads" / body["id"] / "video").iterdir())
    assert len(saved) == 1
    assert saved[0].read_bytes() == b"mp4data"


def test_upload_local_video_can_save_translated_srt(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    client = TestClient(main.app)

    response = client.post(
        "/api/tasks/upload",
        data={"direction": "en-zh"},
        files={
            "file": ("clip.mp4", b"mp4data", "video/mp4"),
            "subtitle_file": (
                "clip.zh.srt",
                b"1\n00:00:00,000 --> 00:00:01,000\nhello\n",
                "application/x-subrip",
            ),
        },
    )

    assert response.status_code == 201
    task_id = response.json()["id"]
    assert enqueued == [task_id]
    video_files = list((config.WORKFOLDER / "_uploads" / task_id / "video").iterdir())
    subtitle_files = list((config.WORKFOLDER / "_uploads" / task_id / "subtitle").iterdir())
    assert [path.name for path in video_files] == ["clip.mp4"]
    assert [path.name for path in subtitle_files] == ["clip.zh.srt"]
    assert subtitle_files[0].read_bytes().startswith(b"1\n00:00:00,000")


def test_upload_local_video_rejects_non_srt_subtitle(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/tasks/upload",
        data={"direction": "en-zh"},
        files={
            "file": ("clip.mp4", b"mp4data", "video/mp4"),
            "subtitle_file": ("clip.vtt", b"WEBVTT", "text/vtt"),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Only .srt subtitle files are supported."


def test_upload_local_video_rejects_malformed_srt_and_cleans_upload(monkeypatch, tmp_path):
    configure_tmp_runtime(monkeypatch, tmp_path)
    enqueued: list[str] = []
    monkeypatch.setattr(main.worker, "enqueue", lambda task_id: enqueued.append(task_id))
    client = TestClient(main.app)

    response = client.post(
        "/api/tasks/upload",
        data={"direction": "en-zh"},
        files={
            "file": ("clip.mp4", b"mp4data", "video/mp4"),
            "subtitle_file": ("broken.srt", b"not an srt file", "application/x-subrip"),
        },
    )

    assert response.status_code == 400
    assert "Invalid SRT subtitle file" in response.json()["detail"]
    assert enqueued == []
    assert database.list_tasks() == []
    assert not any((config.WORKFOLDER / "_uploads").glob("*"))


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

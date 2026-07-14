from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import auth, config, database, main
from backend.tests.conftest import (
    CHANGED_AUTH_PASSWORD_HASH,
    TEST_AUTH_PASSWORD,
    TEST_AUTH_PASSWORD_HASH,
)


@pytest.fixture
def client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "auth.sqlite")
    monkeypatch.setattr(database, "ensure_runtime_dirs", lambda: None)
    monkeypatch.setattr(config, "LOG_DIR", tmp_path / "logs")
    database.init_db()
    return TestClient(main.app)


def login(client: TestClient) -> tuple[str, dict]:
    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    assert response.status_code == 200
    return response.json()["csrf_token"], response.json()


def test_health_and_login_are_public(client):
    health_response = client.get("/api/health")
    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})

    assert health_response.status_code == 200
    assert health_response.headers["cache-control"] == "no-store"
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/auth/session"),
        ("POST", "/api/auth/logout"),
        ("POST", "/api/tasks"),
        ("POST", "/api/tasks/upload"),
        ("GET", "/api/tasks/current"),
        ("GET", "/api/tasks"),
        ("GET", "/api/tasks/missing"),
        ("DELETE", "/api/tasks/missing"),
        ("POST", "/api/tasks/missing/rerun"),
        ("POST", "/api/tasks/missing/stages/download/redo"),
        ("POST", "/api/tasks/missing/continue"),
        ("POST", "/api/tasks/missing/resume"),
        ("GET", "/api/tasks/missing/log"),
        ("GET", "/api/tasks/missing/artifact/final-video"),
        ("GET", "/api/cookies/youtube"),
        ("POST", "/api/cookies/youtube"),
        ("GET", "/api/settings/openai"),
        ("POST", "/api/settings/openai"),
        ("POST", "/api/settings/openai/models"),
        ("GET", "/api/settings/ytdlp"),
        ("POST", "/api/settings/ytdlp"),
    ],
)
def test_every_api_route_requires_authentication(client, method, path):
    response = client.request(method, path)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_interactive_api_schema_is_disabled(client, path):
    assert client.get(path).status_code == 404


def test_failed_login_is_fixed_and_does_not_leak_credentials(client):
    supplied = "wrong-password-that-must-not-leak"
    response = client.post("/api/auth/login", json={"password": supplied})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials."}
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    assert supplied not in response.text
    assert TEST_AUTH_PASSWORD_HASH not in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"password": {"probe": "malformed-password-input"}},
    ],
)
def test_login_validation_errors_do_not_echo_password_input(client, payload):
    response = client.post("/api/auth/login", json=payload)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials."}
    assert "malformed-password-input" not in response.text
    assert "set-cookie" not in response.headers


def test_unconfigured_authentication_fails_closed(client, monkeypatch):
    monkeypatch.delenv("YOUDUB_AUTH_PASSWORD_HASH")

    login_response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    api_response = client.get("/api/tasks")

    assert login_response.status_code == 503
    assert login_response.json() == {"detail": "Authentication is not configured."}
    assert api_response.status_code == 503
    assert api_response.json() == {"detail": "Authentication is not configured."}


def test_successful_login_sets_hardened_cookie_and_stores_only_digest(client):
    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    assert response.status_code == 200
    payload = response.json()
    cookie_header = response.headers["set-cookie"]
    session_token = client.cookies.get(auth.SESSION_COOKIE_NAME)

    assert payload["authenticated"] is True
    assert payload["csrf_token"]
    assert payload["expires_at"]
    assert session_token
    assert session_token not in str(payload)
    assert "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()
    assert "path=/api" in cookie_header.lower()
    assert "secure" not in cookie_header.lower()
    assert "max-age=3600" in cookie_header.lower()

    with database.connect() as conn:
        rows = conn.execute("SELECT token_hash FROM auth_sessions").fetchall()
    assert rows
    assert all(row["token_hash"] != session_token for row in rows)
    assert auth.session_token_hash(session_token) in {row["token_hash"] for row in rows}


def test_secure_and_strict_cookie_configuration(client, monkeypatch):
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SAMESITE", "strict")

    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})

    assert response.status_code == 200
    cookie_header = response.headers["set-cookie"].lower()
    assert "secure" in cookie_header
    assert "samesite=strict" in cookie_header


def test_session_endpoint_restores_csrf_and_allows_authenticated_reads(client):
    csrf_token, login_payload = login(client)

    session_response = client.get("/api/auth/session")
    tasks_response = client.get("/api/tasks")

    assert session_response.status_code == 200
    assert session_response.json() == login_payload
    assert session_response.json()["csrf_token"] == csrf_token
    assert session_response.headers["cache-control"] == "no-store"
    assert tasks_response.status_code == 200
    assert tasks_response.headers["cache-control"] == "no-store"


def test_unsafe_requests_require_matching_csrf_token(client):
    csrf_token, _ = login(client)

    missing = client.post("/api/settings/ytdlp", json={"proxy_port": "7890"})
    wrong = client.post(
        "/api/settings/ytdlp",
        json={"proxy_port": "7890"},
        headers={auth.CSRF_HEADER_NAME: "wrong"},
    )
    accepted = client.post(
        "/api/settings/ytdlp",
        json={"proxy_port": "7890"},
        headers={auth.CSRF_HEADER_NAME: csrf_token},
    )

    assert missing.status_code == 403
    assert missing.json() == {"detail": "CSRF validation failed."}
    assert wrong.status_code == 403
    assert accepted.status_code == 200
    assert database.get_ytdlp_settings()["proxy_port"] == "7890"


@pytest.mark.parametrize("sec_fetch_site", [None, "same-site", "cross-site", "none"])
def test_login_and_unsafe_requests_reject_untrusted_browser_origins(
    client, sec_fetch_site
):
    untrusted_headers = {"Origin": "https://untrusted.example"}
    if sec_fetch_site:
        untrusted_headers["Sec-Fetch-Site"] = sec_fetch_site
    login_response = client.post(
        "/api/auth/login",
        json={"password": TEST_AUTH_PASSWORD},
        headers=untrusted_headers,
    )
    assert login_response.status_code == 403

    csrf_token, _ = login(client)
    previous_proxy_port = database.get_ytdlp_settings()["proxy_port"]
    write_response = client.post(
        "/api/settings/ytdlp",
        json={"proxy_port": "7890"},
        headers={
            auth.CSRF_HEADER_NAME: csrf_token,
            **untrusted_headers,
        },
    )
    assert write_response.status_code == 403
    assert database.get_ytdlp_settings()["proxy_port"] == previous_proxy_port


def test_same_origin_next_proxy_requests_do_not_need_backend_cors_entry(client):
    proxy_origin = "http://192.168.1.10:3000"
    browser_headers = {
        "Origin": proxy_origin,
        "Sec-Fetch-Site": "same-origin",
    }

    login_response = client.post(
        "/api/auth/login",
        json={"password": TEST_AUTH_PASSWORD},
        headers=browser_headers,
    )
    assert login_response.status_code == 200
    csrf_token = login_response.json()["csrf_token"]
    write_response = client.post(
        "/api/settings/ytdlp",
        json={"proxy_port": "7890"},
        headers={**browser_headers, auth.CSRF_HEADER_NAME: csrf_token},
    )

    assert write_response.status_code == 200


def test_logout_revokes_server_session_and_clears_cookie(client):
    csrf_token, _ = login(client)

    response = client.post(
        "/api/auth/logout",
        headers={auth.CSRF_HEADER_NAME: csrf_token},
    )

    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert client.get("/api/tasks").status_code == 401
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0


def test_expired_session_is_rejected_and_cookie_is_cleared(client):
    login(client)
    with database.connect() as conn:
        conn.execute(
            "UPDATE auth_sessions SET expires_at = ?",
            ("2000-01-01T00:00:00+00:00",),
        )

    response = client.get("/api/tasks")

    assert response.status_code == 401
    assert "max-age=0" in response.headers["set-cookie"].lower()
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0


def test_session_survives_new_client_but_password_hash_change_invalidates_it(
    client, monkeypatch
):
    login(client)
    session_token = client.cookies.get(auth.SESSION_COOKIE_NAME)
    restarted_client = TestClient(main.app)
    restarted_client.cookies.set(auth.SESSION_COOKIE_NAME, session_token, path="/api")

    assert restarted_client.get("/api/auth/session").status_code == 200

    monkeypatch.setenv("YOUDUB_AUTH_PASSWORD_HASH", CHANGED_AUTH_PASSWORD_HASH)
    response = restarted_client.get("/api/auth/session")

    assert response.status_code == 401
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0


def test_inline_video_download_and_range_requests_use_session_cookie(client, tmp_path):
    login(client)
    video = tmp_path / "video.mp4"
    video.write_bytes(b"0123456789")
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=authvideo01", task_id="authvideo01"
    )
    database.update_task(
        task_id,
        status="succeeded",
        final_video_path=str(video),
    )

    inline = client.get(f"/api/tasks/{task_id}/artifact/final-video")
    download = client.get(f"/api/tasks/{task_id}/artifact/final-video?download=1")
    ranged = client.get(
        f"/api/tasks/{task_id}/artifact/final-video",
        headers={"Range": "bytes=2-5"},
    )

    assert inline.status_code == 200
    assert inline.content == b"0123456789"
    assert inline.headers["content-disposition"].startswith("inline")
    assert inline.headers["cache-control"] == "no-store"
    assert download.status_code == 200
    assert download.headers["content-disposition"].startswith("attachment")
    assert download.headers["cache-control"] == "no-store"
    assert ranged.status_code == 206
    assert ranged.content == b"2345"
    assert ranged.headers["cache-control"] == "no-store"


def test_successful_login_revokes_existing_session_and_rotates_token(client):
    login(client)
    old_token = client.cookies.get(auth.SESSION_COOKIE_NAME)

    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})
    new_token = client.cookies.get(auth.SESSION_COOKIE_NAME)

    assert response.status_code == 200
    assert new_token
    assert new_token != old_token
    old_client = TestClient(main.app)
    old_client.cookies.set(auth.SESSION_COOKIE_NAME, old_token, path="/api")
    assert old_client.get("/api/auth/session").status_code == 401
    assert client.get("/api/auth/session").status_code == 200
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 1


def test_login_replaces_an_invalid_existing_cookie(client):
    client.cookies.set(
        auth.SESSION_COOKIE_NAME,
        "invalid-session",
        domain="testserver.local",
        path="/api",
    )

    response = client.post("/api/auth/login", json={"password": TEST_AUTH_PASSWORD})

    assert response.status_code == 200
    assert client.cookies.get(auth.SESSION_COOKIE_NAME) != "invalid-session"


def test_failed_login_revokes_existing_session_and_clears_cookie(client):
    login(client)
    old_token = client.cookies.get(auth.SESSION_COOKIE_NAME)

    response = client.post("/api/auth/login", json={"password": "wrong-password"})

    assert response.status_code == 401
    assert "max-age=0" in response.headers["set-cookie"].lower()
    old_client = TestClient(main.app)
    old_client.cookies.set(auth.SESSION_COOKIE_NAME, old_token, path="/api")
    assert old_client.get("/api/auth/session").status_code == 401
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0


def test_login_rate_limit_uses_socket_host_ignores_xff_and_recovers(client, monkeypatch):
    now = datetime(2026, 7, 14, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(auth, "_utc_now", lambda: now)

    for attempt in range(auth.LOGIN_RATE_LIMIT_ATTEMPTS):
        response = client.post(
            "/api/auth/login",
            json={"password": "wrong-password"},
            headers={"X-Forwarded-For": f"198.51.100.{attempt + 1}"},
        )
        assert response.status_code == 401

    blocked = client.post(
        "/api/auth/login",
        json={"password": TEST_AUTH_PASSWORD},
        headers={"X-Forwarded-For": "203.0.113.250"},
    )
    assert blocked.status_code == 429
    assert blocked.json() == {"detail": "Too many login attempts."}
    assert blocked.headers["retry-after"] == "60"
    assert blocked.headers["cache-control"] == "no-store"

    now += timedelta(seconds=61)
    recovered = client.post(
        "/api/auth/login", json={"password": TEST_AUTH_PASSWORD}
    )
    assert recovered.status_code == 200


def test_successful_login_clears_failed_attempt_counter(client):
    for _ in range(auth.LOGIN_RATE_LIMIT_ATTEMPTS - 1):
        assert client.post(
            "/api/auth/login", json={"password": "wrong-password"}
        ).status_code == 401

    assert client.post(
        "/api/auth/login", json={"password": TEST_AUTH_PASSWORD}
    ).status_code == 200
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_login_attempts").fetchone()[0] == 0


def test_default_cors_does_not_trust_lan_origins(client):
    origin = "http://192.168.1.10:3000"

    login_response = client.post(
        "/api/auth/login",
        json={"password": TEST_AUTH_PASSWORD},
        headers={"Origin": origin},
    )
    api_response = client.get("/api/tasks", headers={"Origin": origin})

    assert login_response.status_code == 403
    assert "access-control-allow-origin" not in login_response.headers
    assert api_response.status_code == 401
    assert "access-control-allow-origin" not in api_response.headers


def test_cors_wraps_preflight_and_authentication_errors(client):
    origin = "http://localhost:3000"
    preflight = client.options(
        "/api/settings/ytdlp",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": auth.CSRF_HEADER_NAME,
        },
    )
    unauthenticated = client.get("/api/tasks", headers={"Origin": origin})
    untrusted = client.get(
        "/api/tasks", headers={"Origin": "https://untrusted.example"}
    )

    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert unauthenticated.status_code == 401
    assert unauthenticated.headers["access-control-allow-origin"] == origin
    assert unauthenticated.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in untrusted.headers

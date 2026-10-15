"""Python owns cookie configuration; Host creates passwordless browser sessions."""
from __future__ import annotations

import pytest
from backend.app import auth
from backend.workers.bridge import Bridge


@pytest.mark.parametrize("legacy_hash", [None, "", "old-unused-password-hash"])
def test_bridge_starts_without_password_configuration(tmp_path, monkeypatch, legacy_hash):
    if legacy_hash is None:
        monkeypatch.delenv("YOUDUB_AUTH_PASSWORD_HASH", raising=False)
    else:
        monkeypatch.setenv("YOUDUB_AUTH_PASSWORD_HASH", legacy_hash)
    assert Bridge(tmp_path).call("auth.validate", {}) == {
        "cookieName": "youdub_session", "sessionTtlSeconds": 3600,
        "cookieSecure": False, "cookieSameSite": "lax", "credentialVersion": "passwordless-v1",
    }


@pytest.mark.parametrize("name,value", [
    ("YOUDUB_AUTH_SESSION_TTL_SECONDS", "abc"),
    ("YOUDUB_AUTH_SESSION_TTL_SECONDS", "299"),
    ("YOUDUB_AUTH_SESSION_TTL_SECONDS", "2678401"),
    ("YOUDUB_AUTH_COOKIE_SECURE", "maybe"),
    ("YOUDUB_AUTH_COOKIE_SAMESITE", "none"),
    ("YOUDUB_AUTH_COOKIE_NAME", "bad;cookie"),
    ("YOUDUB_AUTH_COOKIE_NAME", "c" * 65),
])
def test_invalid_configuration_is_visible(name, value, monkeypatch):
    monkeypatch.setenv(name, value)
    with pytest.raises(auth.AuthConfigurationError):
        auth.load_auth_settings()


@pytest.mark.parametrize("ttl", ["300", "2678400"])
def test_cookie_settings_and_lifetime_boundaries(ttl, monkeypatch):
    monkeypatch.setenv("YOUDUB_AUTH_SESSION_TTL_SECONDS", ttl)
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SAMESITE", "strict")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_NAME", "youdub_second-instance")
    settings = auth.load_auth_settings()
    assert settings.session_ttl_seconds == int(ttl)
    assert settings.cookie_secure and settings.cookie_samesite == "strict"
    assert auth.session_cookie_name() == "youdub_second-instance"

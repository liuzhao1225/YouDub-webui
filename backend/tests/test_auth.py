"""Python owns password hashing and configuration; Host owns HTTP sessions."""
from __future__ import annotations

import base64
import hashlib

import pytest

from backend.app import auth
from backend.tests.conftest import TEST_AUTH_PASSWORD, TEST_AUTH_PASSWORD_HASH, CHANGED_AUTH_PASSWORD_HASH
from backend.workers.bridge import Bridge


def test_bridge_auth_configuration_and_password_verification(tmp_path):
    bridge = Bridge(tmp_path)
    settings = bridge.call("auth.validate", {})
    assert settings == {"cookieName": "youdub_session", "sessionTtlSeconds": 3600,
                        "cookieSecure": False, "cookieSameSite": "lax",
                        "credentialVersion": auth.credential_version(TEST_AUTH_PASSWORD_HASH)}
    assert bridge.call("auth.verify_password", {"password": TEST_AUTH_PASSWORD}) == {"valid": True}
    assert bridge.call("auth.verify_password", {"password": "wrong-password"}) == {"valid": False}
    assert TEST_AUTH_PASSWORD_HASH not in str(settings)


@pytest.mark.parametrize("password", ["", "x" * 1025])
def test_empty_or_oversized_password_does_not_hash(password, monkeypatch):
    monkeypatch.setattr(auth._PASSWORD_HASHER, "verify", lambda *_: pytest.fail("must not hash"))
    assert auth.verify_password(password, auth.load_auth_settings()) is False


@pytest.mark.parametrize("name,value", [
    ("YOUDUB_AUTH_PASSWORD_HASH", ""),
    ("YOUDUB_AUTH_PASSWORD_HASH", "plain-password"),
    ("YOUDUB_AUTH_PASSWORD_HASH", "$argon2id$invalid"),
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
        auth.validate_auth_configuration()


@pytest.mark.parametrize("ttl", ["300", "2678400"])
def test_cookie_settings_and_lifetime_boundaries(ttl, monkeypatch):
    monkeypatch.setenv("YOUDUB_AUTH_SESSION_TTL_SECONDS", ttl)
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SAMESITE", "strict")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_NAME", "youdub_second-instance")
    settings = auth.validate_auth_configuration()
    assert settings.session_ttl_seconds == int(ttl)
    assert settings.cookie_secure and settings.cookie_samesite == "strict"
    assert auth.session_cookie_name() == "youdub_second-instance"


def test_credential_version_preserves_existing_session_digest():
    expected = base64.urlsafe_b64encode(hashlib.sha256(
        b"youdub-credential\x00" + TEST_AUTH_PASSWORD_HASH.encode()).digest()).rstrip(b"=").decode()
    assert auth.credential_version(TEST_AUTH_PASSWORD_HASH) == expected
    assert auth.credential_version(CHANGED_AUTH_PASSWORD_HASH) != expected

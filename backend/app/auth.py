from __future__ import annotations

import base64
import hashlib
import os
import re
from dataclasses import dataclass
from typing import Literal

from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError


SESSION_COOKIE_NAME = "youdub_session"
SESSION_COOKIE_NAME_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
MIN_SESSION_TTL_SECONDS = 5 * 60
MAX_SESSION_TTL_SECONDS = 31 * 24 * 60 * 60
MAX_PASSWORD_LENGTH = 1024
_PASSWORD_HASHER = PasswordHash.recommended()


class AuthConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthSettings:
    password_hash: str
    session_ttl_seconds: int
    cookie_secure: bool
    cookie_samesite: Literal["lax", "strict"]


def _parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise AuthConfigurationError(f"{name} must be true or false.")


def session_cookie_name() -> str:
    """Session cookie name, overridable so several instances can share one host.

    Browsers do not scope cookies by port, so two instances reachable on the same
    host would otherwise overwrite each other's login cookie.
    """
    name = os.getenv("YOUDUB_AUTH_COOKIE_NAME", "").strip()
    return name if SESSION_COOKIE_NAME_PATTERN.fullmatch(name) else SESSION_COOKIE_NAME


def load_auth_settings() -> AuthSettings:
    cookie_name = os.getenv("YOUDUB_AUTH_COOKIE_NAME", "").strip()
    if cookie_name and not SESSION_COOKIE_NAME_PATTERN.fullmatch(cookie_name):
        raise AuthConfigurationError(
            "YOUDUB_AUTH_COOKIE_NAME may only contain letters, digits, '_' and '-'."
        )

    password_hash = os.getenv("YOUDUB_AUTH_PASSWORD_HASH", "").strip()
    if not password_hash:
        raise AuthConfigurationError("YOUDUB_AUTH_PASSWORD_HASH is required.")
    if not password_hash.startswith("$argon2id$"):
        raise AuthConfigurationError("YOUDUB_AUTH_PASSWORD_HASH must be an Argon2id hash.")

    raw_ttl = os.getenv("YOUDUB_AUTH_SESSION_TTL_SECONDS", "").strip()
    try:
        session_ttl_seconds = int(raw_ttl) if raw_ttl else DEFAULT_SESSION_TTL_SECONDS
    except ValueError as exc:
        raise AuthConfigurationError(
            "YOUDUB_AUTH_SESSION_TTL_SECONDS must be an integer."
        ) from exc
    if not MIN_SESSION_TTL_SECONDS <= session_ttl_seconds <= MAX_SESSION_TTL_SECONDS:
        raise AuthConfigurationError(
            "YOUDUB_AUTH_SESSION_TTL_SECONDS must be between 300 and 2678400."
        )

    cookie_samesite = os.getenv("YOUDUB_AUTH_COOKIE_SAMESITE", "lax").strip().lower()
    if cookie_samesite not in {"lax", "strict"}:
        raise AuthConfigurationError("YOUDUB_AUTH_COOKIE_SAMESITE must be lax or strict.")

    return AuthSettings(
        password_hash=password_hash,
        session_ttl_seconds=session_ttl_seconds,
        cookie_secure=_parse_bool("YOUDUB_AUTH_COOKIE_SECURE", False),
        cookie_samesite=cookie_samesite,
    )


def validate_auth_configuration() -> AuthSettings:
    settings = load_auth_settings()
    if not _PASSWORD_HASHER.current_hasher.identify(settings.password_hash):
        raise AuthConfigurationError("YOUDUB_AUTH_PASSWORD_HASH is invalid.")
    return settings


def verify_password(password: str, settings: AuthSettings) -> bool:
    if not password or len(password) > MAX_PASSWORD_LENGTH:
        return False
    try:
        return _PASSWORD_HASHER.verify(password, settings.password_hash)
    except (PwdlibError, ValueError) as exc:
        raise AuthConfigurationError("YOUDUB_AUTH_PASSWORD_HASH is invalid.") from exc


def _urlsafe_digest(prefix: bytes, value: str) -> str:
    digest = hashlib.sha256(prefix + value.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def credential_version(password_hash: str) -> str:
    return _urlsafe_digest(b"youdub-credential\x00", password_hash)

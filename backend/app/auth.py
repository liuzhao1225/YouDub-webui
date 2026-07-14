from __future__ import annotations

import base64
import hashlib
import math
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from . import database


SESSION_COOKIE_NAME = "youdub_session"
SESSION_COOKIE_PATH = "/api"
CSRF_HEADER_NAME = "X-CSRF-Token"
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
MIN_SESSION_TTL_SECONDS = 5 * 60
MAX_SESSION_TTL_SECONDS = 31 * 24 * 60 * 60
MAX_PASSWORD_LENGTH = 1024
LOGIN_RATE_LIMIT_ATTEMPTS = 5
LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
PUBLIC_ROUTES = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
}

_PASSWORD_HASHER = PasswordHash.recommended()


class AuthConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthSettings:
    password_hash: str
    session_ttl_seconds: int
    cookie_secure: bool
    cookie_samesite: Literal["lax", "strict"]


@dataclass(frozen=True)
class AuthenticatedSession:
    token_hash: str
    csrf_token: str
    expires_at: str


@dataclass(frozen=True)
class LoginRateLimit:
    allowed: bool
    retry_after_seconds: int


def _parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise AuthConfigurationError(f"{name} must be true or false.")


def load_auth_settings() -> AuthSettings:
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


def session_token_hash(token: str) -> str:
    return _urlsafe_digest(b"youdub-session\x00", token)


def csrf_token_for_session(token: str) -> str:
    return _urlsafe_digest(b"youdub-csrf\x00", token)


def credential_version(password_hash: str) -> str:
    return _urlsafe_digest(b"youdub-credential\x00", password_hash)


def login_client_hash(client_host: str) -> str:
    normalized_host = client_host.strip().lower() or "unknown"
    return _urlsafe_digest(b"youdub-login-client\x00", normalized_host)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def create_session(settings: AuthSettings) -> tuple[str, AuthenticatedSession]:
    now = _utc_now()
    expires_at = now + timedelta(seconds=settings.session_ttl_seconds)
    token = secrets.token_urlsafe(32)
    token_hash = session_token_hash(token)
    database.delete_expired_auth_sessions(_iso(now))
    database.create_auth_session(
        token_hash=token_hash,
        credential_version=credential_version(settings.password_hash),
        created_at=_iso(now),
        expires_at=_iso(expires_at),
    )
    return token, AuthenticatedSession(
        token_hash=token_hash,
        csrf_token=csrf_token_for_session(token),
        expires_at=_iso(expires_at),
    )


def authenticate_session(token: str, settings: AuthSettings) -> AuthenticatedSession | None:
    if not token or len(token) > 256:
        return None
    token_hash = session_token_hash(token)
    row = database.get_auth_session(token_hash)
    if not row:
        return None

    expected_version = credential_version(settings.password_hash)
    expired = row["expires_at"] <= _iso(_utc_now())
    credentials_changed = not secrets.compare_digest(
        str(row["credential_version"]), expected_version
    )
    if expired or credentials_changed:
        database.delete_auth_session(token_hash)
        return None

    return AuthenticatedSession(
        token_hash=token_hash,
        csrf_token=csrf_token_for_session(token),
        expires_at=str(row["expires_at"]),
    )


def revoke_session_token(token: str) -> bool:
    if not token or len(token) > 256:
        return False
    return database.delete_auth_session(session_token_hash(token))


def reserve_login_attempt(client_host: str) -> LoginRateLimit:
    now = _utc_now()
    stale_before = now - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS)
    allowed, window_started_at = database.reserve_auth_login_attempt(
        client_hash=login_client_hash(client_host),
        now=_iso(now),
        stale_before=_iso(stale_before),
        max_attempts=LOGIN_RATE_LIMIT_ATTEMPTS,
    )
    if allowed:
        return LoginRateLimit(allowed=True, retry_after_seconds=0)

    retry_at = datetime.fromisoformat(window_started_at) + timedelta(
        seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS
    )
    retry_after = max(1, math.ceil((retry_at - now).total_seconds()))
    return LoginRateLimit(allowed=False, retry_after_seconds=retry_after)


def clear_login_attempts(client_host: str) -> None:
    database.delete_auth_login_attempt(login_client_hash(client_host))


def set_session_cookie(
    response: Response, token: str, settings: AuthSettings, expires_at: str
) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.session_ttl_seconds,
        expires=datetime.fromisoformat(expires_at),
        path=SESSION_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def clear_session_cookie(response: Response, settings: AuthSettings) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path=SESSION_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def _protected_path(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


def _json_error(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers={"Cache-Control": "no-store"},
    )


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        allowed_origins: list[str],
        allowed_origin_regex: str,
    ) -> None:
        super().__init__(app)
        self.allowed_origins = set(allowed_origins)
        self.allowed_origin_regex = re.compile(allowed_origin_regex)

    def _origin_allowed(self, request: Request) -> bool:
        origin = request.headers.get("origin")
        if not origin:
            return True
        if request.headers.get("sec-fetch-site", "").lower() == "same-origin":
            return True
        return origin in self.allowed_origins or bool(self.allowed_origin_regex.fullmatch(origin))

    async def _call_next_no_store(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        if _protected_path(request.url.path) and 200 <= response.status_code < 300:
            response.headers["Cache-Control"] = "no-store"
        return response

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        method = request.method.upper()
        path = request.url.path

        if method == "OPTIONS" or not _protected_path(path):
            return await self._call_next_no_store(request, call_next)

        if (method, path) == ("POST", "/api/auth/login"):
            if not self._origin_allowed(request):
                return _json_error(403, "Origin is not allowed.")
            return await self._call_next_no_store(request, call_next)
        if (method, path) in PUBLIC_ROUTES:
            return await self._call_next_no_store(request, call_next)

        try:
            settings = validate_auth_configuration()
        except AuthConfigurationError:
            return _json_error(503, "Authentication is not configured.")

        token = request.cookies.get(SESSION_COOKIE_NAME, "")
        session = authenticate_session(token, settings)
        if session is None:
            response = _json_error(401, "Authentication required.")
            if token:
                clear_session_cookie(response, settings)
            return response

        request.state.auth_session = session
        request.state.auth_settings = settings

        if method not in SAFE_METHODS:
            csrf_token = request.headers.get(CSRF_HEADER_NAME, "")
            if not csrf_token or not secrets.compare_digest(csrf_token, session.csrf_token):
                return _json_error(403, "CSRF validation failed.")
            if not self._origin_allowed(request):
                return _json_error(403, "Origin is not allowed.")

        return await self._call_next_no_store(request, call_next)

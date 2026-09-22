"""MVP business storage in a new user data directory, separate from legacy data."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .. import runtime_security
from .credentials import Credentials, CredentialStoreError, SystemCredentials
from .errors import ApiError


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def data_directory() -> Path:
    configured = os.getenv("YOUDUB_DESKTOP_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "YouDub"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "YouDub"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "youdub"


class Store:
    def __init__(self, root: Path, credentials: Credentials | None = None) -> None:
        self.root = root
        self.path = root / "desktop.sqlite"
        self.credentials = credentials if credentials is not None else SystemCredentials()
        self._settings_lock = threading.RLock()
        try:
            runtime_security.ensure_private_directory(root)
            runtime_security.secure_sqlite_database_file(self.path)
        except runtime_security.RuntimeSecurityError as exc:
            raise ApiError(503, "RUNTIME_UNAVAILABLE", "The desktop data directory cannot be used safely.", action="contact_support") from exc
        with self.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                    raise ApiError(503, "RUNTIME_UNAVAILABLE", "The desktop database must be a new MVP database.", action="contact_support")
                conn.executescript(Path(__file__).with_name("schema.sql").read_text())
            elif version != 1:
                raise ApiError(503, "RUNTIME_UNAVAILABLE", f"Unsupported desktop database version: {version}", action="contact_support")

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _settings_values(self) -> dict:
        with self.connect() as conn:
            return {row["key"]: json.loads(row["value_json"])
                    for row in conn.execute("SELECT key, value_json FROM settings")}

    def _save_setting(self, key: str, value) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO settings(key, value_json, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
                (key, json.dumps(value, ensure_ascii=False), now_iso()),
            )

    def read_settings(self) -> dict:
        with self._settings_lock:
            values = self._settings_values()
            connections = []
            for connection in values.get("connections", []):
                reference = connection.get("credential_ref")
                connections.append({
                    "adapter": connection["adapter"], "base_url": connection["base_url"],
                    "has_api_key": bool(reference and self.credentials.get(reference)),
                })
            return {"defaults": values.get("defaults"), "connections": connections,
                    "ui_language": values.get("ui_language", "en")}

    def patch_settings(self, patch) -> dict:
        with self._settings_lock:
            if "defaults" in patch.model_fields_set:
                self._save_setting("defaults", patch.defaults.model_dump(mode="json"))
            elif "ui_language" in patch.model_fields_set:
                self._save_setting("ui_language", patch.ui_language)
            else:
                self._patch_connection(patch.connection)
            return self.read_settings()

    def _patch_connection(self, patch) -> None:
        connections = self._settings_values().get("connections", [])
        previous = next((item for item in connections if item["adapter"] == patch.adapter), None)
        base_url = str(patch.base_url) if "base_url" in patch.model_fields_set else (previous or {}).get("base_url")
        if not base_url:
            raise ApiError(422, "INVALID_CONFIG", "A base URL is required for a new connection.", field="connection.base_url")
        previous_reference = (previous or {}).get("credential_ref")
        reference = previous_reference
        if not previous or previous["base_url"] != base_url:
            reference = None

        with self.connect() as conn:
            pinned = previous_reference and conn.execute(
                "SELECT 1 FROM tasks, json_each(tasks.stage_context_json, '$.credential_refs') AS refs "
                "WHERE refs.value = ? LIMIT 1", (previous_reference,),
            ).fetchone()

        credentials_changed = False
        cleared_reference = None
        if "api_key" in patch.model_fields_set:
            if patch.api_key is None:
                if reference:
                    self.credentials.delete(reference)
                    credentials_changed = True
                    cleared_reference = reference
                reference = None
            else:
                reference = str(uuid.uuid4())
                self.credentials.set(reference, patch.api_key.get_secret_value())
                credentials_changed = True

        # Task snapshots pin credential_refs in stage_context_json. Preserve a
        # referenced credential when changing defaults; remove unused old keys.
        if previous_reference and previous_reference not in {reference, cleared_reference} and not pinned:
            try:
                self.credentials.delete(previous_reference)
                credentials_changed = True
            except CredentialStoreError as exc:
                if credentials_changed:
                    raise ApiError(500, "SETTINGS_PARTIALLY_APPLIED", "A new credential was saved, but the previous credential could not be removed.", field="connection", action="contact_support") from exc
                raise

        connection = {"adapter": patch.adapter, "base_url": base_url, "credential_ref": reference}
        updated = [item for item in connections if item["adapter"] != patch.adapter]
        updated.append(connection)
        try:
            self._save_setting("connections", updated)
        except sqlite3.Error as exc:
            if credentials_changed:
                raise ApiError(
                    500, "SETTINGS_PARTIALLY_APPLIED",
                    "Credentials changed, but settings could not be saved. Read settings before retrying.",
                    field="connection", action="contact_support",
                ) from exc
            raise

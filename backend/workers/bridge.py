"""Serial persistent RPC bridge for SQLite and narrow OS integrations."""
from __future__ import annotations

import argparse
import json
import sys
import traceback
import uuid
from pathlib import Path

from .protocol import VERSION, WorkerError, encode, error_payload
from .store import SqliteStore


class Bridge:
    def __init__(self, root: Path, legacy_db: Path | None = None, credentials=None):
        from backend.app.v1.credentials import SystemCredentials
        self.store = SqliteStore(root, legacy_db)
        self.credentials = credentials if credentials is not None else SystemCredentials()

    def settings(self):
        values = self.store.settings_values()
        connections = [{"adapter": item["adapter"], "base_url": item["base_url"],
                        "has_api_key": bool(item.get("credential_ref") and self.credentials.get(item["credential_ref"]))}
                       for item in values.get("connections", [])]
        return {"defaults": values.get("defaults"), "connections": connections,
                "ui_language": values.get("ui_language", "en")}

    def patch_settings(self, patch):
        from backend.app.v1.contracts import SettingsPatch
        from backend.app.v1.credentials import CredentialStoreError
        validated = SettingsPatch.model_validate(patch)
        if "defaults" in validated.model_fields_set:
            self.store.write_setting("defaults", validated.defaults.model_dump(mode="json"))
        elif "ui_language" in validated.model_fields_set:
            self.store.write_setting("ui_language", validated.ui_language)
        else:
            update = validated.connection
            connections = self.store.settings_values().get("connections", [])
            old = next((item for item in connections if item["adapter"] == update.adapter), None)
            base = str(update.base_url) if "base_url" in update.model_fields_set else (old or {}).get("base_url")
            if not base:
                raise WorkerError("INVALID_CONFIG", "A new connection requires a base URL.")
            previous = (old or {}).get("credential_ref")
            reference = previous if old and old["base_url"] == base else None
            changed = False
            cleared = None
            try:
                if "api_key" in update.model_fields_set:
                    if update.api_key is None:
                        if reference:
                            self.credentials.delete(reference)
                            changed, cleared = True, reference
                        reference = None
                    else:
                        reference = str(uuid.uuid4())
                        self.credentials.set(reference, update.api_key.get_secret_value())
                        changed = True
                if previous and previous not in {reference, cleared} and not self.store.credential_pinned(previous):
                    self.credentials.delete(previous)
                    changed = True
                connections = [item for item in connections if item["adapter"] != update.adapter]
                connections.append({"adapter": update.adapter, "base_url": base, "credential_ref": reference})
                self.store.write_setting("connections", connections)
            except Exception as exc:
                if changed:
                    raise WorkerError("SETTINGS_PARTIALLY_APPLIED", "Credentials changed before the remaining settings operation failed.",
                                      {"cause": type(exc).__name__, "message": str(exc)}) from exc
                raise
        return self.settings()

    def call(self, method, params):
        if method.startswith("store."):
            operation = method.removeprefix("store.")
            functions = {"create": self.store.create, "get": self.store.get, "list": self.store.list,
                         "cas": self.store.cas, "claim": self.store.claim, "delete": self.store.delete}
            if operation not in functions:
                raise WorkerError("UNKNOWN_METHOD", f"Unknown storage operation: {operation}")
            return functions[operation](**params)
        if method == "settings.get":
            return self.settings()
        if method == "settings.raw":
            return {"defaults": None, "connections": [], "ui_language": "en", **self.store.settings_values()}
        if method == "settings.patch":
            return self.patch_settings(params["patch"])
        if method == "settings.write":
            # Namespaced plugin settings are opaque JSON; public schema
            # validation belongs to their Cordis settings provider.
            if not isinstance(params.get("key"), str) or not params["key"]:
                raise WorkerError("INVALID_CONFIG", "A settings namespace is required.")
            self.store.write_setting(params["key"], params["value"])
            return None
        if method == "runtime.get":
            from backend.app.v1.runtime import build_runtime
            settings = self.settings()
            default_model = ((settings.get("defaults") or {}).get("translation") or {}).get("model")
            return build_runtime(connections=params.get("connections", settings["connections"]),
                                 translation_model=params.get("translationModel", default_model))
        if method in {"secrets.get", "secrets.set", "secrets.delete"}:
            if method == "secrets.get":
                return self.credentials.get(params["reference"])
            if method == "secrets.set":
                self.credentials.set(params["reference"], params["value"])
            else:
                self.credentials.delete(params["reference"])
            return None
        if method.startswith("auth."):
            from backend.app import auth
            operation = method.removeprefix("auth.")
            if operation == "validate":
                settings = auth.validate_auth_configuration()
                return {"cookieName": auth.session_cookie_name(), "sessionTtlSeconds": settings.session_ttl_seconds,
                        "cookieSecure": settings.cookie_secure, "cookieSameSite": settings.cookie_samesite,
                        "credentialVersion": auth.credential_version(settings.password_hash)}
            if operation == "verify_password":
                return {"valid": auth.verify_password(params["password"], auth.load_auth_settings())}
            return self.store.auth(operation, params)
        if method.startswith("legacy."):
            if self.store.legacy_db is None or not self.store.legacy_db.is_file():
                return {"items": [], "hasMore": False, "limit": params.get("limit", 20), "offset": params.get("offset", 0)} if method == "legacy.list" else None
            with self.store.legacy_connection() as conn:
                if method == "legacy.get":
                    row = conn.execute("SELECT * FROM tasks WHERE id=?", (params["id"],)).fetchone()
                    return {"legacy": True, "rawSnapshot": dict(row), "id": row["id"]} if row else None
                if method == "legacy.list":
                    limit, offset = params.get("limit", 20), params.get("offset", 0)
                    if type(limit) is not int or not 1 <= limit <= 1000 or type(offset) is not int or offset < 0:
                        raise WorkerError("INVALID_QUERY", "Invalid legacy pagination.")
                    rows = conn.execute("SELECT * FROM tasks ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (limit + 1, offset)).fetchall()
                    return {"items": [{"legacy": True, "rawSnapshot": dict(row), "id": row["id"]} for row in rows[:limit]],
                            "hasMore": len(rows) > limit, "limit": limit, "offset": offset}
        raise WorkerError("UNKNOWN_METHOD", f"Unknown bridge method: {method}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--legacy-db", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "youdub.sqlite")
    args = parser.parse_args()
    output = sys.stdout
    sys.stdout = sys.stderr
    # Load application environment without importing the old application entry.
    from backend.app import config  # noqa: F401
    try:
        bridge = Bridge(args.data_dir, args.legacy_db)
    except BaseException:
        traceback.print_exc(file=sys.stderr)
        return 1
    sequence = 0
    incoming = 0
    for line in sys.stdin:
        request_id = None
        try:
            envelope = json.loads(line)
            request_id = envelope.get("requestId")
            if envelope.get("version") != VERSION or envelope.get("type") != "request" or not isinstance(request_id, str):
                raise WorkerError("PROTOCOL_ERROR", "Invalid RPC request envelope.")
            if envelope.get("seq") != incoming + 1:
                raise WorkerError("PROTOCOL_ERROR", "RPC message sequence is not contiguous.")
            incoming += 1
            payload = envelope["payload"]
            result = bridge.call(payload["method"], payload.get("params", {}))
            kind = "result"
        except BaseException as exc:
            traceback.print_exc(file=sys.stderr)
            result, kind = error_payload(exc), "error"
        sequence += 1
        output.write(encode({"version": VERSION, "requestId": request_id, "seq": sequence, "type": kind, "payload": result}))
        output.flush()
        if kind == "error" and result["code"] == "PROTOCOL_ERROR":
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

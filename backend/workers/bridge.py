"""Persistent RPC bridge for SQLite and local model readiness."""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

from .protocol import VERSION, WorkerError, encode, error_payload
from .store import SqliteStore


class Bridge:
    def __init__(self, root: Path):
        self.store = SqliteStore(root)
        self.store.migrate_connection_model()

    def call(self, method, params):
        if method.startswith("store."):
            operation = method.removeprefix("store.")
            functions = {"create": self.store.create, "get": self.store.get, "list": self.store.list,
                         "cas": self.store.cas, "claim": self.store.claim, "delete": self.store.delete,
                         "workflow_list": self.store.workflow_list, "workflow_get": self.store.workflow_get,
                         "workflow_create": self.store.workflow_create, "workflow_update": self.store.workflow_update,
                         "workflow_delete": self.store.workflow_delete,
                         "workflow_migrate_defaults": self.store.workflow_migrate_defaults}
            if operation not in functions:
                raise WorkerError("UNKNOWN_METHOD", f"Unknown storage operation: {operation}")
            return functions[operation](**params)
        if method == "settings.raw":
            return {"defaults": None, "connections": [], "ui_language": "en", **self.store.settings_values()}
        if method == "settings.validate_defaults":
            from pydantic import ValidationError
            from backend.app.v1.contracts import TaskConfig
            try:
                return TaskConfig.model_validate(params["defaults"]).model_dump(mode="json")
            except ValidationError as exc:
                raise WorkerError("INVALID_CONFIG", "Saved processing preferences do not match the required format.",
                                  exc.errors(include_input=False, include_context=False, include_url=False)) from exc
        if method == "settings.write":
            # Namespaced plugin settings are opaque JSON; public schema
            # validation belongs to their Cordis settings provider.
            if not isinstance(params.get("key"), str) or not params["key"]:
                raise WorkerError("INVALID_CONFIG", "A settings namespace is required.")
            self.store.write_setting(params["key"], params["value"])
            return None
        if method == "runtime.info":
            from backend.app.accelerators import detect_devices
            from backend.app.v1.runtime import runtime_info
            detect_devices.cache_clear()
            return runtime_info()
        if method == "runtime.probe":
            from backend.app.accelerators import detect_devices
            from backend.app.v1.runtime import probe_capability
            # This bridge may predate FFmpeg installation. The Host resolves the
            # current managed paths without restarting the SQLite process.
            environment = params.get("mediaEnvironment", {})
            for key in ("FFMPEG_PATH", "FFPROBE_PATH", "PATH"):
                if key in environment:
                    os.environ[key] = environment[key]
            detect_devices.cache_clear()
            return probe_capability(params["adapter"])
        raise WorkerError("UNKNOWN_METHOD", f"Unknown bridge method: {method}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    output = sys.stdout
    sys.stdout = sys.stderr
    # Load application environment without importing the old application entry.
    from backend.app import config  # noqa: F401
    try:
        bridge = Bridge(args.data_dir)
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

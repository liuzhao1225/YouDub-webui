"""Small NDJSON transport shared by the managed Python entry points."""
from __future__ import annotations

import json
import os
import queue
import sys
import threading
import traceback
import uuid

VERSION = "youdub-worker/v1"


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str, details=None):
        super().__init__(message)
        self.code, self.details = code, details


def error_payload(exc: BaseException) -> dict:
    if hasattr(exc, "content"):
        return {**exc.content["error"], "type": type(exc).__name__, "status": exc.status_code}
    code = getattr(exc, "code", "PYTHON_ERROR")
    status = 404 if code in {"TASK_NOT_FOUND", "LEGACY_NOT_FOUND"} else (
        409 if code in {"REVISION_CONFLICT", "TASK_EXISTS", "TASK_BUSY", "LEGACY_READ_ONLY", "IMMUTABLE_SNAPSHOT", "MIGRATION_ACTIVE_TASKS"} else
        422 if code in {"INVALID_TASK", "INVALID_QUERY", "INVALID_CONFIG", "INVALID_INPUT", "INVALID_SUBTITLES"} else 500)
    return {"code": code, "message": str(exc), "status": status,
            "type": type(exc).__name__, "details": getattr(exc, "details", None)}


def encode(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"


class OperationWire:
    """One invocation; the reader also receives cancellation during computation."""

    def __init__(self):
        self.output = sys.stdout
        sys.stdout = sys.stderr
        self.messages: queue.Queue = queue.Queue()
        self.cancelled = threading.Event()
        self.disconnected = threading.Event()
        self.seq = 0
        self.input_seq = 0
        self.invocation_id = None
        self.external = None
        self.secret_values: list[str] = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        pending = b""
        try:
            while True:
                block = os.read(sys.stdin.fileno(), 65536)
                if not block:
                    if pending.strip():
                        raise WorkerError("PROTOCOL_ERROR", "Host closed an incomplete NDJSON message.")
                    self.disconnected.set()
                    self.messages.put(None)
                    return
                pending += block
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    message = json.loads(line)
                    if not isinstance(message, dict) or message.get("version") != VERSION:
                        raise WorkerError("PROTOCOL_ERROR", "Unsupported worker envelope.")
                    seq = message.get("seq")
                    if type(seq) is not int or seq != self.input_seq + 1:
                        raise WorkerError("PROTOCOL_ERROR", "Host message sequence is not contiguous.")
                    self.input_seq = seq
                    if self.invocation_id is None:
                        self.invocation_id = message.get("invocationId")
                    if not self.invocation_id or message.get("invocationId") != self.invocation_id:
                        raise WorkerError("PROTOCOL_ERROR", "Worker invocation ID differs.")
                    if message.get("type") == "cancel":
                        self.cancelled.set()
                    self.messages.put(message)
        except BaseException as exc:
            self.messages.put(exc)
            self.disconnected.set()

    def receive(self) -> dict:
        message = self.messages.get()
        if isinstance(message, BaseException):
            raise message
        if message is None:
            raise WorkerError("HOST_DISCONNECTED", "Host input closed before the invocation finished.")
        return message

    def send(self, kind: str, payload: object):
        self.seq += 1
        self.output.write(encode({"version": VERSION, "invocationId": self.invocation_id,
                                  "seq": self.seq, "type": kind, "payload": payload}))
        self.output.flush()

    def check_cancel(self):
        if self.cancelled.is_set():
            raise WorkerError("CANCELLED", "The host cancelled this invocation.")
        if self.disconnected.is_set():
            # Preserve the actual parser failure when one was received.
            while not self.messages.empty():
                item = self.messages.get_nowait()
                if isinstance(item, BaseException):
                    raise item
            raise WorkerError("HOST_DISCONNECTED", "Host input closed during execution.")

    def cancel(self):
        """Wake protocol waits as well as the media subprocess polling loop."""
        self.cancelled.set()
        self.messages.put({"type": "cancel", "payload": {}})

    def progress(self, value: float | None, message: str):
        self.check_cancel()
        self.send("progress", {"value": value, "message": self.redact(message)})

    def _ack(self, kind: str, external_id: str):
        while True:
            message = self.receive()
            if message["type"] == "cancel":
                self.check_cancel()
            if message["type"] != kind or message.get("payload", {}).get("externalRequestId") != external_id:
                raise WorkerError("PROTOCOL_ERROR", f"Expected {kind} for the current external request.")
            return

    def external_state(self, state: str):
        if state == "pending":
            self.check_cancel()
            if self.external is not None:
                raise WorkerError("PROTOCOL_ERROR", "The previous external request has no terminal receipt.")
            request_id = str(uuid.uuid4())
            self.external = {"externalRequestId": request_id, "requestKey": request_id,
                             "state": "pending", "mayStillRun": True}
            self.send("external.prepare", self.external)
            self._ack("external.accepted", request_id)
            self.check_cancel()
        else:
            if state not in {"succeeded", "failed", "unknown"} or self.external is None:
                raise WorkerError("PROTOCOL_ERROR", "External receipt has no matching pending request.")
            event = {**self.external, "state": state, "mayStillRun": state == "unknown"}
            self.send("external.update", event)
            self._ack("external.recorded", event["externalRequestId"])
            self.external = None
            self.check_cancel()

    def redact(self, value: str) -> str:
        for secret in self.secret_values:
            if secret:
                value = value.replace(secret, "[redacted]")
        return value

    def fail(self, exc: BaseException):
        if self.external is not None:
            # No further provider call follows an error. Host persists this
            # event before processing the terminal error.
            self.send("external.update", {**self.external, "state": "unknown", "mayStillRun": True})
        diagnostic = "".join(traceback.format_exception(exc))
        sys.stderr.write(self.redact(diagnostic))
        payload = error_payload(exc)
        payload["message"] = self.redact(payload["message"])
        self.send("error", payload)

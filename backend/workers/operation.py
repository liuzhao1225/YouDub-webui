"""Run exactly one operation. Start with python -m backend.workers.operation."""
from __future__ import annotations

import signal

from .protocol import OperationWire, WorkerError


def main() -> int:
    wire = OperationWire()
    # Node terminates the entire execution group. Keep this parent alive long
    # enough for _run_media to terminate and reap its actual model/ffmpeg child.
    previous_terminate = signal.signal(signal.SIGTERM, lambda *_: wire.cancel())
    try:
        envelope = wire.receive()
        wire.check_cancel()
        if envelope["type"] != "execute":
            raise WorkerError("PROTOCOL_ERROR", "The first message must execute one operation.")
        request = envelope["payload"]
        if "invocationId" in request and request["invocationId"] != wire.invocation_id:
            raise WorkerError("PROTOCOL_ERROR", "Payload invocation ID differs from envelope.")
        wire.secret_values = [item["api_key"] for item in request.get("credentials", {}).values() if item.get("api_key")]
        from .operations import Operation
        wire.send("result", Operation(request, wire).execute())
        return 0
    except BaseException as exc:
        wire.fail(exc)
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_terminate)


if __name__ == "__main__":
    raise SystemExit(main())

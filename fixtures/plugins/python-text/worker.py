"""A standalone Python provider; no YouDub Python package import is required."""
import json
from pathlib import Path
import sys
import traceback


request = json.loads(sys.stdin.readline())
try:
    if request["version"] != "youdub-worker/v1" or request["type"] != "execute":
        raise ValueError("Expected a youdub-worker/v1 execute message.")
    invocation = request["payload"]
    source = Path(invocation["inputs"]["document"]["path"])
    target = Path(invocation["workDir"]) / "uppercase.txt"
    with target.open("x", encoding="utf-8") as output:
        output.write(source.read_text(encoding="utf-8").upper())
    message_type = "result"
    payload = {
        "state": "completed",
        "outputs": {"document": {"$artifact": "document"}},
        "artifacts": {"document": {"path": "uppercase.txt", "mimeType": "text/plain", "schemaId": "file/v1"}},
    }
except Exception as error:
    message_type = "error"
    payload = {"code": "PYTHON_TRANSFORM_FAILED", "type": type(error).__name__, "message": str(error)}
    traceback.print_exc(file=sys.stderr)

print(json.dumps({"version": "youdub-worker/v1", "invocationId": request["invocationId"], "seq": 1, "type": message_type, "payload": payload}), flush=True)
if message_type == "error":
    sys.exit(1)

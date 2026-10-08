from __future__ import annotations

import json
import os
import select
import signal
import shutil
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import pytest

from backend.app.v1 import asr, tts
from backend.app.v1.segments import Transcript
from backend.workers.operations import Operation
from backend.workers.protocol import VERSION, WorkerError

ROOT = Path(__file__).parents[2]


class Wire:
    def check_cancel(self):
        pass
    def progress(self, value, message):
        pass
    def external_state(self, state):
        raise AssertionError("This operation must not contact a supplier")


def invoke(root, name, inputs, config=None, binding=None):
    return Operation({"taskId": str(uuid4()), "attempt": 1, "stepId": name,
                      "operation": name, "workDir": str(root / "work" / str(uuid4())),
                      "taskDir": str(root), "inputs": inputs, "config": config or {},
                      "binding": binding or {}}, Wire())


def test_standard_word_timing_supports_reference_without_provider_raw_file():
    words = [{"word": f" word{i}", "start": i * 2, "end": i * 2 + 2} for i in range(7)]
    raw = {"language": "en", "segments": [{"start": 0, "end": 14, "text": "".join(w["word"] for w in words), "words": words}]}
    normalized = asr.normalize_result(raw, duration_ms=14000)
    assert normalized["segments"][0]["words"][1] == {"text": " word1", "start_ms": 2000, "end_ms": 4000}
    reference = tts.speaker_references(Transcript.model_validate(normalized))[None]
    assert reference[-1].end_ms - reference[0].start_ms <= 10000
    assert reference[0].text == " word0 word1 word2 word3 word4"


def test_file_input_and_output_cannot_escape_task_and_invocation(tmp_path):
    root = tmp_path / "task"
    root.mkdir()
    other = tmp_path / "outside.wav"
    other.write_bytes(b"some audio")
    operation = invoke(root, "voice.reference/v1", {})
    with pytest.raises(WorkerError, match="outside"):
        operation.path({"path": str(other)})
    inside = root / "source.wav"
    inside.write_bytes(b"some audio")
    with pytest.raises(WorkerError, match="invocation"):
        operation.artifact("audio", inside, "audio/wav/v1", "audio/wav")


def test_actual_video_prepare_external_subtitle_import_and_export(tmp_path):
    from backend.app.config import ffmpeg_binary, ffprobe_binary
    if not shutil.which(ffmpeg_binary()) or not shutil.which(ffprobe_binary()):
        pytest.skip("Real media bridge verification requires ffmpeg and ffprobe")
    video = tmp_path / "source.mp4"
    subprocess.run([ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=25",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(video)], check=True, capture_output=True)
    prepare = invoke(tmp_path, "media.prepare/v1", {"video": {"path": str(video)}})
    prepared = prepare.execute()
    assert prepared["outputs"]["mediaInfo"]["duration_ms"] == 1000
    assert prepared["artifacts"]["sourceAudio"]["metadata"]["channels"] == 2
    source, translated = tmp_path / "source.srt", tmp_path / "translated.srt"
    source.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello world.\n")
    translated.write_text("1\n00:00:00,000 --> 00:00:01,000\n你好世界。\n")
    imported = invoke(tmp_path, "subtitles.import/v1", {"sourceSubtitles": {"path": str(source)}, "translatedSubtitles": {"path": str(translated)}}).execute()
    export = invoke(tmp_path, "media.export/v1", {"video": {"path": str(video)}, "mediaInfo": prepared["outputs"]["mediaInfo"], **imported["outputs"]},
                    {"outputMode": "subtitles", "targetLanguage": "zh"})
    exported = export.execute()
    assert set(exported["outputs"]) == {"video", "sourceSubtitles", "translatedSubtitles"}
    for descriptor in exported["artifacts"].values():
        assert not Path(descriptor["path"]).is_absolute() and ".." not in Path(descriptor["path"]).parts
        assert (export.work / descriptor["path"]).is_file()
    completed = export.work / exported["artifacts"]["video"]["path"]
    result = subprocess.run([ffprobe_binary(), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(completed)], capture_output=True, check=True)
    assert float(json.loads(result.stdout)["format"]["duration"]) == pytest.approx(1.0, abs=0.05)


def send(process, invocation_id, seq, kind, payload):
    process.stdin.write(json.dumps({"version": VERSION, "invocationId": invocation_id, "seq": seq, "type": kind, "payload": payload}) + "\n")
    process.stdin.flush()


def read(process):
    assert select.select([process.stdout], [], [], 5)[0], "Worker did not reply"
    return json.loads(process.stdout.readline())


def test_external_request_waits_for_corresponding_durable_ack():
    script = "from backend.workers.protocol import OperationWire; w=OperationWire(); w.receive(); w.external_state('pending'); w.external_state('succeeded'); w.send('result',{'state':'completed'})"
    process = subprocess.Popen([sys.executable, "-c", script], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = str(uuid4())
        send(process, request, 1, "execute", {})
        pending = read(process)
        assert pending["type"] == "external.prepare"
        external_id = pending["payload"]["externalRequestId"]
        assert not select.select([process.stdout], [], [], 0.05)[0]
        send(process, request, 2, "external.accepted", {"externalRequestId": external_id})
        receipt = read(process)
        assert receipt["type"] == "external.update" and receipt["payload"]["state"] == "succeeded"
        assert not select.select([process.stdout], [], [], 0.05)[0]
        send(process, request, 3, "external.recorded", {"externalRequestId": external_id})
        assert read(process)["type"] == "result"
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate()


def test_one_shot_worker_reports_unknown_operation_as_failure(tmp_path):
    process = subprocess.Popen([sys.executable, "-m", "backend.workers.operation"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = str(uuid4())
        send(process, request, 1, "execute", {"operation": "missing/v1", "workDir": str(tmp_path / "work"), "taskDir": str(tmp_path), "inputs": {}})
        error = read(process)
        assert error["type"] == "error" and error["payload"]["code"] == "UNSUPPORTED_OPERATION"
        assert process.wait(timeout=5) == 1
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate()


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX process group cancellation")
def test_managed_sigterm_waits_for_stubborn_model_child_to_be_reaped(tmp_path):
    child_pid_file = tmp_path / "model.pid"
    child_script = (
        "import os,signal,time; from pathlib import Path; "
        "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
        f"Path({str(child_pid_file)!r}).write_text(str(os.getpid())); time.sleep(30)"
    )
    script = (
        "import sys; from backend.workers.operations import Operation; "
        "from backend.app.v1.media import _run_media; "
        f"Operation.execute=lambda self: _run_media([sys.executable,'-c',{child_script!r}],check_cancel=self.wire.check_cancel); "
        "from backend.workers.operation import main; raise SystemExit(main())"
    )
    process = subprocess.Popen([sys.executable, "-c", script], cwd=ROOT, start_new_session=True,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        send(process, str(uuid4()), 1, "execute", {"operation": "test/v1", "taskDir": str(tmp_path), "workDir": str(tmp_path / "work")})
        deadline = time.monotonic() + 5
        while not child_pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert child_pid_file.exists(), "Model child never started"
        child_pid = int(child_pid_file.read_text())
        os.killpg(process.pid, signal.SIGTERM)
        assert process.wait(timeout=5) == 1
        error = json.loads(process.stdout.readline())
        assert error["type"] == "error" and error["payload"]["code"] == "CANCELLED"
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()


@pytest.mark.parametrize("terminal", ["succeeded", "failed"])
def test_cancellation_waiting_for_terminal_receipt_ack_preserves_known_result(terminal):
    script = f'''from backend.workers.protocol import OperationWire
w = OperationWire()
try:
    w.receive()
    w.external_state("pending")
    w.external_state({terminal!r})
except BaseException as exc:
    w.fail(exc)
    raise SystemExit(1)
'''
    process = subprocess.Popen([sys.executable, "-c", script], cwd=ROOT, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = str(uuid4())
        send(process, request, 1, "execute", {})
        pending = read(process)
        external_id = pending["payload"]["externalRequestId"]
        send(process, request, 2, "external.accepted", {"externalRequestId": external_id})
        receipt = read(process)
        assert receipt["type"] == "external.update" and receipt["payload"]["state"] == terminal
        assert receipt["payload"]["mayStillRun"] is False
        # The terminal event is known to the worker and received by Host. A
        # cancellation while Host commits it must not emit a contradictory risk.
        send(process, request, 3, "cancel", {})
        assert not select.select([process.stdout], [], [], 0.05)[0]
        assert process.poll() is None
        send(process, request, 4, "external.recorded", {"externalRequestId": external_id})
        error = read(process)
        assert error["type"] == "error"
        assert error["payload"]["code"] == "CANCELLED"
        assert process.wait(timeout=5) == 1
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate()


@pytest.mark.parametrize("cancel_while_committing", [False, True])
def test_error_receipt_is_acknowledged_before_original_error_and_exit(cancel_while_committing):
    script = '''from backend.workers.protocol import OperationWire, WorkerError
w = OperationWire()
try:
    w.receive()
    w.external_state("pending")
    raise WorkerError("REMOTE_TIMEOUT", "synthetic provider failure")
except BaseException as exc:
    w.fail(exc)
    raise SystemExit(1)
'''
    process = subprocess.Popen([sys.executable, "-c", script], cwd=ROOT, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = str(uuid4())
        send(process, request, 1, "execute", {})
        pending = read(process)
        external_id = pending["payload"]["externalRequestId"]
        send(process, request, 2, "external.accepted", {"externalRequestId": external_id})
        receipt = read(process)
        assert receipt["type"] == "external.update" and receipt["payload"]["state"] == "unknown"
        sequence = 3
        if cancel_while_committing:
            send(process, request, sequence, "cancel", {})
            sequence += 1
        assert not select.select([process.stdout], [], [], 0.05)[0]
        assert process.poll() is None
        send(process, request, sequence, "external.recorded", {"externalRequestId": external_id})
        error = read(process)
        assert error["type"] == "error"
        assert error["payload"]["code"] == "REMOTE_TIMEOUT"
        assert error["payload"]["message"] == "synthetic provider failure"
        assert process.wait(timeout=5) == 1
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate()


def test_cancel_during_request_reservation_waits_for_ack_and_never_starts_supplier():
    script = '''from backend.workers.protocol import OperationWire
w = OperationWire()
try:
    w.receive()
    w.external_state("pending")
    w.send("supplier.called", {})
except BaseException as exc:
    w.fail(exc)
    raise SystemExit(1)
'''
    process = subprocess.Popen([sys.executable, "-c", script], cwd=ROOT, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        request = str(uuid4())
        send(process, request, 1, "execute", {})
        pending = read(process)
        external_id = pending["payload"]["externalRequestId"]
        send(process, request, 2, "cancel", {})
        assert not select.select([process.stdout], [], [], 0.05)[0]
        send(process, request, 3, "external.accepted", {"externalRequestId": external_id})
        receipt = read(process)
        assert receipt["type"] == "external.update"
        send(process, request, 4, "external.recorded", {"externalRequestId": external_id})
        error = read(process)
        assert error["type"] == "error" and error["payload"]["code"] == "CANCELLED"
        assert "receiptError" not in error["payload"]
        assert process.wait(timeout=5) == 1
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate()

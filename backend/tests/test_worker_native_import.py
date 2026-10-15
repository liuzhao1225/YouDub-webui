"""Native DLL imports must not deadlock against the worker's stdin reader."""
import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path


def test_numpy_import_while_host_keeps_protocol_pipe_open():
    script = '''
from backend.workers.protocol import OperationWire
import time
wire = OperationWire()
wire.receive()
time.sleep(0.1)  # Let the reader wait for the next Host message.
import numpy as np
wire.send("result", {"sum": int(np.arange(4).sum())})
'''
    process = subprocess.Popen([sys.executable, '-B', '-c', script],
        cwd=Path(__file__).resolve().parents[2], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, encoding='utf-8',
        env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
    output = queue.Queue()
    reader = threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True)
    reader.start()
    try:
        process.stdin.write(json.dumps({'version': 'youdub-worker/v1', 'invocationId': 'native-import',
            'seq': 1, 'type': 'execute', 'payload': {}}) + '\n')
        process.stdin.flush()
        # communicate() would close stdin and hide the Windows CRT/DLL deadlock.
        result = json.loads(output.get(timeout=15))
        assert result['type'] == 'result'
        assert result['payload'] == {'sum': 6}
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        reader.join(timeout=5)
        process.stdout.close()
        process.stderr.close()
    assert process.returncode == 0

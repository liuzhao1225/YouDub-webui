from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.v1 import forced_alignment, media
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.segments import Segment
from backend.app.v1.steps import StageContext


@pytest.mark.parametrize("device", ["cpu", "cuda:1"])
def test_qwen_child_uses_selected_device_and_existing_cancellation_path(tmp_path, monkeypatch, device):
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "both", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test", "device": "remote"},
        "tts": {"adapter": "test", "model": "voice", "device": "cpu", "voice": {"mode": "preset", "id": "voice"}},
        "separation": None,
        "subtitle_alignment": {"adapter": "qwen_forced_aligner", "model": forced_alignment.MODEL_NAME, "device": device},
    })
    adjusted = tmp_path / "adjusted"
    adjusted.mkdir()
    (adjusted / "0001.wav").write_bytes(b"complete adjusted speech fixture")
    check_cancel = lambda: None
    context = StageContext(task_id="test", attempt=1, stage="export", config=config, input_files={},
                           work_dir=tmp_path, check_cancel=check_cancel)
    monkeypatch.setattr(forced_alignment, "available_models", lambda: [forced_alignment.MODEL_NAME])
    monkeypatch.setattr(forced_alignment, "model_directory", lambda: tmp_path / "model")
    calls = []

    def run(command, *, check_cancel):
        calls.append(command)
        assert check_cancel is context.check_cancel
        assert command[command.index("--device") + 1] == device
        output = Path(command[command.index("--output-path") + 1])
        output.write_text(json.dumps({"clips": [{"segment_id": "segment-1", "words": [
            {"text": "你好", "start_time": 0.1, "end_time": 0.4},
        ]}]}))
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(media, "_run_media", run)
    segment = Segment(id="segment-1", start_ms=1000, end_ms=1800, text="Hello")
    assert forced_alignment.align(context, [(segment, "你好")], lambda text: [text], lambda *_: None) == [(1100, 1400, "你好")]
    assert len(calls) == 1

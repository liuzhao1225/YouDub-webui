from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from backend.app.v1 import asr, asr_process, media
from backend.app.v1.contracts import AsrSelection
from backend.tests.test_v1_asr import child_arguments, context, raw_result


@pytest.mark.parametrize("hint", [None, "YouDub.", "词" * 500])
def test_asr_hint_is_optional_and_kept_in_model_snapshot(hint):
    value = AsrSelection(adapter="whisper", model="tiny", device="cpu", initial_prompt=hint)
    assert AsrSelection.model_validate_json(value.model_dump_json()).initial_prompt == hint


@pytest.mark.parametrize("hint", ["词" * 501, 5, ["YouDub"]])
def test_asr_hint_rejects_oversized_or_nontext_values(hint):
    with pytest.raises(ValidationError):
        AsrSelection(adapter="whisper", model="tiny", device="cpu", initial_prompt=hint)


def test_task_hint_reaches_child_without_rewriting_recognized_text(context, raw_result, monkeypatch):
    context.config.asr.initial_prompt = "YouDub."
    commands = []

    def invoke(command, **kwargs):
        commands.append(command)
        Path(command[command.index("--output-path") + 1]).write_text(json.dumps(raw_result))
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", invoke)
    result = asr.run(context, lambda *args: None)
    assert commands[0][commands[0].index("--initial-prompt") + 1] == "YouDub."
    assert json.loads(result.output_files["asr_raw"].read_text()) == raw_result


def test_child_passes_hint_to_whisper_inference(context, raw_result, monkeypatch):
    options = {}

    def transcribe(path, **kwargs):
        options.update(kwargs)
        return raw_result

    monkeypatch.setitem(sys.modules, "whisper", SimpleNamespace(load_model=lambda *a, **kw: SimpleNamespace(transcribe=transcribe)))
    assert asr_process.main(child_arguments(context) + ["--initial-prompt", "YouDub."]) == 0
    assert options["initial_prompt"] == "YouDub."

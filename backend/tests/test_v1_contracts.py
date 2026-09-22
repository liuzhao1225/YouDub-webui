from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.v1.contracts import (
    Capability,
    ConnectionPatch,
    ExternalOperation,
    Outputs,
    RerunRequest,
    RetryRequest,
    Runtime,
    Settings,
    SettingsPatch,
    Task,
    TaskConfig,
    TaskList,
)


SPEC = json.loads(
    (Path(__file__).resolve().parents[2] / "docs/design/youdub-api-v0.1.openapi.json")
    .read_text(encoding="utf-8")
)
MODEL_BY_NAME = {
    model.__name__: model
    for model in (Task, TaskList, Runtime, Settings, SettingsPatch, RetryRequest, RerunRequest)
}


def contract_examples():
    """Exercise the public design examples against the application's models."""
    for path, methods in SPEC["paths"].items():
        for method, operation in methods.items():
            if method not in {"get", "post", "patch", "delete"}:
                continue
            bodies = [("request", operation.get("requestBody", {}))]
            bodies.extend(operation.get("responses", {}).items())
            for response, body in bodies:
                content = body.get("content", {}).get("application/json", {})
                name = content.get("schema", {}).get("$ref", "").rsplit("/", 1)[-1]
                if name not in MODEL_BY_NAME:
                    continue
                for example_name, example in content.get("examples", {}).items():
                    yield pytest.param(
                        MODEL_BY_NAME[name], example["value"],
                        id=f"{method} {path} {response} {example_name}",
                    )


@pytest.mark.parametrize("model,payload", list(contract_examples()))
def test_documented_examples_match_handwritten_contract(model, payload):
    parsed = model.model_validate(payload)
    assert parsed.model_dump(mode="json", exclude_unset=True) == payload


@pytest.fixture
def config():
    return deepcopy(
        SPEC["paths"]["/api/v1/settings"]["patch"]["requestBody"]["content"]
        ["application/json"]["examples"]["defaults"]["value"]["defaults"]
    )


@pytest.fixture
def queued_task():
    return deepcopy(
        SPEC["paths"]["/api/v1/tasks"]["post"]["responses"]["201"]["content"]
        ["application/json"]["examples"]["queued"]["value"]
    )


@pytest.mark.parametrize(
    "change",
    [
        {"source_language": "zh"},
        {"target_language": "auto"},
        {"keep_background": True},
        {"output_mode": "dubbing"},
        {"output_mode": "both"},
        {"keep_background": "false"},
        {"api_key": "must-not-be-a-task-field"},
        {"translation": {"adapter": "demo", "model": "llm", "device": "mps"}},
    ],
)
def test_reject_invalid_task_configuration(config, change):
    with pytest.raises(ValidationError):
        TaskConfig.model_validate(config | change)


def test_clone_and_background_require_separation(config):
    config.update(
        output_mode="dubbing",
        tts={"adapter": "tts", "model": "tts-model", "device": "cpu", "voice": {"mode": "source_clone"}},
    )
    with pytest.raises(ValidationError, match="require separation"):
        TaskConfig.model_validate(config)
    config["separation"] = {"adapter": "sep", "model": "sep-model", "device": "cpu"}
    assert TaskConfig.model_validate(config).tts.voice.mode == "source_clone"
    config["tts"]["voice"] = {"mode": "preset", "id": "voice-1"}
    with pytest.raises(ValidationError, match="not used"):
        TaskConfig.model_validate(config)
    config["keep_background"] = True
    assert TaskConfig.model_validate(config).keep_background
    config["tts"]["voice"] = {"mode": "source_clone", "id": "/arbitrary/file.wav"}
    with pytest.raises(ValidationError):
        TaskConfig.model_validate(config)


def test_optional_subtitle_alignment_preserves_existing_configs(config):
    assert TaskConfig.model_validate(config).subtitle_alignment is None
    assert TaskConfig.model_validate(config | {"subtitle_alignment": None}).subtitle_alignment is None


@pytest.mark.parametrize("mode", ["subtitles", "dubbing", "both"])
def test_subtitle_alignment_requires_complete_dubbed_audio_and_subtitle_output(config, mode):
    config.update(output_mode=mode, subtitle_alignment={
        "adapter": "qwen_forced_aligner", "model": "Qwen3-ForcedAligner-0.6B-hf", "device": "cpu",
    })
    if mode != "subtitles":
        config["tts"] = {"adapter": "test", "model": "voice", "device": "cpu", "voice": {"mode": "preset", "id": "voice"}}
    if mode == "both":
        assert TaskConfig.model_validate(config).subtitle_alignment.adapter == "qwen_forced_aligner"
    else:
        with pytest.raises(ValidationError, match="subtitle_alignment requires both"):
            TaskConfig.model_validate(config)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"ui_language": "zh", "defaults": None},
        {"ui_language": "zh", "connection": {"adapter": "demo", "api_key": None}},
        {"ui_language": None},
        {"defaults": None},
        {"connection": None},
        {"connection": {"adapter": "demo"}},
        {"connection": {"adapter": "demo", "base_url": None}},
        {"connection": {"adapter": "demo", "api_key": ""}},
    ],
)
def test_settings_patch_requires_one_non_null_group(payload):
    with pytest.raises(ValidationError):
        SettingsPatch.model_validate(payload)


def test_api_key_preserve_replace_clear_are_distinct():
    preserve = ConnectionPatch(adapter="demo", base_url="http://localhost:8080/v1")
    replace = ConnectionPatch(adapter="demo", api_key="a-real-secret")
    clear = ConnectionPatch(adapter="demo", api_key=None)
    assert "api_key" not in preserve.model_fields_set
    assert replace.api_key.get_secret_value() == "a-real-secret"
    assert "a-real-secret" not in repr(replace)
    assert "a-real-secret" not in replace.model_dump_json()
    assert clear.model_dump(exclude_unset=True) == {"adapter": "demo", "api_key": None}


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@example.org/v1",
        "https://example.org/v1?key=secret",
        "https://example.org/v1#secret",
        "https://example.org/v1?",
        "https://example.org:99999/v1",
        "https://example.org/white space",
        "file:///tmp/key.txt",
        "https:///missing-host",
    ],
)
def test_connection_urls_cannot_carry_secrets_or_non_http_paths(url):
    with pytest.raises(ValidationError):
        ConnectionPatch(adapter="demo", base_url=url)


@pytest.mark.parametrize("url", ["http://127.0.0.1:8000/v1", "http://[::1]:8000/v1", "https://example.org/v1/"])
def test_http_connection_urls_remain_unmodified(url):
    assert ConnectionPatch(adapter="demo", base_url=url).base_url == url


def test_runtime_rejects_inconsistent_execution_and_availability():
    value = {
        "adapter": "asr", "capability": "asr", "execution": "local",
        "available": True, "unavailable_reason": None, "requires_api_key": False,
        "models": [], "data_sent": [], "remote_operations": None,
    }
    Capability.model_validate(value)
    for change in (
        {"data_sent": ["audio"]},
        {"execution": "remote"},
        {"available": False},
    ):
        with pytest.raises(ValidationError):
            Capability.model_validate(value | change)
    assert not Capability.model_validate(value | {"available": False, "unavailable_reason": "Not installed"}).available


@pytest.mark.parametrize("state", ["none", "pending", "succeeded", "failed", "cancelled", "unknown"])
def test_external_operation_exposes_unresolved_remote_risk(state):
    unresolved = state in {"pending", "unknown"}
    ExternalOperation(state=state, may_still_run=unresolved)
    with pytest.raises(ValidationError):
        ExternalOperation(state=state, may_still_run=not unresolved)


@pytest.mark.parametrize(
    "change",
    [
        {"status": "failed"},
        {"current_stage": "done"},
        {"status": "succeeded", "current_stage": "done"},
        {"finished_at": "2026-09-22T10:00:00.000Z"},
        {"created_at": "2026-09-22T10:00:00Z"},
        {"created_at": "2026-02-30T10:00:00.000Z"},
        {"stage_progress": 1.1},
        {"allowed_actions": ["cancel", "cancel"]},
        {"attempt": True},
    ],
)
def test_task_state_and_timestamp_constraints(queued_task, change):
    with pytest.raises(ValidationError):
        Task.model_validate(queued_task | change)


def test_empty_outputs_serialize_as_object_without_null_fields(queued_task):
    assert Outputs().model_dump() == {}
    assert Task.model_validate(queued_task).model_dump(mode="json")["outputs"] == {}
    with pytest.raises(ValidationError):
        Outputs(video=None)


@pytest.mark.parametrize(
    "mode,required",
    [
        ("subtitles", {"video", "source_subtitles", "translated_subtitles"}),
        ("dubbing", {"video", "audio"}),
        ("both", {"video", "audio", "source_subtitles", "translated_subtitles"}),
    ],
)
def test_success_requires_mode_specific_outputs(queued_task, config, mode, required):
    queued_task.update(status="succeeded", current_stage="done", finished_at="2026-09-22T10:01:00.000Z")
    queued_task["config"] = config
    queued_task["config"]["output_mode"] = mode
    if mode != "subtitles":
        queued_task["config"]["tts"] = {
            "adapter": "demo", "model": "demo", "device": "remote", "voice": {"mode": "preset", "id": "demo"},
        }
    all_outputs = {
        name: {
            "url": f"/api/v1/tasks/{queued_task['id']}/outputs/{name}?attempt=1",
            "file_name": f"{name}.{'mp4' if name == 'video' else 'wav' if name == 'audio' else 'srt'}",
            "mime_type": "video/mp4" if name == "video" else "audio/wav" if name == "audio" else "application/x-subrip",
            "size_bytes": 100, "duration_ms": None if "subtitles" in name else 1000,
            "timeline": "source" if name == "source_subtitles" or mode == "subtitles" else "dubbed",
        }
        for name in required
    }
    queued_task["outputs"] = all_outputs
    assert set(Task.model_validate(queued_task).model_dump()["outputs"]) == required
    for missing in required:
        with pytest.raises(ValidationError, match="missing outputs"):
            Task.model_validate(queued_task | {"outputs": {k: v for k, v in all_outputs.items() if k != missing}})


@pytest.mark.parametrize("attempt", [0, -1, True, "1"])
def test_retry_requires_a_positive_integer_attempt(attempt):
    with pytest.raises(ValidationError):
        RetryRequest(expected_attempt=attempt)


def test_rerun_defaults_to_no_external_risk_acknowledgement(config):
    request = RerunRequest(id="4ddc069a-a889-4b78-9cc4-1f558875c370", config=config)
    assert request.acknowledge_external_risk is False
    with pytest.raises(ValidationError):
        RerunRequest(id="4DDC069A-A889-4B78-9CC4-1F558875C370", config=config)

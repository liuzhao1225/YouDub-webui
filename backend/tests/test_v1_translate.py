from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import replace
from types import SimpleNamespace

import pytest

from backend.app.v1 import translate
from backend.app.v1.errors import ApiError
from backend.app.v1.segments import Transcript, read_translation
from backend.app.v1.steps import StageCancelled, StageContext
from backend.tests.test_v1_tasks import config


@pytest.fixture
def context(tmp_path, config):
    transcript = tmp_path / "transcript.json"
    transcript.write_text(json.dumps({"detected_language": "en", "segments": [
        {"id": f"segment-{index:06d}", "start_ms": index * 100, "end_ms": index * 100 + 90,
         "text": f" Original {index}. "} for index in range(1, 24)
    ]}))
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1, stage="translate",
                        config=config, input_files={"transcript": transcript}, work_dir=tmp_path,
                        connections={"openai": {"base_url": "https://pinned.example/v1", "api_key": "pinned-key"}})


@pytest.fixture
def provider(monkeypatch):
    class ConnectionError(Exception):
        pass

    class TimeoutError(ConnectionError):
        pass

    class StatusError(Exception):
        def __init__(self, status_code):
            self.status_code = status_code

    class ResponseValidationError(Exception):
        pass

    state = SimpleNamespace(calls=[], options=[], closed=False, error=None, mutate=None, wait=False, stopped=False)

    class Client:
        def __init__(self, **kwargs):
            state.options.append(kwargs)
            self.chat = SimpleNamespace(completions=SimpleNamespace(with_raw_response=SimpleNamespace(create=self.create)))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            state.closed = True

        async def create(self, **kwargs):
            state.calls.append(kwargs)
            if state.wait:
                try:
                    await asyncio.sleep(30)
                finally:
                    state.stopped = True
            if state.error:
                raise state.error
            segments = json.loads(kwargs["messages"][1]["content"])["segments"]
            # Provider order may differ; identity must still align exactly.
            result = {"segments": [{"segment_id": segment["segment_id"], "text": "译文 " + segment["text"]}
                                   for segment in reversed(segments)]}
            if state.mutate:
                state.mutate(result)
            response = SimpleNamespace(choices=[SimpleNamespace(
                finish_reason="stop", message=SimpleNamespace(content=json.dumps(result, ensure_ascii=False)))])
            return SimpleNamespace(parse=lambda: response)

    state.TimeoutError, state.StatusError = TimeoutError, StatusError
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(
        AsyncOpenAI=Client, APIConnectionError=ConnectionError, APITimeoutError=TimeoutError, APIStatusError=StatusError,
        APIResponseValidationError=ResponseValidationError))
    return state


def test_translation_preserves_source_and_matches_ids_in_serial_batches(context, provider):
    before = context.input_files["transcript"].read_bytes()
    states = []
    result = translate.run(replace(context, set_external_state=states.append), lambda *args: None)
    assert context.input_files["transcript"].read_bytes() == before
    original = Transcript.model_validate_json(before)
    translated = read_translation(result.output_files["translation"], original, stage="translate")
    assert len(translated.match(original)) == 23
    assert [len(json.loads(call["messages"][1]["content"])["segments"]) for call in provider.calls] == [20, 3]
    assert states == ["pending", "succeeded", "pending", "succeeded"]
    assert provider.options == [{"base_url": "https://pinned.example/v1", "api_key": "pinned-key", "max_retries": 0, "timeout": 60.0}]
    assert provider.closed


@pytest.mark.parametrize("mutate", [
    lambda result: result["segments"].pop(),
    lambda result: result["segments"].append(result["segments"][0]),
    lambda result: result["segments"][0].update(segment_id="foreign"),
    lambda result: result["segments"][0].update(text="  "),
    lambda result: result.update(explanation="unrequested"),
])
def test_invalid_response_does_not_produce_file_or_retry(context, provider, mutate):
    provider.mutate = mutate
    states = []
    with pytest.raises(ApiError) as error:
        translate.run(replace(context, set_external_state=states.append), lambda *args: None)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    assert not (context.work_dir / "translation.json").exists()
    assert states == ["pending", "succeeded"]
    assert len(provider.calls) == 1


@pytest.mark.parametrize("language", ["de", "zh"])
def test_auto_detected_language_rechecked_before_sending(context, provider, language):
    value = json.loads(context.input_files["transcript"].read_bytes())
    value["detected_language"] = language
    context.input_files["transcript"].write_text(json.dumps(value))
    with pytest.raises(ApiError):
        translate.run(context, lambda *args: None)
    assert not provider.calls


def test_cancel_closes_pending_request_and_preserves_unknown_risk(context, provider):
    provider.wait = True
    states = []

    def cancel_after_submit():
        if provider.calls:
            raise StageCancelled()

    with pytest.raises(StageCancelled):
        translate.run(replace(context, check_cancel=cancel_after_submit, set_external_state=states.append), lambda *args: None)
    assert states == ["pending"]
    assert provider.stopped and provider.closed
    assert not (context.work_dir / "translation.json").exists()


@pytest.mark.parametrize("status,states", [(401, ["pending", "failed"]), (429, ["pending", "failed"]),
                                          (408, ["pending"]), (500, ["pending"])])
def test_rejection_and_uncertain_server_errors_are_distinguished(context, provider, status, states):
    provider.error = provider.StatusError(status)
    actual = []
    with pytest.raises(ApiError) as error:
        translate.run(replace(context, set_external_state=actual.append), lambda *args: None)
    assert error.value.content["error"]["code"] == "PROVIDER_REJECTED"
    assert actual == states
    assert len(provider.calls) == 1 and provider.closed


def test_timeout_is_not_retried(context, provider):
    provider.error = provider.TimeoutError()
    states = []
    with pytest.raises(ApiError) as error:
        translate.run(replace(context, set_external_state=states.append), lambda *args: None)
    assert error.value.content["error"]["code"] == "REMOTE_TIMEOUT"
    assert states == ["pending"] and len(provider.calls) == 1


def test_oversized_later_segment_rejected_before_any_request(context, provider):
    value = json.loads(context.input_files["transcript"].read_bytes())
    value["segments"][-1]["text"] = "x" * 6001
    context.input_files["transcript"].write_text(json.dumps(value))
    with pytest.raises(ApiError):
        translate.run(context, lambda *args: None)
    assert not provider.calls


@pytest.fixture
def real_provider(monkeypatch):
    """Use the installed SDK through an in-memory transport, never a provider."""
    import socket

    import httpx
    import openai

    original_client = openai.AsyncOpenAI
    state = SimpleNamespace(calls=[], clients=[], body=None, content_type="application/json",
                            wait=False, stopped=False)

    def forbid_network(*args, **kwargs):
        pytest.fail("Real SDK response tests must not resolve or contact any host")

    monkeypatch.setattr(socket, "getaddrinfo", forbid_network)

    async def handle(request):
        body = json.loads(request.content)
        state.calls.append(body)
        if state.wait:
            try:
                await asyncio.sleep(30)
            finally:
                state.stopped = True
        if state.body is not None:
            return httpx.Response(200, content=state.body, headers={"content-type": state.content_type})
        source = json.loads(body["messages"][1]["content"])["segments"]
        result = {"segments": [{"segment_id": item["segment_id"], "text": "译文"} for item in reversed(source)]}
        return httpx.Response(200, json={
            "id": "completion-test", "object": "chat.completion", "created": 1, "model": body["model"],
            "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": json.dumps(result, ensure_ascii=False),
            }}],
        })

    def client(**kwargs):
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        state.clients.append(http_client)
        return original_client(**kwargs, http_client=http_client)

    monkeypatch.setattr(openai, "AsyncOpenAI", client)
    return state


def test_installed_sdk_parses_complete_responses_and_retains_all_batch_ids(context, real_provider):
    states = []
    result = translate.run(replace(context, set_external_state=states.append), lambda *args: None)
    original = Transcript.model_validate_json(context.input_files["transcript"].read_bytes())
    translated = read_translation(result.output_files["translation"], original, stage="translate")
    assert len(translated.match(original)) == 23
    assert states == ["pending", "succeeded", "pending", "succeeded"]
    assert len(real_provider.calls) == 2
    assert all(client.is_closed for client in real_provider.clients)


@pytest.mark.parametrize("body,content_type", [
    (b"not JSON", "application/json"),
    (b"<html>not a completion</html>", "text/html"),
    (b'{"choices":null}', "application/json"),
    (b"{}", "application/json"),
    (b'{"choices":[{"finish_reason":"stop"}]}', "application/json"),
    (b'{"choices":[{"finish_reason":"stop","message":null}]}', "application/json"),
    (b'{"choices":[{"finish_reason":"stop","message":{"content":[]}}]}', "application/json"),
    (b'{"choices":[{"message":{"content":"{}"}}]}', "application/json"),
])
def test_installed_sdk_malformed_complete_response_clears_external_risk(context, real_provider, body, content_type):
    real_provider.body, real_provider.content_type = body, content_type
    states = []
    with pytest.raises(ApiError) as error:
        translate.run(replace(context, set_external_state=states.append), lambda *args: None)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    assert error.value.content["error"]["action"] == "retry"
    assert states == ["pending", "succeeded"]
    assert len(real_provider.calls) == 1
    assert not (context.work_dir / "translation.json").exists()
    assert all(client.is_closed for client in real_provider.clients)


def test_installed_sdk_pending_cancellation_stops_request_without_completed_receipt(context, real_provider):
    real_provider.wait = True
    states = []

    def cancel():
        if real_provider.calls:
            raise StageCancelled()

    with pytest.raises(StageCancelled):
        translate.run(replace(context, check_cancel=cancel, set_external_state=states.append), lambda *args: None)
    assert states == ["pending"]
    assert real_provider.stopped and len(real_provider.calls) == 1
    assert all(client.is_closed for client in real_provider.clients)


@pytest.mark.parametrize("cause", [StageCancelled(), RuntimeError("receipt persistence failed")])
def test_receipt_state_errors_are_not_misclassified_as_provider_parsing(context, real_provider, cause):
    real_provider.body = b"invalid JSON after complete receipt"
    states = []

    def received(state):
        states.append(state)
        if state == "succeeded":
            raise cause

    with pytest.raises(type(cause)) as error:
        translate.run(replace(context, set_external_state=received), lambda *args: None)
    assert error.value is cause
    assert states == ["pending", "succeeded"]
    assert len(real_provider.calls) == 1
    assert all(client.is_closed for client in real_provider.clients)

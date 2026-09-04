from __future__ import annotations

import sys
import types
from types import SimpleNamespace

import pytest

from backend.app import config, database
from backend.app.adapters import litellm_translate, openai_translate
from backend.app.adapters.litellm_translate import LiteLLMClient
from backend.app.sources import detect_source

YT_SOURCE = detect_source("https://www.youtube.com/watch?v=abcdefghijk")


def _install_litellm_stub(monkeypatch, content: str = '{"dst": "hola", "audio_mode": "tts"}'):
    """Register a fake ``litellm`` module and return the recorded call kwargs."""
    calls: list[dict] = []

    def completion(**kwargs):
        calls.append(kwargs)
        message = SimpleNamespace(content=content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    fake = types.ModuleType("litellm")
    fake.completion = completion
    monkeypatch.setitem(sys.modules, "litellm", fake)
    return calls


def test_client_dispatches_to_litellm_with_drop_params(monkeypatch):
    calls = _install_litellm_stub(monkeypatch)
    client = LiteLLMClient(base_url="https://api.openai.com/v1", api_key="sk-test")

    client.chat.completions.create(
        model="anthropic/claude-3-5-sonnet",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.2,
    )

    assert len(calls) == 1
    sent = calls[0]
    assert sent["model"] == "anthropic/claude-3-5-sonnet"
    assert sent["drop_params"] is True
    assert sent["temperature"] == 0.2
    assert sent["api_key"] == "sk-test"


def test_client_omits_api_base_for_default_openai_endpoint(monkeypatch):
    calls = _install_litellm_stub(monkeypatch)
    client = LiteLLMClient(base_url="https://api.openai.com/v1", api_key="sk-test")

    client.chat.completions.create(model="gpt-4o-mini", messages=[])

    # No api_base -> LiteLLM routes natively by model prefix.
    assert "api_base" not in calls[0]


def test_client_passes_custom_base_url_as_api_base(monkeypatch):
    calls = _install_litellm_stub(monkeypatch)
    client = LiteLLMClient(base_url="http://localhost:4000/v1/", api_key="sk-test")

    client.chat.completions.create(model="gpt-4o-mini", messages=[])

    assert calls[0]["api_base"] == "http://localhost:4000/v1"


def test_client_omits_credentials_when_blank(monkeypatch):
    calls = _install_litellm_stub(monkeypatch)
    client = LiteLLMClient(base_url="", api_key="")

    client.chat.completions.create(model="bedrock/anthropic.claude-3", messages=[])

    # Blank creds are omitted so LiteLLM falls back to provider env vars.
    assert "api_key" not in calls[0]
    assert "api_base" not in calls[0]


def test_caller_can_override_drop_params(monkeypatch):
    calls = _install_litellm_stub(monkeypatch)
    client = LiteLLMClient()

    client.chat.completions.create(model="gpt-4o-mini", messages=[], drop_params=False)

    assert calls[0]["drop_params"] is False


def test_use_litellm_client_does_not_require_api_key():
    client = openai_translate._client("", "", use_litellm=True)
    assert isinstance(client, LiteLLMClient)


def test_openai_client_still_requires_api_key():
    with pytest.raises(ValueError, match="API key"):
        openai_translate._client("https://api.openai.com/v1", "", use_litellm=False)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("1", True),
        ("true", True),
        ("YES", True),
        ("on", True),
        ("", False),
        ("0", False),
        ("false", False),
        (None, False),
    ],
)
def test_use_litellm_from_settings(value, expected):
    settings = {} if value is None else {"use_litellm": value}
    assert openai_translate._use_litellm_from(settings) is expected


def test_translate_batch_routes_through_litellm_end_to_end(monkeypatch):
    calls = _install_litellm_stub(monkeypatch, content='{"dst": "hola mundo", "audio_mode": "tts"}')

    out = openai_translate.translate_batch(
        ["Hello world."],
        YT_SOURCE,
        {},
        openai_translate.PreprocessResponse(),
        base_url="https://api.openai.com/v1",
        api_key="",
        model="gemini/gemini-2.5-flash",
        concurrency=1,
        use_litellm=True,
    )

    assert [item.dst for item in out] == ["hola mundo"]
    assert calls[0]["model"] == "gemini/gemini-2.5-flash"
    assert calls[0]["drop_params"] is True


def test_default_openai_base_helper():
    assert litellm_translate._is_default_openai_base("https://api.openai.com/v1/") is True
    assert litellm_translate._is_default_openai_base("https://api.openai.com") is True
    assert litellm_translate._is_default_openai_base("http://localhost:4000/v1") is False


def test_get_litellm_enabled_seeded_from_env(monkeypatch, tmp_path):
    # Like base_url/model, the flag is seeded into the settings table from the
    # environment the first time the DB is initialised.
    monkeypatch.setenv("OPENAI_USE_LITELLM", "1")
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "on.sqlite")
    database.init_db()
    assert database.get_litellm_enabled() is True

    monkeypatch.setenv("OPENAI_USE_LITELLM", "")
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "off.sqlite")
    database.init_db()
    assert database.get_litellm_enabled() is False


def test_get_litellm_enabled_falls_back_to_env_when_row_absent(monkeypatch, tmp_path):
    # Simulates a DB created before this feature existed (no seeded row).
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "legacy.sqlite")
    database.init_db()
    with database.connect() as conn:
        conn.execute("DELETE FROM settings WHERE key = ?", ("openai.use_litellm",))

    monkeypatch.setenv("OPENAI_USE_LITELLM", "1")
    assert database.get_litellm_enabled() is True
    monkeypatch.setenv("OPENAI_USE_LITELLM", "")
    assert database.get_litellm_enabled() is False


def test_set_litellm_enabled_overrides_seed(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_USE_LITELLM", raising=False)
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.sqlite")
    database.init_db()

    database.set_litellm_enabled(True)
    assert database.get_litellm_enabled() is True

    database.set_litellm_enabled(False)
    assert database.get_litellm_enabled() is False


def test_openai_defaults_exposes_use_litellm(monkeypatch):
    monkeypatch.setenv("OPENAI_USE_LITELLM", "1")
    assert config.openai_defaults()["use_litellm"] == "1"

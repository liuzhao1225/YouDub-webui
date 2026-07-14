import pytest

from backend.app.adapters import openai_translate
from backend.app.adapters.openai_client import (
    normalize_openai_base_url,
    validate_openai_base_url,
)


def test_normalize_openai_base_url_strips_chat_completions_suffix():
    assert (
        normalize_openai_base_url("https://api.example.com/v1/chat/completions")
        == "https://api.example.com/v1"
    )


def test_normalize_openai_base_url_keeps_standard_v1_root():
    assert normalize_openai_base_url("https://api.openai.com/v1/") == "https://api.openai.com/v1"


@pytest.mark.parametrize(
    "value, expected",
    [
        ("https://api.example.com/v1/", "https://api.example.com/v1"),
        ("http://localhost:11434/v1/chat/completions", "http://localhost:11434/v1"),
    ],
)
def test_validate_openai_base_url_accepts_absolute_http_urls(value: str, expected: str):
    assert validate_openai_base_url(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "ftp://api.example.com/v1",
        "api.example.com/v1",
        "https:///v1",
        "https://user:password@api.example.com/v1",
        "https://api.example.com/v1?key=value",
        "https://api.example.com:99999/v1",
    ],
)
def test_validate_openai_base_url_rejects_unsafe_or_invalid_urls(value: str):
    with pytest.raises(ValueError):
        validate_openai_base_url(value)


def test_openai_client_initializes_with_socks_proxy_environment(monkeypatch):
    for key in (
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    ):
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("ALL_PROXY", "socks5://127.0.0.1:9")
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1,::1")

    client = openai_translate._client("http://localhost:11434/v1", "sk-test")
    try:
        assert client.base_url == "http://localhost:11434/v1/"
    finally:
        client.close()

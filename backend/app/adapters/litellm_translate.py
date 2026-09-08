"""LiteLLM transport for the translation adapter.

``openai_translate`` talks to the model through a single, tiny surface:
``client.chat.completions.create(model=..., messages=..., temperature=...)``
returning an OpenAI-shaped response. ``LiteLLMClient`` provides exactly that
surface but dispatches through ``litellm.completion``, so YouDub can reach any
of LiteLLM's 100+ providers.

Why this is more than the existing base-URL setting: the OpenAI client can only
reach OpenAI-wire-compatible endpoints. LiteLLM additionally routes to providers
whose authentication is *not* OpenAI-compatible (AWS Bedrock SigV4, Google
Vertex AI ADC, Azure AD) by model prefix, using each provider's native
credentials from the environment. ``litellm`` (listed in ``requirements.txt``)
is imported lazily, so it is only loaded when the LiteLLM transport is used.
"""

from __future__ import annotations

from typing import Any

# Base URLs that mean "just the default OpenAI endpoint". When YouDub has not
# been pointed at a custom proxy we omit ``api_base`` entirely so LiteLLM routes
# by the model prefix (e.g. ``anthropic/...``, ``bedrock/...``, ``gemini/...``)
# with the provider's own credentials instead of forcing an OpenAI base URL.
_OPENAI_DEFAULT_BASES = {
    "https://api.openai.com",
    "https://api.openai.com/v1",
}


def _is_default_openai_base(base_url: str) -> bool:
    return base_url.strip().rstrip("/") in _OPENAI_DEFAULT_BASES


class _Completions:
    def __init__(self, client: "LiteLLMClient") -> None:
        self._client = client

    def create(self, *, model: str, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        import litellm  # optional dependency, imported lazily

        params: dict[str, Any] = {
            "model": model,
            "messages": messages,
            # Silently drop params a given provider does not accept (Anthropic
            # rejects seed/frequency_penalty, Gemini rejects OpenAI-schema
            # response_format, ...) so the same YouDub call works everywhere.
            "drop_params": True,
        }
        api_key = self._client.api_key.strip()
        if api_key:
            params["api_key"] = api_key
        base_url = self._client.base_url.strip()
        if base_url and not _is_default_openai_base(base_url):
            params["api_base"] = base_url.rstrip("/")
        # Caller kwargs (temperature, and an explicit drop_params override) win.
        params.update(kwargs)
        return litellm.completion(**params)


class _Chat:
    def __init__(self, client: "LiteLLMClient") -> None:
        self.completions = _Completions(client)


class LiteLLMClient:
    """Drop-in stand-in for the OpenAI client used by ``openai_translate``.

    Only the ``chat.completions.create`` surface the adapter relies on is
    implemented. Credentials and base URL are optional: when blank, LiteLLM
    falls back to each provider's native environment variables.
    """

    def __init__(self, base_url: str = "", api_key: str = "") -> None:
        self.base_url = base_url or ""
        self.api_key = api_key or ""
        self.chat = _Chat(self)

from __future__ import annotations

from urllib.parse import urlparse


def normalize_openai_base_url(base_url: str) -> str:
    url = base_url.strip().rstrip("/")
    lowered = url.lower()
    for suffix in ("/chat/completions", "/completions"):
        if lowered.endswith(suffix):
            url = url[: -len(suffix)].rstrip("/")
            lowered = url.lower()
    return url or "https://api.openai.com/v1"


def validate_openai_base_url(base_url: str) -> str:
    url = normalize_openai_base_url(base_url)
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("OpenAI base URL must be an absolute HTTP(S) URL with a host.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("OpenAI base URL must not contain credentials, a query, or a fragment.")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("OpenAI base URL contains an invalid port.") from exc
    return url

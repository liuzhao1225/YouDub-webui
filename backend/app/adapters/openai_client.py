from __future__ import annotations


def normalize_openai_base_url(base_url: str) -> str:
    url = base_url.strip().rstrip("/")
    lowered = url.lower()
    for suffix in ("/chat/completions", "/completions"):
        if lowered.endswith(suffix):
            url = url[: -len(suffix)].rstrip("/")
            lowered = url.lower()
    return url or "https://api.openai.com/v1"

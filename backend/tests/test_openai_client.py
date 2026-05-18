from backend.app.adapters.openai_client import normalize_openai_base_url


def test_normalize_openai_base_url_strips_chat_completions_suffix():
    assert (
        normalize_openai_base_url("https://api.example.com/v1/chat/completions")
        == "https://api.example.com/v1"
    )


def test_normalize_openai_base_url_keeps_standard_v1_root():
    assert normalize_openai_base_url("https://api.openai.com/v1/") == "https://api.openai.com/v1"

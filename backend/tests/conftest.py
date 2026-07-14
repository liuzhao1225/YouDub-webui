from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


TEST_AUTH_PASSWORD = "test-password"
TEST_AUTH_PASSWORD_HASH = (
    "$argon2id$v=19$m=1024,t=1,p=1$x3Z+PslNacLcgSNcP/hiaQ$"
    "+UFVx56WqU642Pt66PhI2cZSmlTqivEHz8kTTxQZZtA"
)
CHANGED_AUTH_PASSWORD_HASH = (
    "$argon2id$v=19$m=1024,t=1,p=1$HuGdtJyFHChY9Nzl9e0peQ$"
    "OfZtJpvpaQVEFyzd1eIlAlUJE3nlesyJSiplRIQcHtE"
)


@pytest.fixture(autouse=True)
def default_test_device(monkeypatch):
    monkeypatch.setenv("DEVICE", "cpu")
    monkeypatch.setenv("YOUDUB_AUTH_PASSWORD_HASH", TEST_AUTH_PASSWORD_HASH)
    monkeypatch.setenv("YOUDUB_AUTH_SESSION_TTL_SECONDS", "3600")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SAMESITE", "lax")

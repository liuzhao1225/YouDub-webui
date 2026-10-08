from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Tests supply their own environment and must not load a developer's .env
# during application imports at collection time. Normal application startup
# remains unchanged; dotenv-specific tests can restore this with monkeypatch.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"

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
def default_test_device(monkeypatch, tmp_path):
    monkeypatch.setenv("YOUDUB_DESKTOP_DATA_DIR", str(tmp_path / "desktop-runtime"))
    monkeypatch.setenv("DEVICE", "cpu")
    monkeypatch.setenv("YOUDUB_AUTH_PASSWORD_HASH", TEST_AUTH_PASSWORD_HASH)
    monkeypatch.setenv("YOUDUB_AUTH_SESSION_TTL_SECONDS", "3600")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("YOUDUB_AUTH_COOKIE_SAMESITE", "lax")
    monkeypatch.delenv("YOUDUB_AUTH_COOKIE_NAME", raising=False)


@pytest.fixture
def config():
    from backend.app.v1.contracts import TaskConfig
    return TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "subtitles",
        "keep_background": False,
        "asr": {"adapter": "whisper", "model": "test-whisper", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-openai", "device": "remote"},
        "tts": None, "separation": None,
    })


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    import subprocess
    from backend.app.config import ffmpeg_binary
    path = tmp_path_factory.mktemp("model-test-media") / "sample.mp4"
    subprocess.run([ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True, timeout=30)
    return path

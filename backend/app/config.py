from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "")
    if not value:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def use_torchcodec() -> bool:
    return _env_flag("USE_TORCHCODEC", default=False)


def disable_torchcodec() -> None:
    os.environ.setdefault("YOUDUB_DISABLE_TORCHCODEC", "1")
    if use_torchcodec():
        return
    try:
        from .utils.video import patch_torchaudio_no_torchcodec

        patch_torchaudio_no_torchcodec()
    except Exception:
        pass
    try:
        from transformers import utils as transformers_utils
        from transformers.utils import import_utils

        import_utils.is_torchcodec_available.cache_clear()
        import_utils.is_torchcodec_available = lambda: False
        transformers_utils.is_torchcodec_available = lambda: False
    except Exception:
        pass


disable_torchcodec()

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
COOKIE_DIR = DATA_DIR / "cookies"
DB_PATH = DATA_DIR / "youdub.sqlite"
YOUTUBE_COOKIE_PATH = COOKIE_DIR / "youtube.txt"
WORKFOLDER = Path(os.getenv("WORKFOLDER", str(REPO_ROOT / "workfolder"))).expanduser()
LOG_DIR = DATA_DIR / "logs"
MODEL_CACHE_DIR = Path(os.getenv("MODEL_CACHE_DIR", str(DATA_DIR / "modelscope"))).expanduser()


def ensure_runtime_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    COOKIE_DIR.mkdir(parents=True, exist_ok=True)
    WORKFOLDER.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def device() -> str:
    configured = os.getenv("DEVICE") or os.getenv("CUDA_DEVICE")
    if configured:
        return configured
    return "cuda"


def openai_defaults() -> dict[str, str]:
    return {
        "base_url": os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or "https://api.openai.com/v1",
        "api_key": os.getenv("OPENAI_API_KEY", ""),
        "model": os.getenv("OPENAI_MODEL") or os.getenv("OPENAI_MODEL_NAME") or "gpt-4o-mini",
        "translate_concurrency": os.getenv("OPENAI_TRANSLATE_CONCURRENCY", "50"),
    }


def ytdlp_defaults() -> dict[str, str]:
    return {
        "proxy_port": os.getenv("YTDLP_PROXY_PORT", ""),
    }

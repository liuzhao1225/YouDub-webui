from __future__ import annotations

import os
import threading
from pathlib import Path

from dotenv import load_dotenv

from . import runtime_security

REPO_ROOT = Path(__file__).resolve().parents[2]
runtime_security.apply_private_umask()


def _load_runtime_environment(repo_root: Path) -> None:
    runtime_security.prepare_repository_root(repo_root)
    runtime_security.secure_secret_aliases(repo_root / ".env", repo_root / "env.txt")
    load_dotenv(repo_root / ".env")


_load_runtime_environment(REPO_ROOT)

DATA_DIR = REPO_ROOT / "data"
COOKIE_DIR = DATA_DIR / "cookies"
DB_PATH = DATA_DIR / "youdub.sqlite"
YOUTUBE_COOKIE_PATH = COOKIE_DIR / "youtube.txt"
WORKFOLDER = Path(os.getenv("WORKFOLDER", str(REPO_ROOT / "workfolder"))).expanduser()
LOG_DIR = DATA_DIR / "logs"
MODEL_CACHE_DIR = Path(os.getenv("MODEL_CACHE_DIR", str(DATA_DIR / "modelscope"))).expanduser()

_RUNTIME_SECURITY_LOCK = threading.Lock()
_RUNTIME_SECURITY_SIGNATURE: tuple[str, ...] | None = None


def ensure_runtime_dirs() -> None:
    global _RUNTIME_SECURITY_SIGNATURE
    signature = tuple(
        os.path.abspath(os.fspath(path))
        for path in (
            DATA_DIR,
            COOKIE_DIR,
            WORKFOLDER,
            LOG_DIR,
            MODEL_CACHE_DIR,
            DB_PATH,
            REPO_ROOT / ".env",
            REPO_ROOT / "env.txt",
        )
    )
    with _RUNTIME_SECURITY_LOCK:
        if _RUNTIME_SECURITY_SIGNATURE == signature:
            return

        runtime_security.validate_model_cache_location(
            MODEL_CACHE_DIR,
            private_roots=(DATA_DIR, WORKFOLDER),
            protected_paths=(
                COOKIE_DIR,
                LOG_DIR,
                DB_PATH,
                REPO_ROOT / ".env",
                REPO_ROOT / "env.txt",
            ),
        )
        for directory in (DATA_DIR, COOKIE_DIR, WORKFOLDER, LOG_DIR):
            runtime_security.ensure_private_directory(directory)
        runtime_security.ensure_model_cache_directory(MODEL_CACHE_DIR)
        runtime_security.migrate_private_runtime(
            private_roots=(DATA_DIR, WORKFOLDER),
            exclude_roots=(MODEL_CACHE_DIR,),
            ephemeral_files=runtime_security.sqlite_sidecar_paths(DB_PATH),
        )
        runtime_security.secure_secret_aliases(
            REPO_ROOT / ".env", REPO_ROOT / "env.txt"
        )
        runtime_security.secure_sqlite_files(DB_PATH)
        _RUNTIME_SECURITY_SIGNATURE = signature


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


def ffmpeg_binary() -> str:
    return os.getenv("FFMPEG_PATH", "").strip() or "ffmpeg"


def ffprobe_binary() -> str:
    return os.getenv("FFPROBE_PATH", "").strip() or "ffprobe"


def ytdlp_defaults() -> dict[str, str]:
    return {
        "proxy_port": os.getenv("YTDLP_PROXY_PORT", ""),
    }

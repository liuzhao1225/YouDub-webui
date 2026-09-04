from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from dotenv import load_dotenv

from . import runtime_security

REPO_ROOT = Path(__file__).resolve().parents[2]
runtime_security.apply_private_umask()

_FFMPEG_DLL_DIRECTORY_HANDLE: object | None = None


def configure_windows_ffmpeg_dll_directory() -> None:
    global _FFMPEG_DLL_DIRECTORY_HANDLE
    if sys.platform != "win32" or _FFMPEG_DLL_DIRECTORY_HANDLE is not None:
        return

    configured = os.getenv("FFMPEG_PATH", "").strip()
    if not configured:
        return

    ffmpeg_path = Path(configured).expanduser().resolve()
    if not ffmpeg_path.is_file():
        raise RuntimeError(
            f"FFMPEG_PATH does not point to an existing ffmpeg.exe: {ffmpeg_path}"
        )

    dll_dir = ffmpeg_path.parent
    if not any(dll_dir.glob("av*.dll")):
        raise RuntimeError(
            "FFMPEG_PATH must point to a Windows shared/full-shared FFmpeg build; "
            f"no av*.dll files were found in {dll_dir}"
        )

    try:
        _FFMPEG_DLL_DIRECTORY_HANDLE = os.add_dll_directory(str(dll_dir))
    except OSError as exc:
        raise RuntimeError(
            f"Failed to register the FFmpeg DLL directory: {dll_dir}"
        ) from exc


def _load_runtime_environment(repo_root: Path) -> None:
    runtime_security.prepare_repository_root(repo_root)
    runtime_security.secure_secret_aliases(repo_root / ".env", repo_root / "env.txt")
    load_dotenv(repo_root / ".env")
    configure_windows_ffmpeg_dll_directory()


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


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


# Values init_db() seeded before Atlas Cloud support existed. A settings row that
# still holds one of these was never customized by the user, so an upgrade may
# safely repoint it (see database._migrate_openai_defaults_to_atlascloud).
LEGACY_OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
LEGACY_OPENAI_DEFAULT_MODEL = "gpt-4o-mini"


def atlascloud_defaults() -> dict[str, str] | None:
    """Atlas Cloud defaults when the environment selects it, otherwise None.

    Atlas is only selected when its key is present and no OpenAI key is set, so
    an explicit OpenAI key always wins.
    """
    atlas_api_key = _first_env("ATLASCLOUD_API_KEY", "ATLAS_CLOUD_API_KEY")
    if not atlas_api_key or os.getenv("OPENAI_API_KEY", "").strip():
        return None
    return {
        "base_url": _first_env(
            "ATLASCLOUD_BASE_URL",
            "ATLAS_CLOUD_BASE_URL",
        )
        or "https://api.atlascloud.ai/v1",
        "api_key": atlas_api_key,
        "model": _first_env("ATLASCLOUD_MODEL", "ATLAS_CLOUD_MODEL")
        or "deepseek-ai/deepseek-v4-pro",
        "translate_concurrency": os.getenv("OPENAI_TRANSLATE_CONCURRENCY", "50"),
    }


def openai_defaults() -> dict[str, str]:
    atlas = atlascloud_defaults()
    if atlas is not None:
        return atlas

    return {
        "base_url": os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or LEGACY_OPENAI_DEFAULT_BASE_URL,
        "api_key": os.getenv("OPENAI_API_KEY", "").strip(),
        "model": os.getenv("OPENAI_MODEL") or os.getenv("OPENAI_MODEL_NAME") or LEGACY_OPENAI_DEFAULT_MODEL,
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

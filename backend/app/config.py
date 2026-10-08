from __future__ import annotations

import os
import sys
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


def ffmpeg_binary() -> str:
    return os.getenv("FFMPEG_PATH", "").strip() or "ffmpeg"


def ffprobe_binary() -> str:
    return os.getenv("FFPROBE_PATH", "").strip() or "ffprobe"

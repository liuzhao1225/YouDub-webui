"""Local model root and persisted UTC timestamps shared by workers."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def data_directory() -> Path:
    configured = os.getenv("YOUDUB_DESKTOP_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "YouDub"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "YouDub"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "youdub"

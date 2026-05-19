from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DB_PATH, ensure_runtime_dirs, openai_defaults, ytdlp_defaults
from .stages import STAGES


ACTIVE_STATUSES = ("queued", "running")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    ensure_runtime_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              url TEXT NOT NULL,
              title TEXT,
              status TEXT NOT NULL,
              current_stage TEXT,
              session_path TEXT,
              final_video_path TEXT,
              error_message TEXT,
              created_at TEXT NOT NULL,
              started_at TEXT,
              completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS task_stages (
              task_id TEXT NOT NULL,
              name TEXT NOT NULL,
              label TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at TEXT,
              completed_at TEXT,
              last_message TEXT,
              error_message TEXT,
              PRIMARY KEY (task_id, name),
              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        defaults = openai_defaults()
        for key, value in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                (f"openai.{key}", value, now_iso()),
            )
        for key, value in ytdlp_defaults().items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                (f"ytdlp.{key}", value, now_iso()),
            )
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        if "title" not in existing_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN title TEXT")


def backfill_titles_from_metadata() -> None:
    import json
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, session_path FROM tasks WHERE (title IS NULL OR title = '') AND session_path IS NOT NULL"
        ).fetchall()
    for row in rows:
        info_path = Path(row["session_path"]) / "metadata" / "ytdlp_info.json"
        if not info_path.exists():
            continue
        title = (json.loads(info_path.read_text(encoding="utf-8")).get("title") or "").strip()
        if not title:
            continue
        with connect() as conn:
            conn.execute("UPDATE tasks SET title = ? WHERE id = ?", (title, row["id"]))


def fail_stale_active_tasks() -> None:
    message = "Backend restarted before the task completed."
    completed_at = now_iso()
    with connect() as conn:
        active_tasks = conn.execute(
            f"SELECT id, current_stage FROM tasks WHERE status IN ({','.join('?' for _ in ACTIVE_STATUSES)})",
            ACTIVE_STATUSES,
        ).fetchall()
        for task in active_tasks:
            conn.execute(
                """
                UPDATE tasks
                SET status = 'failed', error_message = ?, completed_at = ?
                WHERE id = ?
                """,
                (message, completed_at, task["id"]),
            )
            if task["current_stage"]:
                conn.execute(
                    """
                    UPDATE task_stages
                    SET status = 'failed', error_message = ?, completed_at = ?
                    WHERE task_id = ? AND name = ? AND status IN ('pending', 'running')
                    """,
                    (message, completed_at, task["id"], task["current_stage"]),
                )


def create_task(url: str, task_id: str | None = None) -> str:
    new_id = task_id or str(uuid.uuid4())
    created_at = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, url, status, current_stage, created_at)
            VALUES (?, ?, 'queued', ?, ?)
            """,
            (new_id, url, STAGES[0].name, created_at),
        )
        conn.executemany(
            """
            INSERT INTO task_stages (task_id, name, label, status)
            VALUES (?, ?, ?, 'pending')
            """,
            [(new_id, stage.name, stage.label) for stage in STAGES],
        )
    return new_id


def find_task_by_video_id(video_id: str) -> str | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM tasks WHERE id = ? OR url LIKE ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (video_id, f"%{video_id}%"),
        ).fetchone()
    return row["id"] if row else None


def has_active_task() -> bool:
    with connect() as conn:
        row = conn.execute(
            f"SELECT 1 FROM tasks WHERE status IN ({','.join('?' for _ in ACTIVE_STATUSES)}) LIMIT 1",
            ACTIVE_STATUSES,
        ).fetchone()
    return row is not None


def latest_task_id() -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT id FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT 1").fetchone()
    return row["id"] if row else None


def list_tasks(limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, url, title, status, current_stage, final_video_path, error_message, "
            "created_at, started_at, completed_at FROM tasks "
            "ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_task(task_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return None
        stages = conn.execute(
            """
            SELECT * FROM task_stages
            WHERE task_id = ?
            ORDER BY
              CASE name
                WHEN 'download' THEN 1
                WHEN 'separate' THEN 2
                WHEN 'asr' THEN 3
                WHEN 'asr_fix' THEN 4
                WHEN 'translate' THEN 5
                WHEN 'split_audio' THEN 6
                WHEN 'tts' THEN 7
                WHEN 'merge_audio' THEN 8
                WHEN 'merge_video' THEN 9
                ELSE 99
              END
            """,
            (task_id,),
        ).fetchall()
    result = dict(task)
    result["stages"] = [dict(stage) for stage in stages]
    return result


def get_current_task() -> dict[str, Any] | None:
    task_id = latest_task_id()
    return get_task(task_id) if task_id else None


def delete_task(task_id: str) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.execute("DELETE FROM task_stages WHERE task_id = ?", (task_id,))
        return cursor.rowcount > 0


def reset_failed_for_resume(task_id: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE task_stages
            SET status = 'pending', started_at = NULL, completed_at = NULL,
                last_message = NULL, error_message = NULL
            WHERE task_id = ? AND status IN ('failed', 'running')
            """,
            (task_id,),
        )
        conn.execute(
            """
            UPDATE tasks
            SET status = 'queued', error_message = NULL, completed_at = NULL,
                started_at = NULL
            WHERE id = ?
            """,
            (task_id,),
        )


def update_task(task_id: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [task_id]
    with connect() as conn:
        conn.execute(f"UPDATE tasks SET {assignments} WHERE id = ?", values)


def update_stage(task_id: str, name: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [task_id, name]
    with connect() as conn:
        conn.execute(f"UPDATE task_stages SET {assignments} WHERE task_id = ? AND name = ?", values)


def set_setting(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now_iso()),
        )


def get_setting(key: str, default: str = "") -> str:
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def get_openai_settings() -> dict[str, str]:
    from .adapters.openai_client import normalize_openai_base_url

    defaults = openai_defaults()
    return {
        "base_url": normalize_openai_base_url(get_setting("openai.base_url", defaults["base_url"])),
        "api_key": get_setting("openai.api_key", defaults["api_key"]),
        "model": get_setting("openai.model", defaults["model"]),
        "translate_concurrency": get_setting(
            "openai.translate_concurrency", defaults["translate_concurrency"]
        ),
    }


def save_openai_settings(
    base_url: str,
    api_key: str,
    model: str,
    translate_concurrency: str = "",
    *,
    clear_api_key: bool = False,
) -> None:
    from .adapters.openai_client import normalize_openai_base_url

    set_setting("openai.base_url", normalize_openai_base_url(base_url))
    cleaned_api_key = api_key.strip()
    if clear_api_key:
        set_setting("openai.api_key", "")
    elif cleaned_api_key and set(cleaned_api_key) != {"*"}:
        set_setting("openai.api_key", cleaned_api_key)
    set_setting("openai.model", model.strip())
    if translate_concurrency.strip():
        set_setting("openai.translate_concurrency", translate_concurrency.strip())


def get_ytdlp_settings() -> dict[str, str]:
    defaults = ytdlp_defaults()
    return {
        "proxy_port": get_setting("ytdlp.proxy_port", defaults["proxy_port"]),
    }


def save_ytdlp_settings(proxy_port: str) -> None:
    set_setting("ytdlp.proxy_port", proxy_port.strip())


def log_path(task_id: str) -> Path:
    from .config import LOG_DIR

    return LOG_DIR / f"{task_id}.log"

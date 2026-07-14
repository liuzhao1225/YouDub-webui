from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, runtime_security
from .config import DB_PATH, ensure_runtime_dirs, openai_defaults, ytdlp_defaults
from .stages import STAGES


ACTIVE_STATUSES = ("queued", "running")
EXECUTION_MODES = ("auto", "manual")
DEFAULT_EXECUTION_MODE = "auto"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    if Path(DB_PATH).absolute() == Path(config.DB_PATH).absolute():
        ensure_runtime_dirs()
    runtime_security.secure_sqlite_database_file(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    try:
        runtime_security.secure_sqlite_database_file(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        conn.close()
        raise


def init_db() -> None:
    if Path(DB_PATH).absolute() == Path(config.DB_PATH).absolute():
        ensure_runtime_dirs()
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
              completed_at TEXT,
              execution_mode TEXT NOT NULL DEFAULT 'auto'
            );

            CREATE TABLE IF NOT EXISTS task_stages (
              task_id TEXT NOT NULL,
              name TEXT NOT NULL,
              label TEXT NOT NULL,
              status TEXT NOT NULL,
              progress INTEGER,
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

            CREATE TABLE IF NOT EXISTS auth_sessions (
              token_hash TEXT PRIMARY KEY,
              credential_version TEXT NOT NULL,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
            ON auth_sessions(expires_at);

            CREATE TABLE IF NOT EXISTS auth_login_attempts (
              client_hash TEXT PRIMARY KEY,
              window_started_at TEXT NOT NULL,
              attempt_count INTEGER NOT NULL
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
        task_columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        if "title" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN title TEXT")
        if "execution_mode" not in task_columns:
            conn.execute(
                "ALTER TABLE tasks ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'auto'"
            )
        stage_columns = {row["name"] for row in conn.execute("PRAGMA table_info(task_stages)").fetchall()}
        if "progress" not in stage_columns:
            conn.execute("ALTER TABLE task_stages ADD COLUMN progress INTEGER")


def create_auth_session(
    *,
    token_hash: str,
    credential_version: str,
    created_at: str,
    expires_at: str,
) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions (
              token_hash, credential_version, created_at, expires_at
            ) VALUES (?, ?, ?, ?)
            """,
            (token_hash, credential_version, created_at, expires_at),
        )


def get_auth_session(token_hash: str) -> dict[str, str] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT token_hash, credential_version, created_at, expires_at
            FROM auth_sessions
            WHERE token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
    return dict(row) if row else None


def delete_auth_session(token_hash: str) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
        return cursor.rowcount > 0


def delete_expired_auth_sessions(expires_before: str) -> int:
    with connect() as conn:
        cursor = conn.execute(
            "DELETE FROM auth_sessions WHERE expires_at <= ?",
            (expires_before,),
        )
        return cursor.rowcount


def reserve_auth_login_attempt(
    *,
    client_hash: str,
    now: str,
    stale_before: str,
    max_attempts: int,
) -> tuple[bool, str]:
    """Atomically reserve one login attempt across processes sharing SQLite."""
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "DELETE FROM auth_login_attempts WHERE window_started_at <= ?",
            (stale_before,),
        )
        row = conn.execute(
            """
            SELECT window_started_at, attempt_count
            FROM auth_login_attempts
            WHERE client_hash = ?
            """,
            (client_hash,),
        ).fetchone()
        if row and int(row["attempt_count"]) >= max_attempts:
            return False, str(row["window_started_at"])

        if row:
            conn.execute(
                """
                UPDATE auth_login_attempts
                SET attempt_count = attempt_count + 1
                WHERE client_hash = ?
                """,
                (client_hash,),
            )
            return True, str(row["window_started_at"])

        conn.execute(
            """
            INSERT INTO auth_login_attempts (
              client_hash, window_started_at, attempt_count
            ) VALUES (?, ?, 1)
            """,
            (client_hash, now),
        )
        return True, now


def delete_auth_login_attempt(client_hash: str) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "DELETE FROM auth_login_attempts WHERE client_hash = ?",
            (client_hash,),
        )
        return cursor.rowcount > 0


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


def normalize_execution_mode(value: str | None) -> str:
    mode = (value or DEFAULT_EXECUTION_MODE).strip().lower()
    if mode not in EXECUTION_MODES:
        raise ValueError(f"execution_mode must be one of: {', '.join(EXECUTION_MODES)}")
    return mode


def create_task(
    url: str,
    task_id: str | None = None,
    *,
    execution_mode: str = DEFAULT_EXECUTION_MODE,
) -> str:
    new_id = task_id or str(uuid.uuid4())
    created_at = now_iso()
    mode = normalize_execution_mode(execution_mode)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, url, status, current_stage, created_at, execution_mode)
            VALUES (?, ?, 'queued', ?, ?, ?)
            """,
            (new_id, url, STAGES[0].name, created_at, mode),
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


TASK_SUMMARY_COLUMNS = (
    "id, url, title, status, current_stage, final_video_path, error_message, "
    "created_at, started_at, completed_at, execution_mode"
)

TASK_LIST_SORTS = {
    "created_desc": "created_at DESC, rowid DESC",
    "created_asc": "created_at ASC, rowid ASC",
    "started_desc": "started_at IS NULL ASC, started_at DESC, rowid DESC",
    "started_asc": "started_at IS NULL ASC, started_at ASC, rowid ASC",
    "completed_desc": "completed_at IS NULL ASC, completed_at DESC, rowid DESC",
    "completed_asc": "completed_at IS NULL ASC, completed_at ASC, rowid ASC",
    "status_asc": (
        "CASE status "
        "WHEN 'queued' THEN 1 "
        "WHEN 'running' THEN 2 "
        "WHEN 'paused' THEN 3 "
        "WHEN 'failed' THEN 4 "
        "WHEN 'succeeded' THEN 5 "
        "ELSE 99 END ASC, created_at DESC, rowid DESC"
    ),
    "status_desc": (
        "CASE status "
        "WHEN 'queued' THEN 1 "
        "WHEN 'running' THEN 2 "
        "WHEN 'paused' THEN 3 "
        "WHEN 'failed' THEN 4 "
        "WHEN 'succeeded' THEN 5 "
        "ELSE 99 END DESC, created_at DESC, rowid DESC"
    ),
    "title_asc": "LOWER(COALESCE(NULLIF(TRIM(title), ''), url)) ASC, created_at DESC, rowid DESC",
    "title_desc": "LOWER(COALESCE(NULLIF(TRIM(title), ''), url)) DESC, created_at DESC, rowid DESC",
}


def list_tasks(limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            f"SELECT {TASK_SUMMARY_COLUMNS} FROM tasks "
            "ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_tasks_page(
    *,
    page: int = 1,
    page_size: int = 20,
    query: str = "",
    status: str = "all",
    execution_mode: str = "all",
    sort: str = "created_desc",
) -> dict[str, Any]:
    page = max(page, 1)
    page_size = max(page_size, 1)
    offset = (page - 1) * page_size
    where_parts: list[str] = []
    params: list[Any] = []

    needle = query.strip().lower()
    if needle:
        pattern = f"%{needle}%"
        where_parts.append(
            "(LOWER(COALESCE(title, '')) LIKE ? "
            "OR LOWER(url) LIKE ? "
            "OR LOWER(id) LIKE ?)"
        )
        params.extend([pattern, pattern, pattern])
    if status != "all":
        where_parts.append("status = ?")
        params.append(status)
    if execution_mode != "all":
        where_parts.append("execution_mode = ?")
        params.append(execution_mode)

    where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""
    order_sql = TASK_LIST_SORTS.get(sort, TASK_LIST_SORTS["created_desc"])

    with connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM tasks{where_sql}",
            params,
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT {TASK_SUMMARY_COLUMNS} FROM tasks{where_sql} "
            f"ORDER BY {order_sql} LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()

    return {
        "tasks": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


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


def queue_task_for_continue(task_id: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET status = 'queued', error_message = NULL, completed_at = NULL
            WHERE id = ?
            """,
            (task_id,),
        )


def reset_stages_from(task_id: str, from_stage: str) -> None:
    from .stages import STAGE_NAMES

    if from_stage not in STAGE_NAMES:
        raise ValueError(f"Unknown stage: {from_stage}")

    start = STAGE_NAMES.index(from_stage)
    with connect() as conn:
        for stage in STAGE_NAMES[start:]:
            conn.execute(
                """
                UPDATE task_stages
                SET status = 'pending', started_at = NULL, completed_at = NULL,
                    progress = NULL, last_message = NULL, error_message = NULL
                WHERE task_id = ? AND name = ?
                """,
                (task_id, stage),
            )
        conn.execute(
            """
            UPDATE tasks
            SET status = 'queued', current_stage = ?, final_video_path = NULL,
                completed_at = NULL, error_message = NULL
            WHERE id = ?
            """,
            (from_stage, task_id),
        )


def reset_failed_for_resume(task_id: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE task_stages
            SET status = 'pending', started_at = NULL, completed_at = NULL,
                progress = NULL, last_message = NULL, error_message = NULL
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
    keys = {
        "base_url": "openai.base_url",
        "api_key": "openai.api_key",
        "model": "openai.model",
        "translate_concurrency": "openai.translate_concurrency",
    }
    placeholders = ", ".join("?" for _ in keys)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT key, value FROM settings WHERE key IN ({placeholders})",
            tuple(keys.values()),
        ).fetchall()
    saved = {row["key"]: row["value"] for row in rows}
    return {
        "base_url": normalize_openai_base_url(
            saved.get(keys["base_url"], defaults["base_url"])
        ),
        "api_key": saved.get(keys["api_key"], defaults["api_key"]),
        "model": saved.get(keys["model"], defaults["model"]),
        "translate_concurrency": saved.get(
            keys["translate_concurrency"], defaults["translate_concurrency"]
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
    from .adapters.openai_client import validate_openai_base_url

    validated_base_url = validate_openai_base_url(base_url)
    defaults = openai_defaults()
    cleaned_api_key = api_key.strip()
    has_explicit_api_key = bool(cleaned_api_key) and set(cleaned_api_key) != {"*"}
    updated_at = now_iso()

    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")

        def current_value(key: str, default: str) -> str:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default

        current_base_url = validate_openai_base_url(
            current_value("openai.base_url", defaults["base_url"])
        )
        current_api_key = current_value("openai.api_key", defaults["api_key"])
        if (
            validated_base_url != current_base_url
            and current_api_key
            and not has_explicit_api_key
            and not clear_api_key
        ):
            raise ValueError("A new API key is required when changing the OpenAI base URL.")

        updates = {
            "openai.base_url": validated_base_url,
            "openai.model": model.strip(),
        }
        if clear_api_key:
            updates["openai.api_key"] = ""
        elif has_explicit_api_key:
            updates["openai.api_key"] = cleaned_api_key
        if translate_concurrency.strip():
            updates["openai.translate_concurrency"] = translate_concurrency.strip()

        conn.executemany(
            """
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE
            SET value = excluded.value, updated_at = excluded.updated_at
            """,
            [(key, value, updated_at) for key, value in updates.items()],
        )


def get_ytdlp_settings() -> dict[str, str]:
    defaults = ytdlp_defaults()
    return {
        "proxy_port": get_setting("ytdlp.proxy_port", defaults["proxy_port"]),
    }


def save_ytdlp_settings(proxy_port: str) -> None:
    set_setting("ytdlp.proxy_port", proxy_port.strip())


def log_path(task_id: str) -> Path:
    from .config import LOG_DIR

    if Path(DB_PATH).absolute() != Path(config.DB_PATH).absolute():
        return Path(DB_PATH).absolute().parent / "logs" / f"{task_id}.log"
    return LOG_DIR / f"{task_id}.log"

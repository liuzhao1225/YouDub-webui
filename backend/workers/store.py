"""SQLite persistence operations. Scheduling decisions belong to the Node host."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .protocol import WorkerError

SCHEMA_VERSION = 2
ACTIVE = ("queued", "running", "waiting", "cancelling")
TERMINAL = ("cancelled", "succeeded", "failed")


def serialized(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class SqliteStore:
    def __init__(self, root: Path, legacy_db: Path | None = None):
        from backend.app import runtime_security
        self.root = root.resolve()
        self.path = self.root / "desktop.sqlite"
        self.legacy_db = legacy_db
        runtime_security.ensure_private_directory(self.root)
        runtime_security.secure_sqlite_database_file(self.path)
        self.migrate()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def migrate(self):
        with self.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version == SCHEMA_VERSION:
                return
            if version not in {0, 1}:
                raise WorkerError("UNSUPPORTED_SCHEMA", f"Unsupported desktop database version: {version}")
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if version == 0 and tables:
                raise WorkerError("UNSUPPORTED_SCHEMA", "An unversioned database with existing tables cannot be migrated.")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("BEGIN IMMEDIATE")
            if version == 1:
                active = [dict(row) for row in conn.execute(
                    "SELECT id,status FROM tasks WHERE status IN ('queued','running','waiting','cancelling')")]
                if active:
                    raise WorkerError("MIGRATION_ACTIVE_TASKS", "Legacy active tasks must finish or be explicitly stopped before migration.", active)
                columns = list(conn.execute("PRAGMA table_info(tasks)"))
                names = [row["name"] for row in columns]
                definitions = [f'"{row["name"]}" {row["type"]}' + (" PRIMARY KEY" if row["pk"] else "") for row in columns]
                conn.execute("CREATE TABLE tasks_v2 (" + ",".join(definitions) + ",plugin_json TEXT,plugin_revision INTEGER NOT NULL DEFAULT 0)")
                quoted = ",".join('"' + name + '"' for name in names)
                conn.execute(f"INSERT INTO tasks_v2 ({quoted}) SELECT {quoted} FROM tasks")
                conn.execute("DROP TABLE tasks")
                conn.execute("ALTER TABLE tasks_v2 RENAME TO tasks")
                conn.execute("CREATE TABLE settings_v2 (key TEXT PRIMARY KEY NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),updated_at TEXT NOT NULL)")
                conn.execute("INSERT INTO settings_v2 SELECT key,value_json,updated_at FROM settings")
                conn.execute("DROP TABLE settings")
                conn.execute("ALTER TABLE settings_v2 RENAME TO settings")
            else:
                conn.execute("""CREATE TABLE tasks (
                    id TEXT PRIMARY KEY NOT NULL, attempt INTEGER, source_name TEXT, source_size_bytes INTEGER,
                    source_duration_ms INTEGER, input_path TEXT, config_json TEXT, status TEXT, current_stage TEXT,
                    stage_progress REAL, wait_reason TEXT, status_message TEXT, outputs_json TEXT, stage_context_json TEXT,
                    error_json TEXT, created_at TEXT, updated_at TEXT, queued_at TEXT, started_at TEXT, finished_at TEXT,
                    plugin_json TEXT CHECK(plugin_json IS NULL OR json_valid(plugin_json)), plugin_revision INTEGER NOT NULL DEFAULT 0)""")
                conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL,value_json TEXT NOT NULL CHECK(json_valid(value_json)),updated_at TEXT NOT NULL)")
            conn.execute("CREATE INDEX idx_tasks_queue ON tasks(status,queued_at,id)")
            conn.execute("CREATE INDEX idx_tasks_created ON tasks(created_at DESC,id DESC)")
            conn.execute("CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY,credential_version TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)")
            conn.execute("CREATE TABLE auth_login_attempts (client_hash TEXT PRIMARY KEY,window_started_at TEXT NOT NULL,attempt_count INTEGER NOT NULL)")
            if self.legacy_db is not None and self.legacy_db.is_file():
                with self.legacy_connection() as old:
                    old_tables = {row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    for table, fields in (("auth_sessions", "token_hash,credential_version,created_at,expires_at"),
                                          ("auth_login_attempts", "client_hash,window_started_at,attempt_count")):
                        if table in old_tables:
                            rows = list(old.execute(f"SELECT {fields} FROM {table}"))
                            conn.executemany(f"INSERT INTO {table} ({fields}) VALUES ({','.join('?' for _ in fields.split(','))})", rows)
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @contextmanager
    def legacy_connection(self):
        if self.legacy_db is None or not self.legacy_db.is_file():
            raise WorkerError("LEGACY_NOT_FOUND", "The legacy database does not exist.")
        conn = sqlite3.connect(self.legacy_db.resolve().as_uri() + "?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def decode(self, row):
        if row is None:
            return None
        if row["plugin_json"] is not None:
            task = json.loads(row["plugin_json"])
            if task.get("revision") != row["plugin_revision"]:
                raise WorkerError("CORRUPT_TASK", "Task revision differs from its indexed revision.")
            return task
        raw = dict(row)
        config = json.loads(raw.get("config_json") or "{}")
        context = json.loads(raw.get("stage_context_json") or "{}")
        previous_outputs = json.loads(raw.get("outputs_json") or "{}")
        artifacts, outputs, inputs = {}, [], {}
        task_root = (self.root / "tasks" / raw["id"]).resolve()
        original = raw.get("input_path")
        if isinstance(original, str) and original:
            source = Path(original).resolve()
            if source.is_relative_to(task_root) and source.is_file():
                key = f"legacy:{raw['id']}:input"
                artifacts[key] = {"id": key, "schemaId": "file/v1", "path": source.relative_to(task_root).as_posix(),
                                  "mimeType": "application/octet-stream", "name": raw["source_name"],
                                  "size": source.stat().st_size, "metadata": {}, "invocationId": "input"}
                inputs["video"] = {"id": key, "schemaId": "file/v1"}
        for name, value in previous_outputs.items():
            path = context.get("output_paths", {}).get(name)
            if path:
                source = (task_root / path).resolve()
                if not source.is_relative_to(task_root) or not source.is_file():
                    continue
                key = f"legacy:{raw['id']}:{name}"
                artifacts[key] = {"id": key, "schemaId": value["mime_type"] + "/v1", "path": source.relative_to(task_root).as_posix(),
                                  "mimeType": value["mime_type"], "name": value["file_name"],
                                  "size": value["size_bytes"], "metadata": {"timeline": value.get("timeline")},
                                  "invocationId": "legacy"}
                outputs.append({"id": name, "label": name, "role": name,
                                "artifact": {"id": key, "schemaId": artifacts[key]["schemaId"]}})
        return {"id": raw["id"], "revision": 0, "attempt": raw["attempt"], "legacy": True,
                "rawSnapshot": raw, "status": raw["status"], "sourceName": raw["source_name"],
                "workflowId": "legacy-v1", "workflowVersion": "unresolved", "config": config,
                "inputs": inputs, "plan": None, "steps": [], "artifacts": artifacts, "outputs": outputs,
                "connections": context.get("resolved_connections", []), "credentialRefs": context.get("credential_refs", {}),
                "externalRequests": {"legacy": {**context["external_operation"], "mayStillRun": True}} if context.get("external_operation", {}).get("may_still_run") else {},
                "error": json.loads(raw["error_json"]) if raw.get("error_json") else None,
                "message": raw.get("status_message"), "createdAt": raw["created_at"], "updatedAt": raw["updated_at"],
                "queuedAt": raw["queued_at"], "startedAt": raw["started_at"], "finishedAt": raw["finished_at"], "nextPollAt": None}

    def _validate(self, task):
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            raise WorkerError("INVALID_TASK", "Task must have an ID.")
        if task.get("status") not in ACTIVE + TERMINAL or type(task.get("attempt")) is not int or task["attempt"] < 1:
            raise WorkerError("INVALID_TASK", "Task status or attempt is invalid.")
        if (task["status"] in TERMINAL) != bool(task.get("finishedAt")):
            raise WorkerError("INVALID_TASK", "Task terminal status and finishedAt disagree.")
        if task["status"] == "failed" and not task.get("error"):
            raise WorkerError("INVALID_TASK", "A failed task must retain its error.")

    def _write(self, conn, task, *, insert=False):
        self._validate(task)
        fields = {"id": task["id"], "attempt": task["attempt"], "status": task["status"],
                  "source_name": task.get("sourceName"), "created_at": task.get("createdAt"),
                  "updated_at": task.get("updatedAt"), "queued_at": task.get("queuedAt"),
                  "started_at": task.get("startedAt"), "finished_at": task.get("finishedAt"),
                  "plugin_revision": task["revision"], "plugin_json": serialized(task)}
        if insert:
            conn.execute(f"INSERT INTO tasks ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", tuple(fields.values()))
        else:
            conn.execute(f"UPDATE tasks SET {','.join(key + '=?' for key in fields if key != 'id')} WHERE id=?",
                         (*[value for key, value in fields.items() if key != "id"], task["id"]))
        return task

    def create(self, task):
        task = {**task, "revision": 1}
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM tasks WHERE id=?", (task["id"],)).fetchone():
                raise WorkerError("TASK_EXISTS", "A task with this ID already exists.")
            return self._write(conn, task, insert=True)

    def get(self, id):
        with self.connect() as conn:
            task = self.decode(conn.execute("SELECT * FROM tasks WHERE id=?", (id,)).fetchone())
        if task is None:
            raise WorkerError("TASK_NOT_FOUND", "Task not found.")
        return task

    def list(self, limit=20, offset=0, status=None, active=None):
        if type(limit) is not int or not 1 <= limit <= 10000 or type(offset) is not int or offset < 0:
            raise WorkerError("INVALID_QUERY", "Invalid task pagination.")
        if status is not None and active is not None:
            raise WorkerError("INVALID_QUERY", "Use status or active, not both.")
        values = []
        where = ""
        if status is not None:
            if status not in ACTIVE + TERMINAL:
                raise WorkerError("INVALID_QUERY", "Unknown task status.")
            where, values = " WHERE status=?", [status]
        elif active is not None:
            if type(active) is not bool:
                raise WorkerError("INVALID_QUERY", "active must be boolean.")
            states = ACTIVE if active else TERMINAL
            where, values = " WHERE status IN (" + ",".join("?" for _ in states) + ")", list(states)
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM tasks" + where + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", (*values, limit + 1, offset)).fetchall()
            return {"items": [self.decode(row) for row in rows[:limit]], "limit": limit, "offset": offset, "hasMore": len(rows) > limit}

    def cas(self, id, expectedRevision, task):
        if task.get("id") != id:
            raise WorkerError("INVALID_TASK", "Task ID cannot change.")
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (id,)).fetchone()
            if row is None:
                raise WorkerError("TASK_NOT_FOUND", "Task not found.")
            if row["plugin_json"] is None:
                raise WorkerError("LEGACY_READ_ONLY", "Historical tasks require an explicit rerun.")
            if type(expectedRevision) is not int or row["plugin_revision"] != expectedRevision:
                raise WorkerError("REVISION_CONFLICT", "Task revision changed.")
            previous = self.decode(row)
            for name in ("plan", "config", "inputs", "workflowId", "workflowVersion", "credentialRefs", "connections"):
                if task.get(name) != previous.get(name):
                    raise WorkerError("IMMUTABLE_SNAPSHOT", f"Task {name} snapshot cannot change.")
            return self._write(conn, {**task, "revision": expectedRevision + 1})

    def claim(self, now, statuses=None):
        statuses = ["queued", "waiting"] if statuses is None else statuses
        if not statuses or any(status not in {"queued", "waiting"} for status in statuses):
            raise WorkerError("INVALID_CLAIM", "Claim accepts queued/waiting candidates only.")
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM tasks WHERE status IN ('running','cancelling') LIMIT 1").fetchone():
                return None
            waiting = conn.execute("SELECT * FROM tasks WHERE status='waiting' ORDER BY started_at,queued_at,id LIMIT 1").fetchone()
            if waiting is not None:
                task = self.decode(waiting)
                if task.get("legacy"):
                    raise WorkerError("LEGACY_ACTIVE_TASK", "A historical waiting task cannot be executed by the plugin runtime.")
                due = task.get("nextPollAt")
                if not isinstance(due, str):
                    raise WorkerError("INVALID_TASK", "Waiting task has no nextPollAt.")
                if "waiting" not in statuses or due > now:
                    return None
            else:
                if "queued" not in statuses:
                    return None
                row = conn.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY started_at IS NULL,started_at,queued_at,id LIMIT 1").fetchone()
                if row is None:
                    return None
                task = self.decode(row)
                if task.get("legacy"):
                    raise WorkerError("LEGACY_ACTIVE_TASK", "A historical task cannot be executed by the plugin runtime.")
            task.update(status="running", updatedAt=now, startedAt=task.get("startedAt") or now,
                        revision=task["revision"] + 1)
            return self._write(conn, task)

    def delete(self, id, expectedRevision):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT status,plugin_revision FROM tasks WHERE id=?", (id,)).fetchone()
            if row is None:
                raise WorkerError("TASK_NOT_FOUND", "Task not found.")
            if row["plugin_revision"] != expectedRevision:
                raise WorkerError("REVISION_CONFLICT", "Task revision changed.")
            if row["status"] not in TERMINAL:
                raise WorkerError("TASK_BUSY", "Active tasks cannot be deleted.")
            conn.execute("DELETE FROM tasks WHERE id=?", (id,))
        return None

    def settings_values(self):
        with self.connect() as conn:
            return {row["key"]: json.loads(row["value_json"]) for row in conn.execute("SELECT key,value_json FROM settings")}

    def write_setting(self, key, value):
        from backend.app.paths import now_iso
        with self.connect() as conn:
            conn.execute("INSERT INTO settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                         (key, serialized(value), now_iso()))

    def credential_pinned(self, reference):
        with self.connect() as conn:
            return bool(conn.execute("""SELECT 1 FROM tasks WHERE
                EXISTS(SELECT 1 FROM json_each(tasks.stage_context_json,'$.credential_refs') WHERE value=?)
                OR EXISTS(SELECT 1 FROM json_each(tasks.plugin_json,'$.credentialRefs') WHERE value=?) LIMIT 1""",
                                     (reference, reference)).fetchone())

    def auth(self, operation, parameters):
        with self.connect() as conn:
            if operation == "create_session":
                conn.execute("INSERT INTO auth_sessions VALUES(:token_hash,:credential_version,:created_at,:expires_at)", parameters)
                return None
            if operation == "get_session":
                row = conn.execute("SELECT * FROM auth_sessions WHERE token_hash=:token_hash", parameters).fetchone()
                return dict(row) if row else None
            if operation == "delete_session":
                return conn.execute("DELETE FROM auth_sessions WHERE token_hash=:token_hash", parameters).rowcount > 0
            if operation == "delete_expired_sessions":
                return conn.execute("DELETE FROM auth_sessions WHERE expires_at<=:expires_before", parameters).rowcount
            if operation == "delete_login_attempt":
                return conn.execute("DELETE FROM auth_login_attempts WHERE client_hash=:client_hash", parameters).rowcount > 0
            if operation == "reserve_login_attempt":
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM auth_login_attempts WHERE window_started_at<=:stale_before", parameters)
                row = conn.execute("SELECT * FROM auth_login_attempts WHERE client_hash=:client_hash", parameters).fetchone()
                if row and row["attempt_count"] >= parameters["max_attempts"]:
                    return {"allowed": False, "window_started_at": row["window_started_at"]}
                if row:
                    conn.execute("UPDATE auth_login_attempts SET attempt_count=attempt_count+1 WHERE client_hash=:client_hash", parameters)
                else:
                    conn.execute("INSERT INTO auth_login_attempts VALUES(:client_hash,:now,1)", parameters)
                return {"allowed": True, "window_started_at": row["window_started_at"] if row else parameters["now"]}
        raise WorkerError("UNKNOWN_METHOD", f"Unknown auth operation: {operation}")

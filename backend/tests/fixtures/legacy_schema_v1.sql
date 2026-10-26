-- YouDub 0.1.0-draft.1: target NEW database only; not a migration script.
-- Existing auth tables are managed by the authentication module.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    source_name TEXT NOT NULL,
    source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes > 0),
    source_duration_ms INTEGER CHECK (source_duration_ms > 0),
    input_path TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting','cancelling','cancelled','succeeded','failed')),
    current_stage TEXT NOT NULL CHECK (current_stage IN ('prepare','separate','asr','translate','tts','mix','export','done')),
    stage_progress REAL CHECK (stage_progress >= 0 AND stage_progress <= 1),
    wait_reason TEXT CHECK (wait_reason IN ('active_limit','cpu','gpu','remote_limit','remote_result')),
    status_message TEXT,
    outputs_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outputs_json) AND json_type(outputs_json) = 'object'),
    stage_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(stage_context_json) AND json_type(stage_context_json) = 'object'),
    error_json TEXT CHECK (error_json IS NULL OR (json_valid(error_json) AND json_type(error_json) = 'object')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    CHECK ((status = 'succeeded' AND current_stage = 'done') OR (status <> 'succeeded' AND current_stage <> 'done')),
    CHECK ((status IN ('succeeded','failed','cancelled') AND finished_at IS NOT NULL)
        OR (status NOT IN ('succeeded','failed','cancelled') AND finished_at IS NULL)),
    CHECK (status <> 'failed' OR error_json IS NOT NULL)
);

CREATE INDEX idx_tasks_queue ON tasks(status, queued_at, id);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC, id DESC);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('defaults','connections','ui_language')),
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL
);

PRAGMA user_version = 1;

from __future__ import annotations

import asyncio
import os
import sqlite3
import stat
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app import config, database, main, pipeline, runtime_security


POSIX_ONLY = pytest.mark.skipif(
    not runtime_security.POSIX_STRONG_PERMISSIONS,
    reason="POSIX permission bits are not a Windows ACL guarantee.",
)


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.lstat().st_mode)


def _make_safe_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if runtime_security.POSIX_STRONG_PERMISSIONS:
        path.chmod(0o700)
    return path


@POSIX_ONLY
def test_private_umask_is_inherited_by_external_process(tmp_path):
    root = _make_safe_directory(tmp_path / "umask")
    previous = os.umask(0)
    try:
        assert runtime_security.apply_private_umask() == "posix-strong"
        script = (
            "from pathlib import Path; "
            "root=Path(__import__('sys').argv[1]); "
            "(root/'child').mkdir(); "
            "(root/'child'/'artifact.bin').write_bytes(b'x')"
        )
        subprocess.run([sys.executable, "-c", script, str(root)], check=True)
    finally:
        os.umask(previous)

    assert _mode(root / "child") == 0o700
    assert _mode(root / "child" / "artifact.bin") == 0o600


@POSIX_ONLY
def test_metadata_only_migration_preserves_content_and_mtime_and_skips_model_cache(
    tmp_path,
):
    root = _make_safe_directory(tmp_path / "runtime")
    data = root / "data"
    workfolder = root / "workfolder"
    cookie_dir = data / "cookies"
    log_dir = data / "logs"
    model_cache = data / "modelscope"
    for directory in (data, workfolder, cookie_dir, log_dir, model_cache):
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o777 if directory != model_cache else 0o755)

    sensitive_files = [
        data / "youdub.sqlite",
        cookie_dir / "youtube.txt",
        log_dir / "task.log",
        workfolder / "artifact.json",
        root / ".env",
        root / "env.txt",
    ]
    for index, path in enumerate(sensitive_files):
        path.write_bytes(f"synthetic-{index}".encode())
        path.chmod(0o666)
        timestamp_ns = 1_700_000_000_000_000_000 + index
        os.utime(path, ns=(timestamp_ns, timestamp_ns))

    model_file = model_cache / "weights.bin"
    model_file.write_bytes(b"public-model")
    model_file.chmod(0o644)
    before = {
        path: (path.read_bytes(), path.stat().st_mtime_ns) for path in sensitive_files
    }

    runtime_security.validate_model_cache_location(
        model_cache,
        private_roots=(data, workfolder),
        protected_paths=(cookie_dir, log_dir, data / "youdub.sqlite"),
    )
    runtime_security.migrate_private_runtime(
        private_roots=(data, workfolder),
        secret_files=(root / ".env", root / "env.txt"),
        exclude_roots=(model_cache,),
    )

    for directory in (data, workfolder, cookie_dir, log_dir):
        assert _mode(directory) == 0o700
    for path, (content, mtime_ns) in before.items():
        assert _mode(path) == 0o600
        assert path.read_bytes() == content
        assert path.stat().st_mtime_ns == mtime_ns
    assert _mode(model_cache) == 0o755
    assert _mode(model_file) == 0o644


@POSIX_ONLY
def test_unsafe_parent_is_rejected(tmp_path):
    unsafe_parent = tmp_path / "shared"
    unsafe_parent.mkdir()
    unsafe_parent.chmod(0o770)

    with pytest.raises(runtime_security.RuntimeSecurityError, match="writable"):
        runtime_security.ensure_private_directory(unsafe_parent / "data")


@POSIX_ONLY
def test_repository_and_env_are_secured_before_dotenv_loader(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    repo.chmod(0o775)
    env_file = repo / ".env"
    env_txt = repo / "env.txt"
    env_file.write_bytes(b"SYNTHETIC=value\n")
    env_txt.write_bytes(b"SYNTHETIC_EDIT=value\n")
    env_file.chmod(0o664)
    env_txt.chmod(0o664)
    called = []

    def fake_loader(path):
        called.append(Path(path))
        assert _mode(repo) == 0o755
        assert _mode(env_file) == 0o600
        assert _mode(env_txt) == 0o600

    monkeypatch.setattr(config, "load_dotenv", fake_loader)
    config._load_runtime_environment(repo)

    assert called == [env_file]


@POSIX_ONLY
def test_only_the_known_env_alias_pair_is_allowed(monkeypatch, tmp_path):
    repo = _make_safe_directory(tmp_path / "repo-alias")
    env_file = repo / ".env"
    env_txt = repo / "env.txt"
    env_file.write_bytes(b"SYNTHETIC=value\n")
    os.link(env_file, env_txt)
    env_file.chmod(0o664)
    called = []
    monkeypatch.setattr(config, "load_dotenv", lambda path: called.append(Path(path)))

    config._load_runtime_environment(repo)

    assert called == [env_file]
    assert env_file.stat().st_ino == env_txt.stat().st_ino
    assert env_file.stat().st_nlink == 2
    assert _mode(env_file) == 0o600


@POSIX_ONLY
def test_env_alias_pair_rejects_a_third_hard_link(monkeypatch, tmp_path):
    repo = _make_safe_directory(tmp_path / "repo-third-link")
    env_file = repo / ".env"
    env_txt = repo / "env.txt"
    third = repo / "unexpected"
    env_file.write_bytes(b"SYNTHETIC=value\n")
    os.link(env_file, env_txt)
    os.link(env_file, third)
    called = []
    monkeypatch.setattr(config, "load_dotenv", lambda path: called.append(Path(path)))

    with pytest.raises(runtime_security.RuntimeSecurityError, match="third"):
        config._load_runtime_environment(repo)

    assert called == []


@POSIX_ONLY
def test_dotenv_symlink_is_rejected_before_loader(monkeypatch, tmp_path):
    repo = _make_safe_directory(tmp_path / "repo-link")
    outside = repo.parent / "outside.env"
    outside.write_bytes(b"SYNTHETIC=value\n")
    outside.chmod(0o640)
    (repo / ".env").symlink_to(outside)
    called = []
    monkeypatch.setattr(config, "load_dotenv", lambda path: called.append(path))
    outside_before = (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        config._load_runtime_environment(repo)

    assert called == []
    assert (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns) == outside_before


@POSIX_ONLY
def test_repository_root_rejects_untrusted_owner(monkeypatch, tmp_path):
    repo = _make_safe_directory(tmp_path / "foreign-owner")
    actual_uid = os.geteuid()
    monkeypatch.setattr(runtime_security, "_validate_parent_chain", lambda path: None)
    monkeypatch.setattr(runtime_security, "_effective_uid", lambda: actual_uid + 1)

    with pytest.raises(runtime_security.RuntimeSecurityError, match="owned"):
        runtime_security.prepare_repository_root(repo)


@POSIX_ONLY
def test_repository_root_rejects_unsafe_ancestor(tmp_path):
    unsafe_parent = tmp_path / "unsafe-repo-parent"
    unsafe_parent.mkdir()
    unsafe_parent.chmod(0o770)
    repo = unsafe_parent / "repo"
    repo.mkdir()

    with pytest.raises(runtime_security.RuntimeSecurityError, match="writable"):
        runtime_security.prepare_repository_root(repo)


@POSIX_ONLY
def test_model_cache_root_symlink_is_rejected(tmp_path):
    outside = tmp_path / "models"
    outside.mkdir()
    linked = tmp_path / "model-cache"
    linked.symlink_to(outside, target_is_directory=True)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.ensure_model_cache_directory(linked)


@POSIX_ONLY
def test_owner_model_cache_root_is_tightened_without_recursing(tmp_path):
    cache = tmp_path / "model-cache-owner"
    cache.mkdir()
    cache.chmod(0o775)
    model_file = cache / "weights.bin"
    model_file.write_bytes(b"synthetic-model")
    model_file.chmod(0o644)

    runtime_security.ensure_model_cache_directory(cache)

    assert _mode(cache) == 0o700
    assert _mode(model_file) == 0o644


@POSIX_ONLY
@pytest.mark.parametrize("root_mode, rejected", [(0o755, False), (0o775, True)])
def test_root_owned_model_cache_is_not_taken_over(
    monkeypatch, tmp_path, root_mode, rejected
):
    cache = _make_safe_directory(tmp_path / f"root-cache-{root_mode:o}")
    actual = cache.stat()
    values = list(actual)
    values[0] = (actual.st_mode & ~0o777) | root_mode
    values[4] = 0
    root_metadata = os.stat_result(values)
    chmod_calls = []
    monkeypatch.setattr(runtime_security, "_validate_parent_chain", lambda path: None)
    monkeypatch.setattr(runtime_security, "_effective_uid", lambda: 1000)
    monkeypatch.setattr(runtime_security.os, "fstat", lambda fd: root_metadata)
    monkeypatch.setattr(
        runtime_security.os,
        "fchmod",
        lambda fd, mode: chmod_calls.append((fd, mode)),
    )

    if rejected:
        with pytest.raises(runtime_security.RuntimeSecurityError, match="Root-owned"):
            runtime_security.ensure_model_cache_directory(cache)
    else:
        runtime_security.ensure_model_cache_directory(cache)

    assert chmod_calls == []


@POSIX_ONLY
def test_model_cache_root_rejects_untrusted_owner(monkeypatch, tmp_path):
    cache = _make_safe_directory(tmp_path / "model-cache-foreign-owner")
    actual_uid = os.geteuid()
    monkeypatch.setattr(runtime_security, "_validate_parent_chain", lambda path: None)
    monkeypatch.setattr(runtime_security, "_effective_uid", lambda: actual_uid + 1)

    with pytest.raises(runtime_security.RuntimeSecurityError, match="untrusted"):
        runtime_security.ensure_model_cache_directory(cache)


@POSIX_ONLY
@pytest.mark.parametrize("candidate_name", ["data", "workfolder", "repo", "cookies"])
def test_model_cache_cannot_overlap_sensitive_runtime_roots(tmp_path, candidate_name):
    repo = _make_safe_directory(tmp_path / "repo-cache-overlap")
    data = repo / "data"
    workfolder = repo / "workfolder"
    cookies = data / "cookies"
    logs = data / "logs"
    candidates = {
        "data": data,
        "workfolder": workfolder,
        "repo": repo,
        "cookies": cookies,
    }

    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.validate_model_cache_location(
            candidates[candidate_name],
            private_roots=(data, workfolder),
            protected_paths=(cookies, logs, data / "youdub.sqlite"),
        )


@POSIX_ONLY
def test_unrelated_external_model_cache_is_not_recursively_changed(tmp_path):
    repo = _make_safe_directory(tmp_path / "repo-external-cache")
    data = repo / "data"
    data.mkdir()
    data.chmod(0o777)
    external_cache = _make_safe_directory(tmp_path / "external-model-cache")
    model_file = external_cache / "weights.bin"
    model_file.write_bytes(b"synthetic-model")
    model_file.chmod(0o644)

    runtime_security.validate_model_cache_location(
        external_cache,
        private_roots=(data,),
    )
    runtime_security.migrate_private_runtime(
        private_roots=(data,),
        exclude_roots=(external_cache,),
    )

    assert _mode(data) == 0o700
    assert _mode(external_cache) == 0o700
    assert _mode(model_file) == 0o644


@POSIX_ONLY
@pytest.mark.parametrize("kind", ["symlink", "fifo", "hardlink"])
def test_private_file_validation_rejects_links_and_special_files(tmp_path, kind):
    root = _make_safe_directory(tmp_path / kind)
    outside = root / "outside.txt"
    outside.write_bytes(b"outside")
    outside.chmod(0o640)
    candidate = root / "candidate"
    if kind == "symlink":
        candidate.symlink_to(outside)
    elif kind == "fifo":
        os.mkfifo(candidate)
    else:
        os.link(outside, candidate)
    outside_before = (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.secure_existing_file(candidate, required=True)

    assert (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns) == outside_before


@POSIX_ONLY
def test_private_directory_symlink_is_rejected_without_changing_target(tmp_path):
    root = _make_safe_directory(tmp_path / "directory-link")
    outside = root / "outside"
    outside.mkdir()
    outside.chmod(0o750)
    linked = root / "data"
    linked.symlink_to(outside, target_is_directory=True)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.ensure_private_directory(linked)

    assert _mode(outside) == 0o750


@POSIX_ONLY
def test_sqlite_connect_and_live_wal_sidecars_are_private(monkeypatch, tmp_path):
    root = _make_safe_directory(tmp_path / "sqlite")
    db_path = root / "youdub.sqlite"
    monkeypatch.setattr(database, "DB_PATH", db_path)

    conn = database.connect()
    try:
        assert conn.execute("PRAGMA journal_mode=WAL").fetchone()[0].lower() == "wal"
        conn.execute("CREATE TABLE permission_probe (value TEXT)")
        conn.execute("INSERT INTO permission_probe VALUES ('synthetic')")
        conn.commit()
        second = sqlite3.connect(db_path)
        try:
            second.execute("SELECT * FROM permission_probe").fetchall()
            for path in (
                db_path,
                Path(f"{db_path}-wal"),
                Path(f"{db_path}-shm"),
            ):
                assert path.exists()
                assert _mode(path) == 0o600
        finally:
            second.close()
    finally:
        conn.close()


@POSIX_ONLY
def test_standalone_connect_secures_parent_and_database(monkeypatch, tmp_path):
    db_path = tmp_path / "standalone" / "youdub.sqlite"
    monkeypatch.setattr(database, "DB_PATH", db_path)

    with database.connect() as conn:
        conn.execute("CREATE TABLE permission_probe (value INTEGER)")

    assert _mode(db_path.parent) == 0o700
    assert _mode(db_path) == 0o600


@POSIX_ONLY
def test_concurrent_connect_does_not_race_transient_sqlite_sidecars(
    monkeypatch, tmp_path
):
    root = _make_safe_directory(tmp_path / "sqlite-concurrent")
    db_path = root / "youdub.sqlite"
    monkeypatch.setattr(database, "DB_PATH", db_path)
    with database.connect() as conn:
        conn.execute("CREATE TABLE permission_probe (worker INTEGER, sequence INTEGER)")

    def write_many(worker: int) -> list[runtime_security.RuntimeSecurityError]:
        security_errors: list[runtime_security.RuntimeSecurityError] = []
        for sequence in range(200):
            try:
                with database.connect() as conn:
                    conn.execute("PRAGMA busy_timeout=30000")
                    conn.execute(
                        "INSERT INTO permission_probe VALUES (?, ?)",
                        (worker, sequence),
                    )
            except runtime_security.RuntimeSecurityError as exc:
                security_errors.append(exc)
        return security_errors

    with ThreadPoolExecutor(max_workers=16) as executor:
        worker_errors = list(executor.map(write_many, range(16)))

    security_errors = [error for errors in worker_errors for error in errors]
    assert security_errors == []

    with database.connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM permission_probe").fetchone()[0]
    assert count == 3200
    assert _mode(root) == 0o700
    assert _mode(db_path) == 0o600


@POSIX_ONLY
def test_production_connect_rejects_sidecar_symlink_before_sqlite(
    monkeypatch, tmp_path
):
    repo = _make_safe_directory(tmp_path / "production-connect")
    data = repo / "data"
    data.mkdir()
    db_path = data / "youdub.sqlite"
    outside = repo / "outside-journal"
    outside.write_bytes(b"outside")
    Path(f"{db_path}-journal").symlink_to(outside)

    monkeypatch.setattr(config, "REPO_ROOT", repo)
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "COOKIE_DIR", data / "cookies")
    monkeypatch.setattr(config, "WORKFOLDER", repo / "workfolder")
    monkeypatch.setattr(config, "LOG_DIR", data / "logs")
    monkeypatch.setattr(config, "MODEL_CACHE_DIR", data / "modelscope")
    monkeypatch.setattr(config, "DB_PATH", db_path)
    monkeypatch.setattr(config, "_RUNTIME_SECURITY_SIGNATURE", None)
    monkeypatch.setattr(database, "DB_PATH", db_path)
    connect_calls = []
    monkeypatch.setattr(
        database.sqlite3,
        "connect",
        lambda path: connect_calls.append(path),
    )

    with pytest.raises(runtime_security.RuntimeSecurityError, match="sidecar"):
        database.connect()

    assert connect_calls == []
    assert outside.read_bytes() == b"outside"


@POSIX_ONLY
def test_sqlite_sidecar_disappearance_and_unlinked_fd_are_allowed(
    monkeypatch, tmp_path
):
    root = _make_safe_directory(tmp_path / "sqlite-ephemeral-unit")
    sidecar = root / "youdub.sqlite-journal"
    real_open = os.open

    sidecar.write_bytes(b"journal")

    def disappear_before_open(path, flags, mode=0o777):
        Path(path).unlink()
        raise FileNotFoundError(path)

    monkeypatch.setattr(runtime_security.os, "open", disappear_before_open)
    assert runtime_security.secure_sqlite_sidecar_file(sidecar) is None

    monkeypatch.setattr(runtime_security.os, "open", real_open)
    sidecar.write_bytes(b"journal")

    def unlink_after_open(path, flags, mode=0o777):
        fd = real_open(path, flags, mode)
        Path(path).unlink()
        return fd

    monkeypatch.setattr(runtime_security.os, "open", unlink_after_open)
    metadata = runtime_security.secure_sqlite_sidecar_file(sidecar)

    assert metadata is not None
    assert metadata.st_nlink == 0


@POSIX_ONLY
def test_migration_tolerates_live_sqlite_journal_churn(tmp_path):
    root = _make_safe_directory(tmp_path / "sqlite-migration-churn")
    db_path = root / "youdub.sqlite"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE permission_probe (value INTEGER)")
    sidecars = runtime_security.sqlite_sidecar_paths(db_path)

    def write_many() -> None:
        with sqlite3.connect(db_path) as conn:
            for value in range(2000):
                conn.execute("INSERT INTO permission_probe VALUES (?)", (value,))
                conn.commit()

    def migrate_many() -> None:
        for _ in range(400):
            runtime_security.migrate_private_runtime(
                private_roots=(root,),
                ephemeral_files=sidecars,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        writer = executor.submit(write_many)
        migrator = executor.submit(migrate_many)
        writer.result()
        migrator.result()

    with sqlite3.connect(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM permission_probe").fetchone()[0]
    assert count == 2000


@POSIX_ONLY
def test_existing_sqlite_and_sidecar_modes_are_repaired_without_rewriting(tmp_path):
    root = _make_safe_directory(tmp_path / "sqlite-existing")
    db_path = root / "youdub.sqlite"
    paths = (db_path, *runtime_security.sqlite_sidecar_paths(db_path))
    before: dict[Path, tuple[bytes, int]] = {}
    for index, path in enumerate(paths):
        path.write_bytes(f"sidecar-{index}".encode())
        path.chmod(0o666)
        timestamp_ns = 1_700_000_100_000_000_000 + index
        os.utime(path, ns=(timestamp_ns, timestamp_ns))
        before[path] = (path.read_bytes(), path.stat().st_mtime_ns)

    runtime_security.secure_sqlite_files(db_path)

    for path, (content, mtime_ns) in before.items():
        assert _mode(path) == 0o600
        assert path.read_bytes() == content
        assert path.stat().st_mtime_ns == mtime_ns


@POSIX_ONLY
def test_sqlite_sidecar_symlink_fails_closed(tmp_path):
    root = _make_safe_directory(tmp_path / "sqlite-link")
    db_path = root / "youdub.sqlite"
    db_path.write_bytes(b"synthetic-db")
    target = root / "outside"
    target.write_bytes(b"outside")
    target.chmod(0o640)
    wal_path = Path(f"{db_path}-wal")
    wal_path.symlink_to(target)
    target_before = (target.read_bytes(), _mode(target), target.stat().st_mtime_ns)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.secure_sqlite_files(db_path)

    assert (target.read_bytes(), _mode(target), target.stat().st_mtime_ns) == target_before


@POSIX_ONLY
def test_atomic_private_cookie_write_and_symlink_rejection(tmp_path):
    root = _make_safe_directory(tmp_path / "cookies")
    cookie = root / "youtube.txt"
    cookie.write_bytes(b"old")
    cookie.chmod(0o666)

    runtime_security.atomic_write_private_text(cookie, "new-cookie\n")

    assert cookie.read_text() == "new-cookie\n"
    assert _mode(cookie) == 0o600
    assert not list(root.glob(".youtube.txt.*.tmp"))

    outside = root / "outside"
    outside.write_bytes(b"outside")
    outside.chmod(0o640)
    cookie.unlink()
    cookie.symlink_to(outside)
    target_before = (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns)
    with pytest.raises(runtime_security.RuntimeSecurityError):
        runtime_security.atomic_write_private_text(cookie, "must-not-follow")
    assert (outside.read_bytes(), _mode(outside), outside.stat().st_mtime_ns) == target_before


@POSIX_ONLY
def test_pipeline_log_is_private_append_and_rejects_symlink(monkeypatch, tmp_path):
    log_dir = _make_safe_directory(tmp_path / "logs")
    monkeypatch.setattr(config, "LOG_DIR", log_dir)

    pipeline._write_log("task", "first")
    pipeline._write_log("task", "second")

    log_path = log_dir / "task.log"
    assert _mode(log_path) == 0o600
    assert "first" in log_path.read_text()
    assert "second" in log_path.read_text()

    outside = log_dir / "outside"
    outside.write_bytes(b"outside")
    log_path.unlink()
    log_path.symlink_to(outside)
    with pytest.raises(runtime_security.RuntimeSecurityError):
        pipeline._write_log("task", "must-not-follow")
    assert outside.read_bytes() == b"outside"


@POSIX_ONLY
def test_upload_is_private_exclusive_and_rejects_symlink(tmp_path):
    root = _make_safe_directory(tmp_path / "uploads")
    destination = root / "video.mp4"
    upload = SimpleNamespace(file=BytesIO(b"video"))

    assert main._save_uploaded_file(
        upload,
        destination,
        max_bytes=100,
        too_large_detail="too large",
    ) == 5
    assert destination.read_bytes() == b"video"
    assert _mode(destination) == 0o600

    destination.unlink()
    outside = root / "outside"
    outside.write_bytes(b"outside")
    destination.symlink_to(outside)
    upload = SimpleNamespace(file=BytesIO(b"replacement"))
    with pytest.raises(runtime_security.RuntimeSecurityError):
        main._save_uploaded_file(
            upload,
            destination,
            max_bytes=100,
            too_large_detail="too large",
        )
    assert outside.read_bytes() == b"outside"


def test_runtime_security_interface_is_explicit():
    assert runtime_security.RUNTIME_SECURITY_MODE in {
        "posix-strong",
        "windows-best-effort",
    }


def test_lifespan_permission_failure_does_not_start_worker(monkeypatch):
    started = []

    def fail_closed():
        raise runtime_security.RuntimeSecurityError("unsafe runtime")

    monkeypatch.setattr(main, "ensure_runtime_dirs", fail_closed)
    monkeypatch.setattr(main.worker, "start", lambda runner: started.append(runner))

    async def start_app():
        async with main.lifespan(main.app):
            pass

    with pytest.raises(runtime_security.RuntimeSecurityError):
        asyncio.run(start_app())
    assert started == []

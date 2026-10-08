from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from backend.app import config, runtime_security


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


def test_runtime_security_interface_is_explicit():
    assert runtime_security.RUNTIME_SECURITY_MODE in {
        "posix-strong",
        "windows-best-effort",
    }

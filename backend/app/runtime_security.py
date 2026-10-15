from __future__ import annotations

import os
import stat
from pathlib import Path


PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
PRIVATE_UMASK = 0o077
POSIX_STRONG_PERMISSIONS = os.name == "posix"
RUNTIME_SECURITY_MODE = (
    "posix-strong" if POSIX_STRONG_PERMISSIONS else "windows-best-effort"
)


class RuntimeSecurityError(RuntimeError):
    """A runtime path cannot be used without weakening local data isolation."""


def apply_private_umask() -> str:
    """Permanently restrict newly created process and subprocess files on POSIX."""
    if POSIX_STRONG_PERMISSIONS:
        os.umask(PRIVATE_UMASK)
    return RUNTIME_SECURITY_MODE


def _absolute(path: Path | str) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _is_link_like(path: Path, metadata: os.stat_result | None = None) -> bool:
    if metadata is not None and stat.S_ISLNK(metadata.st_mode):
        return True
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def _effective_uid() -> int | None:
    getter = getattr(os, "geteuid", None)
    return getter() if getter is not None else None


def _validate_owner(path: Path, metadata: os.stat_result) -> None:
    if not POSIX_STRONG_PERMISSIONS:
        return
    effective_uid = _effective_uid()
    if effective_uid is not None and metadata.st_uid != effective_uid:
        raise RuntimeSecurityError(f"Runtime path is not owned by the service user: {path}")


def _validate_parent_chain(path: Path | str) -> None:
    """Reject replaceable or redirected existing ancestors without resolving links."""
    if not POSIX_STRONG_PERMISSIONS:
        return

    current = _absolute(path).parent
    effective_uid = _effective_uid()
    while True:
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            metadata = None

        if metadata is not None:
            if _is_link_like(current, metadata) or not stat.S_ISDIR(metadata.st_mode):
                raise RuntimeSecurityError(f"Runtime parent is not a real directory: {current}")
            if effective_uid is not None and metadata.st_uid not in {0, effective_uid}:
                raise RuntimeSecurityError(
                    f"Runtime parent is owned by an untrusted user: {current}"
                )
            writable_by_others = stat.S_IMODE(metadata.st_mode) & 0o022
            sticky = bool(metadata.st_mode & stat.S_ISVTX)
            if writable_by_others and not sticky:
                raise RuntimeSecurityError(
                    f"Runtime parent is writable by group or other users: {current}"
                )

        parent = current.parent
        if parent == current:
            break
        current = parent


def _nofollow_flags(flags: int) -> int:
    return flags | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)


def _validate_directory_metadata(path: Path, metadata: os.stat_result) -> None:
    if _is_link_like(path, metadata) or not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeSecurityError(f"Runtime directory is a link or special file: {path}")
    _validate_owner(path, metadata)


def _validate_file_metadata(path: Path, metadata: os.stat_result) -> None:
    if _is_link_like(path, metadata) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeSecurityError(f"Runtime file is a link or special file: {path}")
    _validate_owner(path, metadata)
    if POSIX_STRONG_PERMISSIONS and metadata.st_nlink != 1:
        raise RuntimeSecurityError(f"Runtime file has multiple hard links: {path}")


def _secure_open_fd_without_mode_change(path: Path, *, directory: bool) -> int:
    flags = os.O_RDONLY
    if directory:
        flags |= getattr(os, "O_DIRECTORY", 0)
    try:
        fd = os.open(path, _nofollow_flags(flags))
    except OSError as exc:
        kind = "directory" if directory else "file"
        raise RuntimeSecurityError(f"Cannot safely open runtime {kind}: {path}") from exc

    try:
        metadata = os.fstat(fd)
        if directory:
            _validate_directory_metadata(path, metadata)
        else:
            _validate_file_metadata(path, metadata)
    except Exception:
        os.close(fd)
        raise
    return fd


def _secure_open_fd(path: Path, *, directory: bool) -> int:
    fd = _secure_open_fd_without_mode_change(path, directory=directory)
    try:
        metadata = os.fstat(fd)
        expected_mode = PRIVATE_DIR_MODE if directory else PRIVATE_FILE_MODE
        if POSIX_STRONG_PERMISSIONS and stat.S_IMODE(metadata.st_mode) != expected_mode:
            os.fchmod(fd, expected_mode)
    except Exception:
        os.close(fd)
        raise
    return fd


def ensure_private_directory(path: Path | str) -> Path:
    target = _absolute(path)
    _validate_parent_chain(target)
    try:
        target.mkdir(mode=PRIVATE_DIR_MODE, parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeSecurityError(f"Cannot create private runtime directory: {target}") from exc
    if POSIX_STRONG_PERMISSIONS:
        fd = _secure_open_fd(target, directory=True)
        os.close(fd)
    else:
        metadata = os.lstat(target)
        _validate_directory_metadata(target, metadata)
    return target


def prepare_repository_root(path: Path | str) -> Path:
    """Make an owner-controlled source root non-replaceable without making it private."""
    target = _absolute(path)
    _validate_parent_chain(target)
    try:
        metadata = os.lstat(target)
    except OSError as exc:
        raise RuntimeSecurityError(f"Cannot inspect repository root: {target}") from exc
    _validate_directory_metadata(target, metadata)
    if POSIX_STRONG_PERMISSIONS:
        fd = _secure_open_fd_without_mode_change(target, directory=True)
        try:
            current_mode = stat.S_IMODE(os.fstat(fd).st_mode)
            safe_mode = current_mode & ~0o022
            if safe_mode != current_mode:
                os.fchmod(fd, safe_mode)
        finally:
            os.close(fd)
    return target


def secure_existing_file(path: Path | str, *, required: bool = False) -> os.stat_result | None:
    target = _absolute(path)
    _validate_parent_chain(target)
    try:
        metadata = os.lstat(target)
    except FileNotFoundError:
        if required:
            raise RuntimeSecurityError(f"Required runtime file is missing: {target}")
        return None
    _validate_file_metadata(target, metadata)
    if not POSIX_STRONG_PERMISSIONS:
        return metadata
    fd = _secure_open_fd(target, directory=False)
    try:
        return os.fstat(fd)
    finally:
        os.close(fd)


def secure_secret_aliases(first_path: Path | str, second_path: Path | str) -> None:
    """Secure the one explicitly supported `.env`/`env.txt` hard-link pair."""
    targets = (_absolute(first_path), _absolute(second_path))
    entries: list[tuple[Path, os.stat_result]] = []
    for target in targets:
        _validate_parent_chain(target)
        try:
            metadata = os.lstat(target)
        except FileNotFoundError:
            continue
        if _is_link_like(target, metadata) or not stat.S_ISREG(metadata.st_mode):
            raise RuntimeSecurityError(f"Secret file is a link or special file: {target}")
        _validate_owner(target, metadata)
        entries.append((target, metadata))

    if not entries:
        return
    if len(entries) == 1:
        target, metadata = entries[0]
        if POSIX_STRONG_PERMISSIONS and metadata.st_nlink != 1:
            raise RuntimeSecurityError(f"Secret file has an unapproved hard link: {target}")
        secure_existing_file(target, required=True)
        return

    first_target, first_metadata = entries[0]
    second_target, second_metadata = entries[1]
    same_inode = (
        first_metadata.st_dev == second_metadata.st_dev
        and first_metadata.st_ino == second_metadata.st_ino
    )
    if not same_inode:
        for target, metadata in entries:
            if POSIX_STRONG_PERMISSIONS and metadata.st_nlink != 1:
                raise RuntimeSecurityError(
                    f"Secret file has an unapproved hard link: {target}"
                )
            secure_existing_file(target, required=True)
        return

    if POSIX_STRONG_PERMISSIONS and (
        first_metadata.st_nlink != 2 or second_metadata.st_nlink != 2
    ):
        raise RuntimeSecurityError("Secret aliases have an unapproved third hard link.")
    if not POSIX_STRONG_PERMISSIONS:
        return

    expected_identity = (first_metadata.st_dev, first_metadata.st_ino)
    for target, _ in entries:
        try:
            fd = os.open(target, _nofollow_flags(os.O_RDONLY))
        except OSError as exc:
            raise RuntimeSecurityError(f"Cannot safely open secret alias: {target}") from exc
        try:
            metadata = os.fstat(fd)
            if (
                not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != _effective_uid()
                or metadata.st_nlink != 2
                or (metadata.st_dev, metadata.st_ino) != expected_identity
            ):
                raise RuntimeSecurityError(f"Secret alias changed during validation: {target}")
            if stat.S_IMODE(metadata.st_mode) != PRIVATE_FILE_MODE:
                os.fchmod(fd, PRIVATE_FILE_MODE)
        finally:
            os.close(fd)


def secure_sqlite_database_file(database_path: Path | str) -> None:
    """Secure only the stable database path, safe for concurrent connect churn."""
    database_file = _absolute(database_path)
    ensure_private_directory(database_file.parent)
    secure_existing_file(database_file)

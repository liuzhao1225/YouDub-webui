from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path
from typing import BinaryIO, Iterable, TextIO


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


def ensure_model_cache_directory(path: Path | str) -> Path:
    """Create a cache root without recursively changing a shared existing cache."""
    target = _absolute(path)
    _validate_parent_chain(target)
    try:
        target.mkdir(mode=PRIVATE_DIR_MODE, parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeSecurityError(f"Cannot create model cache directory: {target}") from exc
    metadata = os.lstat(target)
    if _is_link_like(target, metadata) or not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeSecurityError(f"Model cache root is a link or special file: {target}")
    if POSIX_STRONG_PERMISSIONS:
        flags = _nofollow_flags(os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            fd = os.open(target, flags)
        except OSError as exc:
            raise RuntimeSecurityError(
                f"Cannot safely open model cache root: {target}"
            ) from exc
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISDIR(metadata.st_mode):
                raise RuntimeSecurityError(
                    f"Model cache root is not a real directory: {target}"
                )
            effective_uid = _effective_uid()
            if metadata.st_uid == 0:
                if stat.S_IMODE(metadata.st_mode) & 0o022:
                    raise RuntimeSecurityError(
                        f"Root-owned model cache is writable by group or other users: {target}"
                    )
            elif effective_uid is None or metadata.st_uid != effective_uid:
                raise RuntimeSecurityError(
                    f"Model cache root is owned by an untrusted user: {target}"
                )
            elif stat.S_IMODE(metadata.st_mode) != PRIVATE_DIR_MODE:
                os.fchmod(fd, PRIVATE_DIR_MODE)
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


def private_file_stat(path: Path | str) -> os.stat_result | None:
    """Return no-follow metadata after validating a private regular file."""
    return secure_existing_file(path)


def remove_private_file(path: Path | str, *, missing_ok: bool = False) -> None:
    target = _absolute(path)
    metadata = secure_existing_file(target)
    if metadata is None:
        if missing_ok:
            return
        raise FileNotFoundError(target)
    try:
        target.unlink()
    except FileNotFoundError:
        if not missing_ok:
            raise


def _is_within_or_equal(path: Path, parent: Path) -> bool:
    target = os.fspath(_absolute(path))
    container = os.fspath(_absolute(parent))
    try:
        return os.path.commonpath((target, container)) == container
    except ValueError:
        return False


def _is_excluded(path: Path, exclusions: tuple[Path, ...]) -> bool:
    for exclusion in exclusions:
        if _is_within_or_equal(path, exclusion):
            return True
    return False


def validate_model_cache_location(
    model_cache: Path | str,
    *,
    private_roots: Iterable[Path | str],
    protected_paths: Iterable[Path | str] = (),
) -> None:
    cache = _absolute(model_cache)
    for root_value in private_roots:
        root = _absolute(root_value)
        if _is_within_or_equal(root, cache):
            raise RuntimeSecurityError(
                f"Model cache cannot equal or contain a private runtime root: {cache}"
            )
    for protected_value in protected_paths:
        protected = _absolute(protected_value)
        if _is_within_or_equal(cache, protected) or _is_within_or_equal(
            protected, cache
        ):
            raise RuntimeSecurityError(
                f"Model cache overlaps protected runtime data: {cache}"
            )


def secure_private_tree(
    root: Path | str,
    *,
    exclude_roots: Iterable[Path | str] = (),
    ephemeral_files: Iterable[Path | str] = (),
) -> None:
    target = ensure_private_directory(root)
    ephemeral_paths = frozenset(_absolute(value) for value in ephemeral_files)
    exclusions: list[Path] = []
    for value in exclude_roots:
        exclusion = _absolute(value)
        if _is_within_or_equal(target, exclusion):
            raise RuntimeSecurityError(
                f"Excluded path cannot equal or contain a private runtime root: {exclusion}"
            )
        if _is_within_or_equal(exclusion, target):
            exclusions.append(exclusion)
    exclusion_tuple = tuple(exclusions)

    for current, directory_names, file_names in os.walk(target, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_directories: list[str] = []
        for name in directory_names:
            child = current_path / name
            if _is_excluded(child, exclusion_tuple):
                continue
            if POSIX_STRONG_PERMISSIONS:
                fd = _secure_open_fd(child, directory=True)
                os.close(fd)
            else:
                metadata = os.lstat(child)
                _validate_directory_metadata(child, metadata)
            kept_directories.append(name)
        directory_names[:] = kept_directories
        for name in file_names:
            child = current_path / name
            if _is_excluded(child, exclusion_tuple):
                continue
            if _absolute(child) in ephemeral_paths:
                secure_sqlite_sidecar_file(child)
            else:
                secure_existing_file(child, required=True)


def migrate_private_runtime(
    *,
    private_roots: Iterable[Path | str],
    secret_files: Iterable[Path | str] = (),
    exclude_roots: Iterable[Path | str] = (),
    ephemeral_files: Iterable[Path | str] = (),
) -> None:
    exclusions = tuple(exclude_roots)
    ephemeral_paths = tuple(ephemeral_files)
    for root in private_roots:
        secure_private_tree(
            root,
            exclude_roots=exclusions,
            ephemeral_files=ephemeral_paths,
        )
    for path in secret_files:
        secure_existing_file(path)


def sqlite_sidecar_paths(database_path: Path | str) -> tuple[Path, ...]:
    database_file = _absolute(database_path)
    return tuple(Path(f"{database_file}{suffix}") for suffix in ("-wal", "-shm", "-journal"))


def secure_sqlite_files(database_path: Path | str) -> None:
    database_file = _absolute(database_path)
    ensure_private_directory(database_file.parent)
    secure_existing_file(database_file)
    for sidecar in sqlite_sidecar_paths(database_file):
        secure_sqlite_sidecar_file(sidecar)


def _validate_sqlite_sidecar_metadata(
    path: Path,
    metadata: os.stat_result,
    *,
    allow_unlinked: bool,
) -> None:
    if _is_link_like(path, metadata) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeSecurityError(f"SQLite sidecar is a link or special file: {path}")
    _validate_owner(path, metadata)
    if not POSIX_STRONG_PERMISSIONS:
        return
    if metadata.st_nlink > 1 or (metadata.st_nlink == 0 and not allow_unlinked):
        raise RuntimeSecurityError(f"SQLite sidecar has an unsafe link count: {path}")


def secure_sqlite_sidecar_file(path: Path | str) -> os.stat_result | None:
    """Secure one exact SQLite sidecar while tolerating SQLite unlink races."""
    target = _absolute(path)
    _validate_parent_chain(target)
    for _ in range(8):
        try:
            metadata = os.lstat(target)
        except FileNotFoundError:
            return None
        _validate_sqlite_sidecar_metadata(
            target,
            metadata,
            allow_unlinked=False,
        )
        if not POSIX_STRONG_PERMISSIONS:
            return metadata

        try:
            fd = os.open(target, _nofollow_flags(os.O_RDONLY))
        except FileNotFoundError:
            try:
                replacement = os.lstat(target)
            except FileNotFoundError:
                return None
            _validate_sqlite_sidecar_metadata(
                target,
                replacement,
                allow_unlinked=False,
            )
            continue
        except OSError as exc:
            raise RuntimeSecurityError(
                f"Cannot safely open SQLite sidecar: {target}"
            ) from exc

        try:
            metadata = os.fstat(fd)
            _validate_sqlite_sidecar_metadata(
                target,
                metadata,
                allow_unlinked=True,
            )
            if metadata.st_nlink == 0:
                return metadata
            if stat.S_IMODE(metadata.st_mode) != PRIVATE_FILE_MODE:
                os.fchmod(fd, PRIVATE_FILE_MODE)
            return os.fstat(fd)
        finally:
            os.close(fd)

    raise RuntimeSecurityError(f"SQLite sidecar changed repeatedly: {target}")


def secure_sqlite_database_file(database_path: Path | str) -> None:
    """Secure only the stable database path, safe for concurrent connect churn."""
    database_file = _absolute(database_path)
    ensure_private_directory(database_file.parent)
    secure_existing_file(database_file)


def _validate_new_fd(path: Path, fd: int, *, file_mode: int = PRIVATE_FILE_MODE) -> None:
    metadata = os.fstat(fd)
    _validate_file_metadata(path, metadata)
    if POSIX_STRONG_PERMISSIONS and stat.S_IMODE(metadata.st_mode) != file_mode:
        os.fchmod(fd, file_mode)


def atomic_write_private_text(path: Path | str, content: str, *, encoding: str = "utf-8") -> None:
    target = _absolute(path)
    parent = ensure_private_directory(target.parent)
    secure_existing_file(target)

    fd = -1
    temporary_path: Path | None = None
    try:
        fd, raw_temporary_path = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=parent,
        )
        temporary_path = Path(raw_temporary_path)
        _validate_new_fd(temporary_path, fd)
        with os.fdopen(fd, "w", encoding=encoding, newline="") as handle:
            fd = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, target)
        temporary_path = None
        secure_existing_file(target, required=True)
    finally:
        if fd >= 0:
            os.close(fd)
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def open_private_append_text(
    path: Path | str,
    *,
    encoding: str = "utf-8",
) -> TextIO:
    target = _absolute(path)
    ensure_private_directory(target.parent)
    flags = _nofollow_flags(os.O_WRONLY | os.O_CREAT | os.O_APPEND)
    try:
        fd = os.open(target, flags, PRIVATE_FILE_MODE)
    except OSError as exc:
        raise RuntimeSecurityError(f"Cannot safely append to runtime file: {target}") from exc
    try:
        _validate_new_fd(target, fd)
        return os.fdopen(fd, "a", encoding=encoding)
    except Exception:
        os.close(fd)
        raise


def open_private_binary_exclusive(path: Path | str) -> BinaryIO:
    target = _absolute(path)
    ensure_private_directory(target.parent)
    flags = _nofollow_flags(os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    try:
        fd = os.open(target, flags, PRIVATE_FILE_MODE)
    except OSError as exc:
        raise RuntimeSecurityError(f"Cannot safely create runtime file: {target}") from exc
    try:
        _validate_new_fd(target, fd)
        return os.fdopen(fd, "wb")
    except Exception:
        os.close(fd)
        raise

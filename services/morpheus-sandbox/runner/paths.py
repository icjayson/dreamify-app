"""Workspace-only path resolution with symlink and traversal protection."""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from .errors import RunnerError


def workspace_root(path: str | Path) -> Path:
    root = Path(path)
    try:
        resolved = root.resolve(strict=True)
    except OSError as error:
        raise RunnerError(
            "WORKSPACE_UNAVAILABLE", "Sandbox workspace does not exist"
        ) from error
    if not resolved.is_dir():
        raise RunnerError(
            "WORKSPACE_UNAVAILABLE", "Sandbox workspace is not a directory"
        )
    return resolved


def resolve_workspace_path(
    root: Path, relative_path: str, *, must_exist: bool, allow_directory: bool = False
) -> Path:
    relative = PurePosixPath(relative_path)
    if (
        not relative_path
        or relative.is_absolute()
        or ".." in relative.parts
        or "." in relative.parts
        or "\\" in relative_path
        or "\x00" in relative_path
    ):
        raise RunnerError(
            "UNSAFE_PATH", "Path must remain inside the Sandbox workspace"
        )

    candidate = root.joinpath(*relative.parts)
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.exists() or cursor.is_symlink():
            if cursor.is_symlink():
                raise RunnerError("UNSAFE_PATH", "Symlink paths are not allowed")

    try:
        resolved = candidate.resolve(strict=must_exist)
        resolved.relative_to(root)
    except (OSError, ValueError) as error:
        raise RunnerError(
            "UNSAFE_PATH", "Path escapes the Sandbox workspace"
        ) from error

    if must_exist:
        if not allow_directory and not resolved.is_file():
            raise RunnerError("UNSAFE_PATH", "Expected a regular file")
        if allow_directory and not resolved.is_dir():
            raise RunnerError("UNSAFE_PATH", "Expected a directory")
    return resolved

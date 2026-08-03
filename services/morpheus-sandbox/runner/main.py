"""Command-only entry point used by Vercel Sandbox Workflow steps."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .constants import MAX_OUTPUT_FILE_BYTES, SCHEMA_VERSION
from .dashboard import validate_dashboard
from .errors import RunnerError
from .executor import execute_analysis
from .paths import resolve_workspace_path, workspace_root
from .profiling import build_profile
from .schemas import AnalysisRequest, ProfileRequest, read_request_json


def _write_json(path: Path, value: object) -> None:
    try:
        encoded = json.dumps(
            value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise RunnerError(
            "RESULT_NOT_JSON", "Runner output is not strict JSON"
        ) from error
    if len(encoded) > MAX_OUTPUT_FILE_BYTES:
        raise RunnerError(
            "RESULT_TOO_LARGE", "Runner output exceeds the output-file limit"
        )
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise RunnerError(
            "OUTPUT_UNWRITABLE", "Runner output could not be written", True
        ) from error


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Dreamify isolated analysis runner")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("profile", "execute", "validate-dashboard"):
        child = subparsers.add_parser(command)
        child.add_argument("--workspace", required=True)
        child.add_argument(
            "--request", required=True, help="Workspace-relative request JSON path"
        )
        child.add_argument(
            "--output", required=True, help="Workspace-relative output JSON path"
        )
    return parser


def _run(command: str, request: object, root: Path) -> dict[str, Any]:
    if command == "profile":
        return build_profile(ProfileRequest.from_mapping(request), root)
    if command == "execute":
        return execute_analysis(AnalysisRequest.from_mapping(request), root)
    mapping = request if isinstance(request, dict) else {}
    if mapping.get("schema_version") != SCHEMA_VERSION:
        raise RunnerError("SCHEMA_VERSION_UNSUPPORTED", "schema_version must be 1")
    run_id = mapping.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        raise RunnerError("INVALID_REQUEST", "run_id is required")
    dashboard = validate_dashboard(mapping.get("dashboard"))
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "ok": True,
        "dashboard": dashboard,
    }


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    root = workspace_root(arguments.workspace)
    request_path = resolve_workspace_path(root, arguments.request, must_exist=True)
    output_path = resolve_workspace_path(root, arguments.output, must_exist=False)
    try:
        request = read_request_json(request_path)
        result = _run(arguments.command, request, root)
        _write_json(output_path, result)
        return 0
    except RunnerError as error:
        _write_json(
            output_path,
            {
                "schema_version": SCHEMA_VERSION,
                "ok": False,
                "error": error.as_dict(),
            },
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

"""Capped child-process execution for validated analysis programs."""

from __future__ import annotations

import contextlib
import io
import json
import math
import multiprocessing
import os
import signal
import time
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd

from .constants import (
    DEFAULT_COMMAND_TIMEOUT_SECONDS,
    DEFAULT_CPU_SECONDS,
    DEFAULT_MEMORY_BYTES,
    MAX_ANALYSIS_RESULT_BYTES,
    MAX_CHILD_PROCESSES,
    MAX_JSON_DEPTH,
    MAX_JSON_ITEMS,
    MAX_OPEN_FILES,
    MAX_OUTPUT_FILE_BYTES,
    MAX_STDIO_BYTES,
    SCHEMA_VERSION,
)
from .errors import RunnerError
from .loaders import json_scalar, load_assets
from .schemas import AnalysisRequest
from .security import SAFE_BUILTINS, validate_analysis_code


class _OutputLimitExceeded(Exception):
    pass


class _CappedTextIO(io.StringIO):
    def __init__(self, maximum_bytes: int) -> None:
        super().__init__()
        self.maximum_bytes = maximum_bytes
        self.bytes_written = 0

    def write(self, value: str) -> int:
        encoded = value.encode("utf-8", errors="replace")
        if self.bytes_written + len(encoded) > self.maximum_bytes:
            raise _OutputLimitExceeded("stdout/stderr limit exceeded")
        self.bytes_written += len(encoded)
        return super().write(value)


def _apply_resource_limits(timeout_seconds: int) -> None:
    try:
        import resource

        cpu = max(1, min(timeout_seconds, DEFAULT_CPU_SECONDS))
        limits = (
            (resource.RLIMIT_CPU, cpu, cpu + 1),
            (resource.RLIMIT_FSIZE, MAX_OUTPUT_FILE_BYTES, MAX_OUTPUT_FILE_BYTES),
            (resource.RLIMIT_NOFILE, MAX_OPEN_FILES, MAX_OPEN_FILES),
        )
        if hasattr(resource, "RLIMIT_NPROC"):
            limits += (
                (resource.RLIMIT_NPROC, MAX_CHILD_PROCESSES, MAX_CHILD_PROCESSES),
            )
        if hasattr(resource, "RLIMIT_AS") and os.uname().sysname == "Linux":
            limits += (
                (resource.RLIMIT_AS, DEFAULT_MEMORY_BYTES, DEFAULT_MEMORY_BYTES),
            )
        for kind, soft, hard in limits:
            try:
                resource.setrlimit(kind, (soft, hard))
            except (OSError, ValueError):
                continue
    except ImportError:
        return


def _sanitize_json(
    value: object, *, depth: int = 0, counter: list[int] | None = None
) -> object:
    if counter is None:
        counter = [0]
    counter[0] += 1
    if counter[0] > MAX_JSON_ITEMS:
        raise RunnerError("RESULT_TOO_LARGE", "Analysis result has too many values")
    if depth > MAX_JSON_DEPTH:
        raise RunnerError("RESULT_TOO_DEEP", "Analysis result nesting is too deep")
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return value
    if isinstance(value, np.generic) or isinstance(value, pd.Timestamp):
        return json_scalar(value, maximum_text=4_000)
    if isinstance(value, Mapping):
        output: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > 128:
                raise RunnerError(
                    "RESULT_NOT_JSON", "Result object keys must be bounded strings"
                )
            output[key] = _sanitize_json(item, depth=depth + 1, counter=counter)
        return output
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [
            _sanitize_json(item, depth=depth + 1, counter=counter) for item in value
        ]
    raise RunnerError(
        "RESULT_NOT_JSON",
        f"Analysis result contains unsupported type {type(value).__name__}",
    )


def _worker(
    connection: Any,
    source: str,
    datasets: dict[str, pd.DataFrame],
    timeout_seconds: int,
) -> None:
    _apply_resource_limits(timeout_seconds)
    stdout = _CappedTextIO(MAX_STDIO_BYTES)
    stderr = _CappedTextIO(MAX_STDIO_BYTES)
    try:
        tree = validate_analysis_code(source).tree
        global_scope = {
            "__builtins__": SAFE_BUILTINS,
            "datasets": datasets,
            "pd": pd,
            "np": np,
        }
        local_scope: dict[str, object] = {}
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(
                compile(tree, "<dreamify-analysis>", "exec"), global_scope, local_scope
            )
        sanitized = _sanitize_json(local_scope.get("result"))
        if not isinstance(sanitized, dict):
            raise RunnerError(
                "RESULT_NOT_JSON", "Analysis result must be a JSON object"
            )
        encoded = json.dumps(
            sanitized, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if len(encoded) > MAX_ANALYSIS_RESULT_BYTES:
            raise RunnerError(
                "RESULT_TOO_LARGE", "Analysis result exceeds its serialized ceiling"
            )
        connection.send(
            {
                "ok": True,
                "result": sanitized,
                "error": None,
                "stdout": stdout.getvalue(),
                "stderr": stderr.getvalue(),
            }
        )
    except _OutputLimitExceeded:
        connection.send(
            {
                "ok": False,
                "result": None,
                "error": RunnerError(
                    "OUTPUT_LIMIT_EXCEEDED", "Analysis output limit exceeded"
                ).as_dict(),
                "stdout": stdout.getvalue(),
                "stderr": stderr.getvalue(),
            }
        )
    except RunnerError as error:
        connection.send(
            {
                "ok": False,
                "result": None,
                "error": error.as_dict(),
                "stdout": stdout.getvalue(),
                "stderr": stderr.getvalue(),
            }
        )
    except BaseException as error:
        connection.send(
            {
                "ok": False,
                "result": None,
                "error": RunnerError(
                    "CODE_ERROR", f"Analysis failed: {type(error).__name__}"
                ).as_dict(),
                "stdout": stdout.getvalue(),
                "stderr": stderr.getvalue(),
            }
        )
    finally:
        connection.close()


def execute_analysis(
    request: AnalysisRequest,
    root: Any,
    *,
    timeout_seconds: int = DEFAULT_COMMAND_TIMEOUT_SECONDS,
) -> dict[str, object]:
    validate_analysis_code(request.code)
    loaded = load_assets(root, request.assets)
    datasets = {item.asset.file_name: item.frame for item in loaded}
    try:
        context = multiprocessing.get_context("fork")
    except ValueError as error:
        raise RunnerError(
            "SANDBOX_RUNTIME_UNSUPPORTED",
            "Analysis runner requires process isolation",
            True,
        ) from error
    parent, child = context.Pipe(duplex=False)
    process = context.Process(
        target=_worker,
        args=(child, request.code, datasets, timeout_seconds),
        daemon=True,
    )
    process.start()
    child.close()
    deadline = time.monotonic() + timeout_seconds
    payload: dict[str, object] | None = None
    while time.monotonic() < deadline:
        if parent.poll(0.05):
            try:
                payload = parent.recv()
            except EOFError:
                payload = None
            break
        if not process.is_alive():
            break
    process.join(0.2)
    if process.is_alive() and payload is None:
        process.terminate()
        process.join(5)
        if process.is_alive() and hasattr(process, "kill"):
            process.kill()
            process.join(5)
        return {
            "schema_version": SCHEMA_VERSION,
            "run_id": request.run_id,
            "ok": False,
            "result": None,
            "error": RunnerError(
                "ANALYSIS_TIMEOUT", "Analysis exceeded its command timeout"
            ).as_dict(),
            "stdout": "",
            "stderr": "",
        }

    if payload is None and parent.poll(1):
        try:
            payload = parent.recv()
        except EOFError:
            payload = None
    if payload is None:
        signal_name = (
            signal.Signals(-process.exitcode).name
            if process.exitcode is not None and process.exitcode < 0
            else "UNKNOWN"
        )
        payload = {
            "ok": False,
            "result": None,
            "error": RunnerError(
                "ANALYSIS_RESOURCE_LIMIT",
                f"Analysis process ended without a result ({signal_name})",
            ).as_dict(),
            "stdout": "",
            "stderr": "",
        }
    parent.close()
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": request.run_id,
        **payload,
    }

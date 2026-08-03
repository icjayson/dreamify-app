"""Deterministic, bounded CSV/Excel/JSON ingestion."""

from __future__ import annotations

import hashlib
import json
import math
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import pandas as pd

from .constants import (
    MAX_CELL_TEXT_CHARS,
    MAX_COLUMN_NAME_CHARS,
    MAX_COLUMNS_PER_FILE,
    MAX_DATAFRAME_MEMORY_BYTES,
    MAX_EXCEL_ARCHIVE_ENTRIES,
    MAX_EXCEL_COMPRESSION_RATIO,
    MAX_EXCEL_SHEETS,
    MAX_EXCEL_UNCOMPRESSED_BYTES,
    MAX_ROWS_PER_FILE,
)
from .errors import RunnerError
from .paths import resolve_workspace_path
from .schemas import AssetRequest


@dataclass
class LoadedAsset:
    asset: AssetRequest
    frame: pd.DataFrame
    sheet_name: str | None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise RunnerError("ASSET_UNREADABLE", "Asset could not be read") from error
    return digest.hexdigest()


def verify_asset(root: Path, asset: AssetRequest) -> Path:
    path = resolve_workspace_path(root, asset.relative_path, must_exist=True)
    try:
        actual_size = path.stat().st_size
    except OSError as error:
        raise RunnerError(
            "ASSET_UNREADABLE", "Asset metadata could not be read"
        ) from error
    if actual_size != asset.size_bytes:
        raise RunnerError(
            "ASSET_SIZE_MISMATCH", "Asset size did not match its manifest"
        )
    if _sha256(path) != asset.sha256:
        raise RunnerError(
            "ASSET_HASH_MISMATCH", "Asset checksum did not match its manifest"
        )
    return path


def verify_excel_archive(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_EXCEL_ARCHIVE_ENTRIES:
                raise RunnerError(
                    "UNSAFE_ARCHIVE", "Spreadsheet contains too many archive entries"
                )
            total_compressed = 0
            total_uncompressed = 0
            for entry in entries:
                member = PurePosixPath(entry.filename)
                if member.is_absolute() or ".." in member.parts:
                    raise RunnerError(
                        "UNSAFE_ARCHIVE", "Spreadsheet contains an unsafe path"
                    )
                if entry.flag_bits & 0x1:
                    raise RunnerError(
                        "ENCRYPTED_SPREADSHEET",
                        "Encrypted spreadsheets are unsupported",
                    )
                total_compressed += max(entry.compress_size, 1)
                total_uncompressed += entry.file_size
            if total_uncompressed > MAX_EXCEL_UNCOMPRESSED_BYTES:
                raise RunnerError(
                    "UNSAFE_ARCHIVE", "Spreadsheet expands beyond the safe limit"
                )
            if (
                total_uncompressed / max(total_compressed, 1)
                > MAX_EXCEL_COMPRESSION_RATIO
            ):
                raise RunnerError(
                    "UNSAFE_ARCHIVE", "Spreadsheet compression ratio is unsafe"
                )
    except RunnerError:
        raise
    except (OSError, zipfile.BadZipFile) as error:
        raise RunnerError(
            "CORRUPT_SPREADSHEET", "Spreadsheet archive is invalid"
        ) from error


def _load_csv(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(
            path,
            encoding="utf-8-sig",
            sep=None,
            engine="python",
            on_bad_lines="error",
            nrows=MAX_ROWS_PER_FILE + 1,
        )
    except UnicodeDecodeError as error:
        raise RunnerError("INVALID_ENCODING", "CSV must be UTF-8 encoded") from error
    except (OSError, pd.errors.ParserError, ValueError) as error:
        raise RunnerError("PARSE_FAILED", "CSV could not be parsed safely") from error


def _flat_json_rows(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise RunnerError(
            "NESTED_JSON_UNSUPPORTED", "JSON input must be a flat array of objects"
        )
    if len(value) > MAX_ROWS_PER_FILE:
        raise RunnerError("ROW_LIMIT_EXCEEDED", "JSON row limit exceeded")
    rows: list[dict[str, Any]] = []
    for row in value:
        if not isinstance(row, dict):
            raise RunnerError(
                "NESTED_JSON_UNSUPPORTED", "Every JSON row must be an object"
            )
        normalized: dict[str, Any] = {}
        for key, cell in row.items():
            if not isinstance(key, str) or not key:
                raise RunnerError(
                    "INVALID_COLUMN", "JSON object keys must be non-empty strings"
                )
            if isinstance(cell, (list, dict)):
                raise RunnerError(
                    "NESTED_JSON_UNSUPPORTED", "Nested JSON values are unsupported"
                )
            normalized[key] = cell
        rows.append(normalized)
    return rows


def _load_json(path: Path) -> pd.DataFrame:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except UnicodeDecodeError as error:
        raise RunnerError("INVALID_ENCODING", "JSON must be UTF-8 encoded") from error
    except (OSError, json.JSONDecodeError) as error:
        raise RunnerError("PARSE_FAILED", "JSON could not be parsed") from error
    return pd.DataFrame(_flat_json_rows(value))


def _visible_xlsx_sheets(path: Path) -> list[str]:
    try:
        from openpyxl import load_workbook

        workbook = load_workbook(path, read_only=True, data_only=True)
        try:
            return [
                sheet.title
                for sheet in workbook.worksheets
                if sheet.sheet_state == "visible"
            ]
        finally:
            workbook.close()
    except RunnerError:
        raise
    except Exception as error:
        raise RunnerError(
            "CORRUPT_SPREADSHEET", "XLSX workbook could not be inspected"
        ) from error


def _load_excel(path: Path, asset: AssetRequest) -> tuple[pd.DataFrame, str]:
    if asset.format == "xlsx":
        verify_excel_archive(path)
    engine = "openpyxl" if asset.format == "xlsx" else "xlrd"
    try:
        workbook = pd.ExcelFile(path, engine=engine)
    except ImportError as error:
        raise RunnerError(
            "SANDBOX_DEPENDENCY_MISSING", f"The {engine} reader is unavailable", True
        ) from error
    except Exception as error:
        raise RunnerError(
            "CORRUPT_SPREADSHEET", "Spreadsheet could not be opened"
        ) from error

    sheet_names = workbook.sheet_names
    if len(sheet_names) > MAX_EXCEL_SHEETS:
        raise RunnerError(
            "SHEET_LIMIT_EXCEEDED", "Spreadsheet contains too many sheets"
        )
    visible = _visible_xlsx_sheets(path) if asset.format == "xlsx" else sheet_names
    candidates = [asset.sheet_name] if asset.sheet_name else visible
    if asset.sheet_name and asset.sheet_name not in visible:
        raise RunnerError("SHEET_NOT_FOUND", "Requested sheet is missing or hidden")

    for sheet_name in candidates:
        if sheet_name is None:
            continue
        try:
            frame = pd.read_excel(
                workbook,
                sheet_name=sheet_name,
                nrows=MAX_ROWS_PER_FILE + 1,
            )
        except Exception as error:
            raise RunnerError(
                "PARSE_FAILED", "Spreadsheet sheet could not be parsed"
            ) from error
        if not frame.dropna(how="all").empty:
            return frame, sheet_name
    raise RunnerError("EMPTY_DATASET", "Spreadsheet has no non-empty visible sheet")


def _normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.dropna(how="all").reset_index(drop=True)
    if frame.empty:
        raise RunnerError("EMPTY_DATASET", "Dataset has no data rows")
    if len(frame.index) > MAX_ROWS_PER_FILE:
        raise RunnerError("ROW_LIMIT_EXCEEDED", "Dataset row limit exceeded")
    if not 1 <= len(frame.columns) <= MAX_COLUMNS_PER_FILE:
        raise RunnerError("COLUMN_LIMIT_EXCEEDED", "Dataset column limit exceeded")

    columns: list[str] = []
    for original in frame.columns:
        name = str(original).strip()
        if not name or name.lower().startswith("unnamed:"):
            raise RunnerError(
                "INVALID_COLUMN", "Every column must have a non-empty name"
            )
        if len(name) > MAX_COLUMN_NAME_CHARS or "\x00" in name:
            raise RunnerError("INVALID_COLUMN", "Column name is too long or unsafe")
        columns.append(name)
    if len(set(columns)) != len(columns):
        raise RunnerError("DUPLICATE_COLUMN", "Duplicate column names are unsupported")
    frame.columns = columns

    memory_bytes = int(frame.memory_usage(index=True, deep=True).sum())
    if memory_bytes > MAX_DATAFRAME_MEMORY_BYTES:
        raise RunnerError(
            "DATAFRAME_TOO_LARGE", "Parsed dataset exceeds the memory ceiling"
        )

    for column in frame.select_dtypes(include=["object"]).columns:
        values = frame[column].dropna()
        if any(len(str(value)) > MAX_CELL_TEXT_CHARS for value in values.head(10_000)):
            raise RunnerError(
                "CELL_TOO_LARGE", "Dataset contains an oversized text cell"
            )
    return frame


def load_asset(root: Path, asset: AssetRequest) -> LoadedAsset:
    path = verify_asset(root, asset)
    sheet_name: str | None = None
    if asset.format == "csv":
        frame = _load_csv(path)
    elif asset.format == "json":
        frame = _load_json(path)
    else:
        frame, sheet_name = _load_excel(path, asset)
    return LoadedAsset(
        asset=asset, frame=_normalize_frame(frame), sheet_name=sheet_name
    )


def load_assets(root: Path, assets: tuple[AssetRequest, ...]) -> list[LoadedAsset]:
    loaded = [load_asset(root, asset) for asset in assets]
    total_memory = sum(
        int(item.frame.memory_usage(index=True, deep=True).sum()) for item in loaded
    )
    if total_memory > MAX_DATAFRAME_MEMORY_BYTES:
        raise RunnerError(
            "DATAFRAME_TOO_LARGE", "Combined datasets exceed the memory ceiling"
        )
    return loaded


def json_scalar(value: object, *, maximum_text: int = 256) -> object:
    if value is None or value is pd.NA:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (str, int, float, bool)):
        return value[:maximum_text] if isinstance(value, str) else value
    return str(value)[:maximum_text]

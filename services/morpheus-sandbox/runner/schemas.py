"""Strict request parsing for untrusted Workflow-to-Sandbox payloads."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .constants import (
    MAX_AGGREGATE_FILE_BYTES,
    MAX_ANALYSIS_CODE_CHARS,
    MAX_ASSETS,
    MAX_FILE_BYTES,
    MEDIA_TYPES,
    SCHEMA_VERSION,
    SUPPORTED_FORMATS,
)
from .errors import RunnerError

_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError("INVALID_REQUEST", f"{label} must be an object")
    return value


def _string(
    mapping: Mapping[str, Any], key: str, *, maximum: int, optional: bool = False
) -> str | None:
    value = mapping.get(key)
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise RunnerError(
            "INVALID_REQUEST",
            f"{key} must be a non-empty string up to {maximum} characters",
        )
    if "\x00" in value:
        raise RunnerError("INVALID_REQUEST", f"{key} contains a null byte")
    return value


def _integer(
    mapping: Mapping[str, Any], key: str, *, minimum: int, maximum: int
) -> int:
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise RunnerError("INVALID_REQUEST", f"{key} must be an integer")
    if value < minimum or value > maximum:
        raise RunnerError(
            "INVALID_REQUEST", f"{key} must be between {minimum} and {maximum}"
        )
    return value


def _reject_unknown(mapping: Mapping[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise RunnerError(
            "INVALID_REQUEST", f"{label} has unknown fields: {', '.join(unknown)}"
        )


@dataclass(frozen=True)
class AssetRequest:
    asset_id: str
    object_id: str
    file_name: str
    format: str
    media_type: str
    size_bytes: int
    sha256: str
    relative_path: str
    sheet_name: str | None = None

    @classmethod
    def from_mapping(cls, value: object) -> "AssetRequest":
        mapping = _mapping(value, "asset")
        _reject_unknown(
            mapping,
            {
                "asset_id",
                "object_id",
                "file_name",
                "format",
                "media_type",
                "size_bytes",
                "sha256",
                "relative_path",
                "sheet_name",
            },
            "asset",
        )
        asset_id = _string(mapping, "asset_id", maximum=128)
        object_id = _string(mapping, "object_id", maximum=128)
        file_name = _string(mapping, "file_name", maximum=255)
        asset_format = _string(mapping, "format", maximum=8)
        media_type = _string(mapping, "media_type", maximum=128)
        sha256 = _string(mapping, "sha256", maximum=64)
        relative_path = _string(mapping, "relative_path", maximum=512)
        sheet_name = _string(mapping, "sheet_name", maximum=128, optional=True)
        assert asset_id and object_id and file_name and asset_format and media_type
        assert sha256 and relative_path

        if Path(file_name).name != file_name or file_name in {".", ".."}:
            raise RunnerError("INVALID_REQUEST", "file_name must not contain a path")
        if asset_format not in SUPPORTED_FORMATS:
            raise RunnerError(
                "UNSUPPORTED_FORMAT", f"Unsupported format: {asset_format}"
            )
        if media_type not in MEDIA_TYPES[asset_format]:
            raise RunnerError(
                "MEDIA_TYPE_MISMATCH",
                f"Media type {media_type} does not match {asset_format}",
            )
        if not _SHA256_PATTERN.fullmatch(sha256):
            raise RunnerError("INVALID_REQUEST", "sha256 must be lowercase hexadecimal")
        relative = PurePosixPath(relative_path)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or "." in relative.parts
            or "\\" in relative_path
        ):
            raise RunnerError(
                "UNSAFE_PATH", "relative_path must stay inside the workspace"
            )
        expected_suffix = f".{asset_format}"
        if not file_name.lower().endswith(
            expected_suffix
        ) or not relative_path.lower().endswith(expected_suffix):
            raise RunnerError(
                "FORMAT_MISMATCH", "Declared format does not match the file extension"
            )

        return cls(
            asset_id=asset_id,
            object_id=object_id,
            file_name=file_name,
            format=asset_format,
            media_type=media_type,
            size_bytes=_integer(
                mapping, "size_bytes", minimum=1, maximum=MAX_FILE_BYTES
            ),
            sha256=sha256,
            relative_path=relative_path,
            sheet_name=sheet_name,
        )


@dataclass(frozen=True)
class ProfileRequest:
    run_id: str
    assets: tuple[AssetRequest, ...]

    @classmethod
    def from_mapping(cls, value: object) -> "ProfileRequest":
        mapping = _mapping(value, "request")
        _reject_unknown(mapping, {"schema_version", "run_id", "assets"}, "request")
        if mapping.get("schema_version") != SCHEMA_VERSION:
            raise RunnerError("SCHEMA_VERSION_UNSUPPORTED", "schema_version must be 1")
        run_id = _string(mapping, "run_id", maximum=128)
        raw_assets = mapping.get("assets")
        if not isinstance(raw_assets, list) or not 1 <= len(raw_assets) <= MAX_ASSETS:
            raise RunnerError(
                "INVALID_REQUEST",
                f"assets must contain between 1 and {MAX_ASSETS} items",
            )
        assets = tuple(AssetRequest.from_mapping(item) for item in raw_assets)
        if len({item.asset_id for item in assets}) != len(assets):
            raise RunnerError("DUPLICATE_ASSET", "asset_id values must be unique")
        if len({item.relative_path for item in assets}) != len(assets):
            raise RunnerError("DUPLICATE_ASSET", "relative_path values must be unique")
        if sum(item.size_bytes for item in assets) > MAX_AGGREGATE_FILE_BYTES:
            raise RunnerError("INPUT_TOO_LARGE", "Aggregate asset size exceeded")
        assert run_id
        return cls(run_id=run_id, assets=assets)


@dataclass(frozen=True)
class AnalysisRequest(ProfileRequest):
    code: str = ""

    @classmethod
    def from_mapping(cls, value: object) -> "AnalysisRequest":
        mapping = _mapping(value, "request")
        _reject_unknown(
            mapping, {"schema_version", "run_id", "assets", "code"}, "request"
        )
        base = ProfileRequest.from_mapping(
            {
                "schema_version": mapping.get("schema_version"),
                "run_id": mapping.get("run_id"),
                "assets": mapping.get("assets"),
            }
        )
        code = _string(mapping, "code", maximum=MAX_ANALYSIS_CODE_CHARS)
        assert code
        return cls(run_id=base.run_id, assets=base.assets, code=code)


def read_request_json(path: Path, maximum_bytes: int = 128 * 1024) -> object:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise RunnerError(
            "REQUEST_UNREADABLE", "Request file could not be read"
        ) from error
    if size <= 0 or size > maximum_bytes:
        raise RunnerError(
            "INVALID_REQUEST", "Request file size is outside the allowed range"
        )
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RunnerError(
            "INVALID_REQUEST", "Request file is not valid UTF-8 JSON"
        ) from error

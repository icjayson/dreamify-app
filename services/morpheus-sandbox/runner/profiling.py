"""Compact deterministic profiling with no model calls."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd
from pandas.api import types as ptypes

from .constants import MAX_PROFILE_BYTES, SCHEMA_VERSION
from .errors import RunnerError
from .loaders import LoadedAsset, json_scalar, load_assets
from .schemas import ProfileRequest


def _classify(series: pd.Series) -> str:
    if ptypes.is_bool_dtype(series.dtype):
        return "boolean"
    if ptypes.is_numeric_dtype(series.dtype):
        return "numeric"
    if ptypes.is_datetime64_any_dtype(series.dtype):
        return "temporal"

    sample = series.dropna().astype(str).head(200)
    if not sample.empty:
        parsed = pd.to_datetime(sample, errors="coerce", utc=True, format="mixed")
        if float(parsed.notna().mean()) >= 0.8:
            return "temporal"
    unique = int(series.nunique(dropna=True))
    return "categorical" if unique <= min(1_000, max(10, len(series) // 2)) else "text"


def _column_profile(name: str, series: pd.Series) -> dict[str, Any]:
    data_type = _classify(series)
    non_null = series.dropna()
    minimum: object = None
    maximum: object = None
    mean: float | None = None
    if data_type == "numeric" and not non_null.empty:
        numeric = pd.to_numeric(non_null, errors="coerce").dropna()
        if not numeric.empty:
            minimum = json_scalar(numeric.min())
            maximum = json_scalar(numeric.max())
            mean = float(numeric.mean())
    elif data_type == "temporal" and not non_null.empty:
        temporal = pd.to_datetime(non_null, errors="coerce", utc=True).dropna()
        if not temporal.empty:
            minimum = temporal.min().isoformat()
            maximum = temporal.max().isoformat()

    samples: list[object] = []
    for value in non_null.drop_duplicates().head(5):
        scalar = json_scalar(value)
        if scalar is not None:
            samples.append(scalar)
    return {
        "name": name,
        "data_type": data_type,
        "non_null_count": int(series.notna().sum()),
        "missing_count": int(series.isna().sum()),
        "unique_count": int(series.nunique(dropna=True)),
        "minimum": minimum,
        "maximum": maximum,
        "mean": mean,
        "sample_values": samples,
    }


def _dataset_profile(loaded: LoadedAsset) -> dict[str, Any]:
    frame = loaded.frame
    sample_rows = [
        {str(key): json_scalar(value) for key, value in row.items()}
        for row in frame.head(5).to_dict(orient="records")
    ]
    return {
        "asset_id": loaded.asset.asset_id,
        "file_name": loaded.asset.file_name,
        "format": loaded.asset.format,
        "sheet_name": loaded.sheet_name,
        "row_count": len(frame.index),
        "column_count": len(frame.columns),
        "columns": [
            _column_profile(str(column), frame[column]) for column in frame.columns
        ],
        "sample_rows": sample_rows,
    }


def build_profile(request: ProfileRequest, root: Any) -> dict[str, Any]:
    result = {
        "schema_version": SCHEMA_VERSION,
        "run_id": request.run_id,
        "datasets": [
            _dataset_profile(item) for item in load_assets(root, request.assets)
        ],
    }
    encoded = json.dumps(
        result, ensure_ascii=False, allow_nan=False, separators=(",", ":")
    ).encode("utf-8")
    if len(encoded) > MAX_PROFILE_BYTES:
        for dataset in result["datasets"]:
            dataset["sample_rows"] = []
            for column in dataset["columns"]:
                column["sample_values"] = []
        encoded = json.dumps(
            result, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
    if len(encoded) > MAX_PROFILE_BYTES:
        raise RunnerError("PROFILE_TOO_LARGE", "Profile exceeds its serialized ceiling")
    return result

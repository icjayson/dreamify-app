from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest

from runner.schemas import AnalysisRequest, ProfileRequest


@pytest.fixture
def csv_workspace(tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    input_directory = tmp_path / "input"
    input_directory.mkdir()
    content = (
        "date,region,revenue,orders\n"
        "2026-01-01,North,1000,10\n"
        "2026-01-15,South,1200,12\n"
        "2026-02-01,North,900,9\n"
    ).encode("utf-8")
    path = input_directory / "sales.csv"
    path.write_bytes(content)
    asset = {
        "asset_id": "asset-sales",
        "object_id": "object-sales",
        "file_name": "sales.csv",
        "format": "csv",
        "media_type": "text/csv",
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "relative_path": "input/sales.csv",
    }
    return tmp_path, asset


def profile_request(asset: dict[str, Any], run_id: str = "run-test") -> ProfileRequest:
    return ProfileRequest.from_mapping(
        {"schema_version": "1", "run_id": run_id, "assets": [asset]}
    )


def analysis_request(asset: dict[str, Any], code: str) -> AnalysisRequest:
    return AnalysisRequest.from_mapping(
        {
            "schema_version": "1",
            "run_id": "run-test",
            "assets": [asset],
            "code": code,
        }
    )

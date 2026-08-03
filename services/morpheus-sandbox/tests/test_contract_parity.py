from __future__ import annotations

import json
from pathlib import Path

from runner import constants


def test_typescript_and_python_resource_limits_match() -> None:
    path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "schemas"
        / "resource-limits.json"
    )
    contract = json.loads(path.read_text(encoding="utf-8"))
    assert contract["max_assets"] == constants.MAX_ASSETS
    assert contract["max_file_bytes"] == constants.MAX_FILE_BYTES
    assert contract["max_aggregate_file_bytes"] == constants.MAX_AGGREGATE_FILE_BYTES
    assert contract["max_rows_per_file"] == constants.MAX_ROWS_PER_FILE
    assert contract["max_columns_per_file"] == constants.MAX_COLUMNS_PER_FILE
    assert contract["max_profile_bytes"] == constants.MAX_PROFILE_BYTES
    assert contract["max_analysis_code_characters"] == constants.MAX_ANALYSIS_CODE_CHARS
    assert contract["max_analysis_result_bytes"] == constants.MAX_ANALYSIS_RESULT_BYTES
    assert contract["max_dashboard_bytes"] == constants.MAX_DASHBOARD_BYTES
    assert contract["max_charts"] == constants.MAX_CHARTS
    assert contract["max_metrics"] == constants.MAX_METRICS
    assert contract["max_tables"] == constants.MAX_TABLES
    assert contract["max_series_per_chart"] == constants.MAX_SERIES_PER_CHART
    assert contract["max_points_per_series"] == constants.MAX_POINTS_PER_SERIES
    assert contract["max_table_rows"] == constants.MAX_TABLE_ROWS

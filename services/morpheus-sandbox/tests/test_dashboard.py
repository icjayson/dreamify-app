from __future__ import annotations

import pytest

from runner.dashboard import validate_dashboard
from runner.errors import RunnerError


def dashboard() -> dict:
    return {
        "id": "dashboard-1",
        "title": "Sales",
        "theme_id": "default",
        "layout": {"type": "grid", "grid_columns": 24},
        "components": [
            {
                "id": "chart-1",
                "type": "chart",
                "position": {"x": 0, "y": 0, "width": 12, "height": 8},
                "component_config": {
                    "id": "chart-config-1",
                    "type": "bar",
                    "title": "Revenue",
                    "datasets": [
                        {
                            "label": "Revenue",
                            "data": [{"label": "North", "value": 1000}],
                        }
                    ],
                },
            }
        ],
    }


def test_accepts_bounded_dashboard() -> None:
    assert validate_dashboard(dashboard())["id"] == "dashboard-1"


def test_rejects_duplicate_component_ids() -> None:
    value = dashboard()
    value["components"].append(value["components"][0].copy())
    with pytest.raises(RunnerError) as captured:
        validate_dashboard(value)
    assert captured.value.code == "DASHBOARD_INVALID"


def test_rejects_more_than_five_hundred_points() -> None:
    value = dashboard()
    value["components"][0]["component_config"]["datasets"][0]["data"] = [
        {"label": str(index), "value": index} for index in range(501)
    ]
    with pytest.raises(RunnerError) as captured:
        validate_dashboard(value)
    assert captured.value.code == "DASHBOARD_INVALID"

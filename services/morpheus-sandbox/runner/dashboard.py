"""Final deterministic dashboard guardrails."""

from __future__ import annotations

import json
import math
from collections import Counter
from collections.abc import Mapping
from typing import Any

from .constants import (
    MAX_CHARTS,
    MAX_DASHBOARD_BYTES,
    MAX_METRICS,
    MAX_POINTS_PER_SERIES,
    MAX_SERIES_PER_CHART,
    MAX_TABLE_ROWS,
    MAX_TABLES,
)
from .errors import RunnerError

_CHART_TYPES = frozenset(
    {
        "line",
        "bar",
        "stacked_bar",
        "stacked_column",
        "pie",
        "area",
        "scatter",
        "donut",
        "composed",
        "radar",
        "radial_bar",
        "funnel",
        "treemap",
        "sankey",
        "geographic",
    }
)


def _object(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError("DASHBOARD_INVALID", f"{label} must be an object")
    return value


def _bounded_string(value: object, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise RunnerError("DASHBOARD_INVALID", f"{label} must be a bounded string")
    return value


def _position(value: object) -> None:
    position = _object(value, "component position")
    expected = {"x", "y", "width", "height"}
    if set(position) != expected:
        raise RunnerError("DASHBOARD_INVALID", "component position has invalid fields")
    for key, minimum, maximum in (
        ("x", 0, 23),
        ("y", 0, 10_000),
        ("width", 1, 24),
        ("height", 1, 100),
    ):
        number = position[key]
        if (
            isinstance(number, bool)
            or not isinstance(number, int)
            or not minimum <= number <= maximum
        ):
            raise RunnerError(
                "DASHBOARD_INVALID", f"position.{key} is outside its bounds"
            )
    if position["x"] + position["width"] > 24:
        raise RunnerError("DASHBOARD_INVALID", "component exceeds the 24-column grid")


def _chart(config: Mapping[str, Any]) -> None:
    if config.get("type") not in _CHART_TYPES:
        raise RunnerError("DASHBOARD_INVALID", "unsupported chart type")
    _bounded_string(config.get("title"), "chart title", 256)
    datasets = config.get("datasets")
    if not isinstance(datasets, list) or not 1 <= len(datasets) <= MAX_SERIES_PER_CHART:
        raise RunnerError(
            "DASHBOARD_INVALID", "chart dataset count is outside its bounds"
        )
    for dataset in datasets:
        item = _object(dataset, "chart dataset")
        _bounded_string(item.get("label"), "dataset label", 256)
        points = item.get("data")
        if not isinstance(points, list) or len(points) > MAX_POINTS_PER_SERIES:
            raise RunnerError("DASHBOARD_INVALID", "chart point count exceeded")
        for point in points:
            row = _object(point, "chart point")
            _bounded_string(row.get("label"), "point label", 256)
            value = row.get("value")
            if not isinstance(value, (str, int, float)) or isinstance(value, bool):
                raise RunnerError("DASHBOARD_INVALID", "chart point value is invalid")
            if isinstance(value, float) and not math.isfinite(value):
                raise RunnerError(
                    "DASHBOARD_INVALID", "chart point value must be finite"
                )


def _metric(config: Mapping[str, Any]) -> None:
    _bounded_string(config.get("title"), "metric title", 256)
    value = config.get("value")
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise RunnerError("DASHBOARD_INVALID", "metric value is invalid")
    if isinstance(value, float) and not math.isfinite(value):
        raise RunnerError("DASHBOARD_INVALID", "metric value must be finite")


def _table(config: Mapping[str, Any]) -> None:
    _bounded_string(config.get("title"), "table title", 256)
    columns = config.get("columns")
    rows = config.get("data")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 100:
        raise RunnerError("DASHBOARD_INVALID", "table columns are invalid")
    if not isinstance(rows, list) or len(rows) > MAX_TABLE_ROWS:
        raise RunnerError("DASHBOARD_INVALID", "table row count exceeded")
    if any(not isinstance(row, Mapping) for row in rows):
        raise RunnerError("DASHBOARD_INVALID", "table rows must be objects")


def validate_dashboard(value: object) -> dict[str, Any]:
    dashboard = dict(_object(value, "dashboard"))
    _bounded_string(dashboard.get("id"), "dashboard id", 128)
    _bounded_string(dashboard.get("title"), "dashboard title", 256)
    layout = _object(dashboard.get("layout"), "dashboard layout")
    if layout.get("type") not in {"grid", "flex", "custom"}:
        raise RunnerError("DASHBOARD_INVALID", "dashboard layout type is invalid")
    components = dashboard.get("components")
    if not isinstance(components, list):
        raise RunnerError("DASHBOARD_INVALID", "dashboard components must be an array")

    ids: set[str] = set()
    counts: Counter[str] = Counter()
    for raw_component in components:
        component = _object(raw_component, "dashboard component")
        component_id = _bounded_string(component.get("id"), "component id", 128)
        if component_id in ids:
            raise RunnerError(
                "DASHBOARD_INVALID", "dashboard component IDs must be unique"
            )
        ids.add(component_id)
        kind = component.get("type")
        if kind not in {"chart", "metric", "table"}:
            raise RunnerError(
                "DASHBOARD_INVALID", "unsupported dashboard component type"
            )
        counts[kind] += 1
        _position(component.get("position"))
        config = _object(component.get("component_config"), "component config")
        _bounded_string(config.get("id"), "component config id", 128)
        if kind == "chart":
            _chart(config)
        elif kind == "metric":
            _metric(config)
        else:
            _table(config)

    if (
        counts["chart"] > MAX_CHARTS
        or counts["metric"] > MAX_METRICS
        or counts["table"] > MAX_TABLES
    ):
        raise RunnerError("DASHBOARD_INVALID", "dashboard component count exceeded")
    try:
        encoded = json.dumps(
            dashboard, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise RunnerError(
            "DASHBOARD_INVALID", "dashboard is not strict JSON"
        ) from error
    if len(encoded) > MAX_DASHBOARD_BYTES:
        raise RunnerError(
            "DASHBOARD_TOO_LARGE", "dashboard exceeds its serialized ceiling"
        )
    return dashboard

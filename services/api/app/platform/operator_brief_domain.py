"""Deterministic, storage-neutral Operator Brief domain logic."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

MAX_SNAPSHOT_METRICS = 12
MAX_CHANGES = 4
MIN_PCT_CHANGE = 0.15
MIN_ABS_VALUE = 1.0

_COST_HINTS = ("spend", "cost", "cpc", "cpm", "budget", "fee")
_REVENUE_HINTS = (
    "revenue",
    "sales",
    "gmv",
    "income",
    "profit",
    "roas",
    "conversion",
)
_INVENTORY_HINTS = ("inventory", "stock", "quantity", "units_available")


@dataclass(frozen=True)
class MetricChange:
    metric: str
    previous: float
    current: float
    pct_change: float
    severity: str

    @property
    def direction(self) -> str:
        return "up" if self.current >= self.previous else "down"


@dataclass(frozen=True)
class ComposedOperatorBrief:
    headline: str
    lines: list[str] = field(default_factory=list)
    recommendation: str = ""
    severity: str = "info"
    changes: list[MetricChange] = field(default_factory=list)

    def as_text(self) -> str:
        icon = {"alert": "🔴", "warn": "🟡", "info": "🔵"}.get(self.severity, "🔵")
        parts = [f"{icon} {self.headline}", *self.lines]
        if self.recommendation:
            parts.append(f"→ {self.recommendation}")
        return "\n".join(parts)


def _coerce_number(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def build_metric_snapshot(
    metrics: Mapping[str, object] | None = None,
    row_count: int | None = None,
    column_count: int | None = None,
) -> dict[str, float]:
    """Build a bounded snapshot without reading storage or importing data libraries."""
    normalized = []
    for metric, value in (metrics or {}).items():
        number = _coerce_number(value)
        name = str(metric).strip()
        if number is not None and name and not name.startswith("__"):
            normalized.append((name, number))
    normalized.sort(key=lambda item: (-abs(item[1]), item[0]))
    snapshot = dict(normalized[:MAX_SNAPSHOT_METRICS])
    if row_count is not None:
        snapshot["__rows__"] = float(row_count)
    if column_count is not None:
        snapshot["__cols__"] = float(column_count)
    return snapshot


def _severity(pct_change: float) -> str:
    magnitude = abs(pct_change)
    if magnitude >= 0.40:
        return "alert"
    if magnitude >= 0.20:
        return "warn"
    return "info"


def detect_changes(
    previous: Mapping[str, float] | None,
    current: Mapping[str, float] | None,
    min_pct: float = MIN_PCT_CHANGE,
    top_n: int = MAX_CHANGES,
) -> list[MetricChange]:
    """Return material metric movements, ranked by absolute percentage change."""
    before = previous or {}
    changes: list[MetricChange] = []
    for metric, current_value in (current or {}).items():
        if metric.startswith("__") or metric not in before:
            continue
        previous_value = before[metric]
        if abs(previous_value) < MIN_ABS_VALUE and abs(current_value) < MIN_ABS_VALUE:
            continue
        denominator = abs(previous_value) if abs(previous_value) >= 1 else 1.0
        pct_change = (current_value - previous_value) / denominator
        if abs(pct_change) >= min_pct:
            changes.append(
                MetricChange(
                    metric=metric,
                    previous=previous_value,
                    current=current_value,
                    pct_change=pct_change,
                    severity=_severity(pct_change),
                )
            )
    changes.sort(key=lambda item: (-abs(item.pct_change), item.metric))
    return changes[:top_n]


def _matches(metric: str, hints: Sequence[str]) -> bool:
    normalized = metric.lower()
    return any(hint in normalized for hint in hints)


def _recommend(changes: list[MetricChange]) -> str:
    cost_up = [
        item
        for item in changes
        if item.direction == "up" and _matches(item.metric, _COST_HINTS)
    ]
    revenue_down = [
        item
        for item in changes
        if item.direction == "down" and _matches(item.metric, _REVENUE_HINTS)
    ]
    stock_down = [
        item
        for item in changes
        if item.direction == "down" and _matches(item.metric, _INVENTORY_HINTS)
    ]
    if cost_up and revenue_down:
        return (
            "Spend is up while returns are down — review the worst performer "
            f"before more budget bleeds (watch {cost_up[0].metric})."
        )
    if stock_down:
        return f"{stock_down[0].metric} is dropping fast — check reorder timing now."
    if revenue_down:
        item = revenue_down[0]
        movement = abs(item.pct_change)
        return f"{item.metric} fell {movement:.0%} — investigate the driver today."
    top = changes[0]
    verb = "jumped" if top.direction == "up" else "dropped"
    return f"{top.metric} {verb} {abs(top.pct_change):.0%} — worth a look."


def _format_line(change: MetricChange) -> str:
    arrow = "▲" if change.direction == "up" else "▼"
    return (
        f"{arrow} {change.metric}: {change.previous:,.0f} → {change.current:,.0f} "
        f"({change.pct_change:+.0%})"
    )


def compose_brief(
    provider: str,
    account_name: str,
    changes: list[MetricChange],
    is_first_run: bool = False,
) -> ComposedOperatorBrief:
    """Compose a deterministic brief that never requires an LLM call."""
    label = account_name or provider
    if is_first_run:
        return ComposedOperatorBrief(
            headline=f"{label}: baseline captured.",
            lines=["First sync — I'll flag what changes from next run on."],
        )
    if not changes:
        return ComposedOperatorBrief(
            headline=f"{label}: steady — nothing material moved."
        )
    top = changes[0]
    return ComposedOperatorBrief(
        headline=f"{label}: {top.metric} {top.direction} {abs(top.pct_change):.0%}.",
        lines=[_format_line(item) for item in changes],
        recommendation=_recommend(changes),
        severity=top.severity,
        changes=changes,
    )


def serialize_changes(changes: Sequence[MetricChange]) -> list[dict[str, object]]:
    return [
        {
            "metric": item.metric,
            "previous": item.previous,
            "current": item.current,
            "pct_change": item.pct_change,
            "severity": item.severity,
        }
        for item in changes
    ]

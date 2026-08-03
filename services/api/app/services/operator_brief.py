"""
Operator Brief — turn a finished sync into a proactive "what changed & why + what
to do" message, instead of a passive "your data synced" notification.

This is the core of the operator wedge: Dreamify watches the numbers and speaks up,
rather than waiting to be opened. The logic here is intentionally deterministic and
dependency-light so it is unit-testable without AWS or an LLM:

  - ``extract_snapshot`` reduces a finished sync to a compact ``{metric: value}`` dict.
  - ``detect_changes`` diffs this run's snapshot against the previous run's.
  - ``compose_brief`` turns ranked changes into a short operator message.

LLM narration (Morpheus) is an optional upgrade layered on top later; the baseline
brief stands on its own and never needs a model to fire.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Don't pull a multi-hundred-MB CSV into memory on the sync hot path.
_MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024
# Keep snapshots small: only the largest numeric columns carry signal.
_MAX_SNAPSHOT_METRICS = 12
# Change-detection thresholds.
_MIN_PCT_CHANGE = 0.15  # ignore moves smaller than 15%
_MIN_ABS_VALUE = 1.0  # ignore metrics that are ~0 in both runs

# Substring hints used only to colour the recommendation. Heuristic, not a taxonomy.
_COST_HINTS = ("spend", "cost", "cpc", "cpm", "budget", "fee")
_REVENUE_HINTS = ("revenue", "sales", "gmv", "income", "profit", "roas", "conversion")
_INVENTORY_HINTS = ("inventory", "stock", "quantity", "units_available")


@dataclass
class MetricChange:
    """One metric's movement between two consecutive runs."""

    metric: str
    previous: float
    current: float
    pct_change: float  # signed fraction, e.g. -0.22 for -22%
    severity: str  # "alert" | "warn" | "info"

    @property
    def direction(self) -> str:
        return "up" if self.current >= self.previous else "down"


@dataclass
class OperatorBrief:
    """A composed, ready-to-deliver brief."""

    headline: str
    lines: List[str] = field(default_factory=list)
    recommendation: str = ""
    severity: str = "info"
    changes: List[MetricChange] = field(default_factory=list)

    def as_text(self) -> str:
        icon = {"alert": "🔴", "warn": "🟡", "info": "🔵"}.get(self.severity, "🔵")
        parts = [f"{icon} {self.headline}"]
        parts.extend(self.lines)
        if self.recommendation:
            parts.append(f"→ {self.recommendation}")
        return "\n".join(parts)


def _classify_severity(pct_change: float) -> str:
    magnitude = abs(pct_change)
    if magnitude >= 0.40:
        return "alert"
    if magnitude >= 0.20:
        return "warn"
    return "info"


def _coerce_number(value: object) -> Optional[float]:
    try:
        num = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):  # NaN / inf guard
        return None
    return num


def extract_snapshot(
    asset: Optional[Dict],
    row_count: Optional[int] = None,
    column_count: Optional[int] = None,
) -> Dict[str, float]:
    """
    Reduce a finished sync to a compact numeric snapshot.

    Prefers real money metrics (sums of the largest numeric columns in the synced
    CSV). Falls back to row/column counts when the asset can't be read — never
    raises, because a sync must complete even if snapshotting fails.
    """
    snapshot: Dict[str, float] = {}
    bucket = (asset or {}).get("s3_bucket")
    key = (asset or {}).get("s3_key")

    if bucket and key:
        try:
            snapshot = _snapshot_from_s3_csv(str(bucket), str(key))
        except Exception as exc:  # pragma: no cover - defensive, network-dependent
            logger.warning("Operator-brief snapshot from asset failed: %s", exc)

    if row_count is not None:
        snapshot["__rows__"] = float(row_count)
    if column_count is not None:
        snapshot["__cols__"] = float(column_count)
    return snapshot


def _snapshot_from_s3_csv(bucket: str, key: str) -> Dict[str, float]:
    """Download the synced CSV and sum its largest numeric columns."""
    import io

    import pandas as pd

    from utils.s3.client import download_bytes

    raw = download_bytes(bucket, key)
    if len(raw) > _MAX_SNAPSHOT_BYTES:
        logger.info("Asset %s too large (%d bytes) for rich snapshot", key, len(raw))
        return {}

    text = raw.decode("utf-8", errors="replace")
    frame = pd.read_csv(io.StringIO(text))
    numeric = frame.select_dtypes(include="number")
    sums = numeric.sum(numeric_only=True)

    ranked = sorted(sums.items(), key=lambda kv: abs(kv[1]), reverse=True)
    snapshot: Dict[str, float] = {}
    for column, total in ranked[:_MAX_SNAPSHOT_METRICS]:
        value = _coerce_number(total)
        if value is not None:
            snapshot[str(column)] = value
    return snapshot


def detect_changes(
    previous: Optional[Dict[str, float]],
    current: Optional[Dict[str, float]],
    *,
    min_pct: float = _MIN_PCT_CHANGE,
    top_n: int = 4,
) -> List[MetricChange]:
    """Return material metric movements, biggest first. Empty when nothing moved."""
    previous = previous or {}
    current = current or {}
    changes: List[MetricChange] = []

    for metric, curr in current.items():
        if metric.startswith("__"):  # skip housekeeping metrics like __rows__
            continue
        prev = previous.get(metric)
        if prev is None:
            continue
        if abs(prev) < _MIN_ABS_VALUE and abs(curr) < _MIN_ABS_VALUE:
            continue
        denom = abs(prev) if abs(prev) >= _MIN_ABS_VALUE else 1.0
        pct = (curr - prev) / denom
        if abs(pct) < min_pct:
            continue
        changes.append(
            MetricChange(
                metric=metric,
                previous=prev,
                current=curr,
                pct_change=pct,
                severity=_classify_severity(pct),
            )
        )

    changes.sort(key=lambda c: abs(c.pct_change), reverse=True)
    return changes[:top_n]


def _hits(metric: str, hints: tuple) -> bool:
    name = metric.lower()
    return any(hint in name for hint in hints)


def _recommend(changes: List[MetricChange]) -> str:
    """Pick one heuristic recommendation. Deterministic; upgraded by Morpheus later."""
    cost_up = [
        c for c in changes if c.direction == "up" and _hits(c.metric, _COST_HINTS)
    ]
    rev_down = [
        c for c in changes if c.direction == "down" and _hits(c.metric, _REVENUE_HINTS)
    ]
    stock_down = [
        c
        for c in changes
        if c.direction == "down" and _hits(c.metric, _INVENTORY_HINTS)
    ]

    if cost_up and rev_down:
        return (
            f"Spend is up while returns are down — review the worst performer "
            f"before more budget bleeds (watch {cost_up[0].metric})."
        )
    if stock_down:
        return f"{stock_down[0].metric} is dropping fast — check reorder timing now."
    if rev_down:
        c = rev_down[0]
        return (
            f"{c.metric} fell {abs(c.pct_change):.0%} — investigate the driver today."
        )
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
    changes: List[MetricChange],
    *,
    is_first_run: bool = False,
) -> OperatorBrief:
    """Turn ranked changes into a short, deliverable operator brief."""
    label = account_name or provider

    if is_first_run:
        return OperatorBrief(
            headline=f"{label}: baseline captured.",
            lines=["First sync — I'll flag what changes from next run on."],
            severity="info",
        )
    if not changes:
        return OperatorBrief(
            headline=f"{label}: steady — nothing material moved.",
            severity="info",
        )

    top = changes[0]
    verb = "up" if top.direction == "up" else "down"
    return OperatorBrief(
        headline=f"{label}: {top.metric} {verb} {abs(top.pct_change):.0%}.",
        lines=[_format_line(c) for c in changes],
        recommendation=_recommend(changes),
        severity=top.severity,
        changes=changes,
    )

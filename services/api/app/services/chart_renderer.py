"""
Convert Dreamify dashboard chart configs to PNG bytes for Slack upload.

Requires: plotly>=5.18.0, kaleido>=1.0.0
Only active when ENABLE_CHART_RENDERING=true.

Morpheus chart field names (actual output format):
  - type field : "chart_type"  (fallback: "type")
  - data points: datasets[i]["data"] = [{"label": "Jan", "value": 1440502}, ...]
  - top-level labels key is always empty; labels are embedded in data objects

Supported chart types:
  line, bar, area, pie, donut, scatter, funnel

Unsupported types are silently skipped:
  metric, table, geographic, heatmap, waterfall, treemap, gauge, candlestick
"""

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Top-level import so tests can patch `app.services.chart_renderer.go`.
# Falls back to None when plotly is not installed (guarded in render functions).
try:
    import plotly.graph_objects as go  # type: ignore
except ImportError:  # pragma: no cover
    go = None  # type: ignore

# Chart types this renderer can handle
RENDERABLE_TYPES = {"line", "bar", "area", "pie", "donut", "scatter", "funnel"}

# Canvas size for all chart previews
CHART_WIDTH_PX = 800
CHART_HEIGHT_PX = 450


def is_chart_rendering_enabled() -> bool:
    """Return True when ENABLE_CHART_RENDERING=true is set in the environment."""
    return os.environ.get("ENABLE_CHART_RENDERING", "false").lower() == "true"


def _get_chart_type(chart: Dict[str, Any]) -> str:
    """
    Return the normalised chart type string.
    Morpheus uses 'chart_type'; older format may use 'type'.
    """
    return (chart.get("chart_type") or chart.get("type") or "").lower()


def _unpack_dataset(dataset: Dict[str, Any]) -> Tuple[List[str], List[Any]]:
    """
    Extract parallel (labels, values) lists from a dataset dict.

    Morpheus data format: {"label": "...", "data": [{"label": "Jan", "value": 100}, ...]}
    Flat format (legacy): {"label": "...", "data": [100, 200, 300]}
    """
    raw = dataset.get("data") or []
    if not raw:
        return [], []

    if isinstance(raw[0], dict):
        labels = [str(item.get("label", "")) for item in raw]
        values = [item.get("value", 0) for item in raw]
    else:
        labels = []
        values = raw

    return labels, values


def render_chart_to_png(chart: Dict[str, Any]) -> Optional[bytes]:
    """
    Convert one Morpheus chart config dict to PNG bytes.

    Returns None when:
    - chart type is not in RENDERABLE_TYPES
    - datasets are missing or empty
    - plotly/kaleido raises an error
    """
    chart_type = _get_chart_type(chart)
    if chart_type not in RENDERABLE_TYPES:
        logger.debug("Skipping unsupported chart type '%s'", chart_type)
        return None

    if go is None:  # pragma: no cover
        logger.warning("plotly is not installed — cannot render chart")
        return None

    try:
        datasets = chart.get("datasets") or []
        title = chart.get("title", "")
        styling = chart.get("styling") or {}
        color_palette: List[str] = styling.get("color_palette") or []

        if chart_type in ("pie", "donut"):
            fig = _build_pie_figure(datasets, color_palette, chart_type)
        elif chart_type == "funnel":
            fig = _build_funnel_figure(datasets, color_palette)
        else:
            fig = _build_cartesian_figure(datasets, color_palette, chart_type)

        fig.update_layout(
            title=dict(text=title, font=dict(size=16)),
            width=CHART_WIDTH_PX,
            height=CHART_HEIGHT_PX,
            paper_bgcolor="white",
            plot_bgcolor="white",
            legend=dict(bgcolor="rgba(0,0,0,0)"),
            margin=dict(l=40, r=40, t=60, b=40),
        )

        return fig.to_image(format="png")

    except Exception as exc:
        logger.warning("render_chart_to_png failed for '%s': %s", chart.get("title"), exc)
        return None


def render_dashboard_previews(
    dashboard: Dict[str, Any], max_charts: int = 3
) -> List[Tuple[bytes, str]]:
    """
    Render up to max_charts PNGs from a Dreamify dashboard dict.

    Returns a list of (png_bytes, chart_title) tuples.
    Charts whose type is unsupported or that fail to render are skipped silently.
    """
    charts = dashboard.get("charts") or []
    results: List[Tuple[bytes, str]] = []

    for chart in charts:
        if len(results) >= max_charts:
            break
        if _get_chart_type(chart) not in RENDERABLE_TYPES:
            continue
        png = render_chart_to_png(chart)
        if png:
            title = chart.get("title") or f"chart_{len(results) + 1}"
            results.append((png, title))

    return results


# ── Private figure builders ───────────────────────────────────────────────────

def _build_pie_figure(
    datasets: list,
    color_palette: List[str],
    chart_type: str,
) -> Any:
    labels, values = _unpack_dataset(datasets[0]) if datasets else ([], [])
    hole = 0.4 if chart_type == "donut" else 0
    trace = go.Pie(
        labels=labels,
        values=values,
        hole=hole,
        marker=dict(colors=color_palette) if color_palette else {},
    )
    return go.Figure(data=[trace])


def _build_funnel_figure(
    datasets: list,
    color_palette: List[str],
) -> Any:
    labels, values = _unpack_dataset(datasets[0]) if datasets else ([], [])
    trace = go.Funnel(
        y=labels,
        x=values,
        marker=dict(color=color_palette) if color_palette else {},
    )
    return go.Figure(data=[trace])


def _build_cartesian_figure(
    datasets: list,
    color_palette: List[str],
    chart_type: str,
) -> Any:
    fig = go.Figure()

    for idx, dataset in enumerate(datasets):
        x_labels, y_values = _unpack_dataset(dataset)
        series_name = dataset.get("label") or f"Series {idx + 1}"
        color = color_palette[idx] if idx < len(color_palette) else None

        if chart_type == "bar":
            trace = go.Bar(
                x=x_labels, y=y_values, name=series_name,
                marker=dict(color=color) if color else {},
            )
        elif chart_type == "area":
            trace = go.Scatter(
                x=x_labels, y=y_values, name=series_name,
                mode="lines", fill="tonexty",
                line=dict(color=color) if color else {},
            )
        elif chart_type == "scatter":
            trace = go.Scatter(
                x=x_labels, y=y_values, name=series_name,
                mode="markers",
                marker=dict(color=color) if color else {},
            )
        else:
            # Default: line
            trace = go.Scatter(
                x=x_labels, y=y_values, name=series_name,
                mode="lines",
                line=dict(color=color) if color else {},
            )
        fig.add_trace(trace)

    return fig

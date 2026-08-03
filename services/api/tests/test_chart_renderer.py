"""
Unit tests for app/services/chart_renderer.py.

kaleido is NOT required in CI — fig.to_image() is mocked throughout.
`app.services.chart_renderer.go` is patched at the module level so every
internal reference to `go.Figure`, `go.Bar`, etc. picks up our mock.
"""

import os
from contextlib import contextmanager
from typing import Any, Dict
from unittest.mock import MagicMock, patch

FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


# ── Shared fixture helpers ────────────────────────────────────────────────────

def _make_go_mock() -> MagicMock:
    """Return a go mock whose Figure() returns a figure with to_image() = FAKE_PNG."""
    fig = MagicMock()
    fig.to_image.return_value = FAKE_PNG
    fig.add_trace.return_value = None
    go_mock = MagicMock()
    go_mock.Figure.return_value = fig
    return go_mock


@contextmanager
def _patch_go():
    """Patch the module-level `go` in chart_renderer and yield (go_mock, fig_mock)."""
    go_mock = _make_go_mock()
    with patch("app.services.chart_renderer.go", go_mock):
        yield go_mock, go_mock.Figure.return_value


# ── Chart fixtures (Morpheus real output format) ──────────────────────────────
# - type field is "chart_type" (not "type")
# - data is [{"label": "...", "value": ...}] (not flat list)
# - top-level "labels" key is always empty

def _lv(labels, values):
    """Build a Morpheus-style data array from parallel label/value lists."""
    return [{"label": l, "value": v} for l, v in zip(labels, values)]


def _line_chart(**overrides) -> Dict[str, Any]:
    base = {
        "chart_type": "line",
        "title": "Revenue Over Time",
        "labels": [],
        "datasets": [{"label": "Revenue", "data": _lv(["Jan", "Feb", "Mar"], [100, 200, 150])}],
        "styling": {"color_palette": ["#4C9BE8"]},
    }
    base.update(overrides)
    return base


def _bar_chart(**overrides) -> Dict[str, Any]:
    base = {
        "chart_type": "bar",
        "title": "Sales by Region",
        "labels": [],
        "datasets": [{"label": "Sales", "data": _lv(["North", "South", "East"], [300, 450, 200])}],
        "styling": {},
    }
    base.update(overrides)
    return base


def _pie_chart(**overrides) -> Dict[str, Any]:
    base = {
        "chart_type": "pie",
        "title": "Market Share",
        "labels": [],
        "datasets": [{"label": "Share", "data": _lv(["A", "B", "C"], [40, 35, 25])}],
        "styling": {"color_palette": ["#FF6B6B", "#4ECDC4", "#45B7D1"]},
    }
    base.update(overrides)
    return base


def _fake_png() -> bytes:
    return FAKE_PNG


# ── is_chart_rendering_enabled ────────────────────────────────────────────────

class TestIsChartRenderingEnabled:
    def test_disabled_by_default(self):
        from app.services.chart_renderer import is_chart_rendering_enabled
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ENABLE_CHART_RENDERING", None)
            assert is_chart_rendering_enabled() is False

    def test_enabled_when_true(self):
        from app.services.chart_renderer import is_chart_rendering_enabled
        with patch.dict(os.environ, {"ENABLE_CHART_RENDERING": "true"}):
            assert is_chart_rendering_enabled() is True

    def test_case_insensitive(self):
        from app.services.chart_renderer import is_chart_rendering_enabled
        with patch.dict(os.environ, {"ENABLE_CHART_RENDERING": "TRUE"}):
            assert is_chart_rendering_enabled() is True

    def test_false_string_disabled(self):
        from app.services.chart_renderer import is_chart_rendering_enabled
        with patch.dict(os.environ, {"ENABLE_CHART_RENDERING": "false"}):
            assert is_chart_rendering_enabled() is False


# ── render_chart_to_png ───────────────────────────────────────────────────────

class TestRenderChartToPng:
    def test_unsupported_chart_type_returns_none(self):
        from app.services.chart_renderer import render_chart_to_png
        assert render_chart_to_png({"chart_type": "metric", "title": "Users", "datasets": []}) is None

    def test_legacy_type_field_also_works(self):
        from app.services.chart_renderer import render_chart_to_png
        # Legacy charts may use "type" instead of "chart_type"
        assert render_chart_to_png({"type": "metric", "title": "T", "datasets": []}) is None

    def test_table_type_returns_none(self):
        from app.services.chart_renderer import render_chart_to_png
        assert render_chart_to_png({"chart_type": "table", "title": "T", "datasets": []}) is None

    def test_missing_type_returns_none(self):
        from app.services.chart_renderer import render_chart_to_png
        assert render_chart_to_png({"title": "No type", "datasets": []}) is None

    def test_line_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go() as (_, fig):
            result = render_chart_to_png(_line_chart())
        assert result == FAKE_PNG
        fig.to_image.assert_called_once_with(format="png")

    def test_bar_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_bar_chart())
        assert result == FAKE_PNG

    def test_pie_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_pie_chart())
        assert result == FAKE_PNG

    def test_donut_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_pie_chart(chart_type="donut"))
        assert result == FAKE_PNG

    def test_area_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_line_chart(chart_type="area"))
        assert result == FAKE_PNG

    def test_scatter_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_line_chart(chart_type="scatter"))
        assert result == FAKE_PNG

    def test_funnel_chart_returns_png_bytes(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(
                {
                    "chart_type": "funnel",
                    "title": "Conversion Funnel",
                    "labels": [],
                    "datasets": [{"label": "Users", "data": _lv(["Visit", "Signup", "Purchase"], [1000, 500, 200])}],
                    "styling": {},
                }
            )
        assert result == FAKE_PNG

    def test_error_in_to_image_returns_none(self):
        from app.services.chart_renderer import render_chart_to_png
        go_mock = _make_go_mock()
        go_mock.Figure.return_value.to_image.side_effect = RuntimeError("kaleido crashed")
        with patch("app.services.chart_renderer.go", go_mock):
            result = render_chart_to_png(_line_chart())
        assert result is None

    def test_chart_with_no_color_palette(self):
        from app.services.chart_renderer import render_chart_to_png
        with _patch_go():
            result = render_chart_to_png(_line_chart(styling={}))
        assert result == FAKE_PNG

    def test_chart_with_multiple_datasets(self):
        from app.services.chart_renderer import render_chart_to_png
        chart = _bar_chart(
            datasets=[
                {"label": "2023", "data": _lv(["Q1", "Q2", "Q3"], [100, 200, 300])},
                {"label": "2024", "data": _lv(["Q1", "Q2", "Q3"], [150, 250, 350])},
            ]
        )
        with _patch_go():
            result = render_chart_to_png(chart)
        assert result == FAKE_PNG


# ── render_dashboard_previews ─────────────────────────────────────────────────

class TestRenderDashboardPreviews:
    def test_empty_dashboard_returns_empty(self):
        from app.services.chart_renderer import render_dashboard_previews
        assert render_dashboard_previews({}) == []
        assert render_dashboard_previews({"charts": []}) == []

    def test_skips_non_renderable_types(self):
        from app.services.chart_renderer import render_dashboard_previews
        dashboard = {
            "charts": [
                {"chart_type": "metric", "title": "Metric 1"},
                {"chart_type": "table", "title": "Table 1"},
                {"chart_type": "geographic", "title": "Map"},
            ]
        }
        assert render_dashboard_previews(dashboard, max_charts=3) == []

    def test_max_charts_cap(self):
        from app.services.chart_renderer import render_dashboard_previews
        charts = [_line_chart(title=f"Chart {i}") for i in range(6)]
        with _patch_go():
            result = render_dashboard_previews({"charts": charts}, max_charts=3)
        assert len(result) == 3

    def test_returns_title_with_png(self):
        from app.services.chart_renderer import render_dashboard_previews
        dashboard = {"charts": [_line_chart(title="Revenue Chart")]}
        with _patch_go():
            result = render_dashboard_previews(dashboard, max_charts=3)
        assert len(result) == 1
        png_bytes, title = result[0]
        assert png_bytes == FAKE_PNG
        assert title == "Revenue Chart"

    def test_failed_chart_is_skipped(self):
        from app.services.chart_renderer import render_dashboard_previews
        charts = [
            _line_chart(title="Good Chart"),
            _bar_chart(title="Bad Chart"),
            _pie_chart(title="Another Good Chart"),
        ]
        call_count = 0

        def fake_render(chart):
            nonlocal call_count
            call_count += 1
            return None if call_count == 2 else FAKE_PNG

        with patch("app.services.chart_renderer.render_chart_to_png", side_effect=fake_render):
            result = render_dashboard_previews({"charts": charts}, max_charts=3)

        assert len(result) == 2
        assert result[0][1] == "Good Chart"
        assert result[1][1] == "Another Good Chart"

    def test_mixed_renderable_and_not(self):
        from app.services.chart_renderer import render_dashboard_previews
        dashboard = {
            "charts": [
                {"chart_type": "metric", "title": "KPI"},
                _line_chart(title="Trend"),
                {"chart_type": "table", "title": "Breakdown"},
                _bar_chart(title="Comparison"),
            ]
        }
        with _patch_go():
            result = render_dashboard_previews(dashboard, max_charts=3)
        assert len(result) == 2
        titles = [t for _, t in result]
        assert "Trend" in titles
        assert "Comparison" in titles

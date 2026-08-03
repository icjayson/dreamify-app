"""Pydantic v2 schemas for structured chart-modification output.

The ``chart_type`` Literal is sourced directly from
``morpheus.knowledge.charts.chart_types.CHART_TYPES`` so the schema, the
chart-types tool, and the frontend stay in sync — there is a single source of
truth for the allowed visualization kinds.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from morpheus.knowledge.charts.chart_types import CHART_TYPES

# Single source of truth for allowed chart kinds. Sorted for a deterministic
# Literal definition (schema/JSON-schema output is stable across runs).
ChartType = Literal[tuple(sorted(CHART_TYPES.keys()))]  # type: ignore[valid-type]


class DataPoint(BaseModel):
    """A single (label, value) pair within a dataset series."""

    label: str = Field(description="Human-readable label for this data point.")
    value: float = Field(description="Numeric value computed from the data.")


class Dataset(BaseModel):
    """A named series of data points (one line/bar/slice group)."""

    label: str = Field(description="Name of this series.")
    data: List[DataPoint] = Field(
        default_factory=list, description="Ordered data points for this series."
    )


class Layout(BaseModel):
    """Grid placement and sizing for the chart tile (24-column grid units)."""

    x: int = Field(default=0, description="Grid X position.")
    y: int = Field(default=0, description="Grid Y position.")
    w: int = Field(default=12, description="Grid width in columns.")
    h: int = Field(default=12, description="Grid height in rows.")
    minW: int = Field(default=4, description="Minimum grid width.")
    minH: int = Field(default=10, description="Minimum grid height.")


class ChartConfig(BaseModel):
    """Display toggles for the chart."""

    animation: bool = True
    showGrid: bool = True
    showLegend: bool = True


class ChartStyling(BaseModel):
    """Theme and color token overrides. All fields optional with defaults."""

    theme: str = Field(default="default", description="Visual theme identifier.")
    title: Optional[str] = Field(default=None, description="Title color token.")
    description: Optional[str] = Field(
        default=None, description="Description color token."
    )
    cartesianGrid: Optional[str] = Field(
        default=None, description="Grid line color token."
    )
    xAxis: Optional[str] = Field(default=None, description="X-axis color token.")
    yAxis: Optional[str] = Field(default=None, description="Y-axis color token.")
    legend: Optional[str] = Field(default=None, description="Legend color token.")
    dataElements: Optional[str] = Field(
        default=None, description="Data element (bars/lines/slices) color token."
    )


class ChartSpec(BaseModel):
    """The fully-specified, validated chart produced by a modification."""

    id: str = Field(description="Stable chart identifier (preserve on modification).")
    chart_type: ChartType = Field(  # type: ignore[valid-type]
        description="Visualization kind. Must be one of the allowed chart types."
    )
    title: str = Field(description="Chart title.")
    description: str = Field(description="Short chart description.")
    layout: Layout = Field(description="Grid placement and sizing.")
    datasets: List[Dataset] = Field(
        description="One or more data series populated from real computed values."
    )
    config: ChartConfig = Field(default_factory=ChartConfig)
    styling: Optional[ChartStyling] = None


class TableColumn(BaseModel):
    """A single column definition for a table component."""

    id: str = Field(description="Stable column identifier.")
    label: str = Field(description="Human-readable column header.")
    type: str = Field(
        default="text",
        description="Column value type (e.g. text, number, currency, percent).",
    )


class TableStyling(BaseModel):
    """Theme and color token overrides for a table. All fields optional."""

    theme: str = Field(default="default", description="Visual theme identifier.")
    title: Optional[str] = Field(default=None, description="Title color token.")
    description: Optional[str] = Field(
        default=None, description="Description color token."
    )
    headerBackground: Optional[str] = Field(default=None)
    headerText: Optional[str] = Field(default=None)
    rowText: Optional[str] = Field(default=None)


class TableSpec(BaseModel):
    """The fully-specified, validated table produced by a modification."""

    id: str = Field(description="Stable table identifier (preserve on modification).")
    title: str = Field(description="Table title.")
    description: str = Field(default="", description="Short table description.")
    layout: Layout = Field(
        default_factory=Layout, description="Grid placement and sizing."
    )
    columns: List[TableColumn] = Field(
        description="Ordered column definitions for the table."
    )
    data: List[dict] = Field(
        default_factory=list,
        description="Row objects keyed by column id, populated from real values.",
    )
    styling: Optional[TableStyling] = None


class ChangeSummary(BaseModel):
    """Structured description of what changed in this modification.

    Defined now; fully wired to backend/frontend in a later phase.
    """

    change_type: List[
        Literal[
            "chart_type",
            "series_added",
            "series_removed",
            "filter_applied",
            "aggregation_changed",
            "styling",
            "sort",
            "other",
        ]
    ] = Field(description="Categories of change applied.")
    chart_type_from: Optional[str] = Field(
        default=None, description="Previous chart type, if changed."
    )
    chart_type_to: Optional[str] = Field(
        default=None, description="New chart type, if changed."
    )
    series_added: List[str] = Field(default_factory=list)
    series_removed: List[str] = Field(default_factory=list)
    filters_applied: List[str] = Field(default_factory=list)
    human_summary: str = Field(
        description="One or two sentence plain-language summary of the change."
    )


class DataProvenance(BaseModel):
    """Provenance of the data behind the modification.

    Defined now; fully wired to backend/frontend in a later phase.
    """

    python_code: List[str] = Field(
        default_factory=list, description="Python snippets used to compute the values."
    )
    computed_values: dict = Field(
        default_factory=dict, description="Key computed values keyed by name."
    )
    notes: Optional[str] = Field(default=None)


class ChartModificationResult(BaseModel):
    """Top-level structured-output contract for the chart-modification path."""

    chart: ChartSpec
    change_summary: ChangeSummary
    data_provenance: DataProvenance


class TableModificationResult(BaseModel):
    """Top-level structured-output contract for the table-modification path."""

    table: TableSpec
    change_summary: ChangeSummary
    data_provenance: DataProvenance

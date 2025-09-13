"""
Dashboard configuration models for dynamic dashboard generation.
"""

from pydantic import BaseModel, Field, validator
from typing import Dict, List, Any, Optional, Union, Literal
from datetime import datetime
from enum import Enum


class ChartType(str, Enum):
    """Supported chart types."""
    LINE = "line"
    BAR = "bar"
    PIE = "pie"
    AREA = "area"
    SCATTER = "scatter"
    DONUT = "donut"
    COMPOSED = "composed"
    METRIC = "metric"
    TABLE = "table"
    GEOGRAPHIC = "geographic"
    ACTIVITY_FEED = "activity_feed"


class LayoutType(str, Enum):
    """Dashboard layout types."""
    GRID = "grid"
    FLEX = "flex"
    CUSTOM = "custom"


class MetricTrend(str, Enum):
    """Metric trend indicators."""
    UP = "up"
    DOWN = "down"
    STABLE = "stable"


class ChartDataPoint(BaseModel):
    """Individual data point for charts."""
    label: str
    value: Union[float, int, str]
    metadata: Optional[Dict[str, Any]] = None


class ChartDataset(BaseModel):
    """Dataset for chart visualization."""
    label: str
    data: List[ChartDataPoint]
    color: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ChartStyling(BaseModel):
    """Chart styling configuration."""
    preset_theme: str
    color_palette: List[str]
    custom_styling: Optional[Dict[str, Any]] = None
    animation_enabled: bool = True
    grid_visible: bool = True
    legend_position: Literal["top", "bottom", "right", "none"] = "top"


class ChartConfiguration(BaseModel):
    """Configuration for individual chart components."""
    id: str
    type: ChartType
    title: str
    description: Optional[str] = None
    datasets: List[ChartDataset]
    config: Optional[Dict[str, Any]] = None
    layout: Optional[Dict[str, Any]] = None
    styling: Optional[ChartStyling] = None
    metadata: Optional[Dict[str, Any]] = None

    @validator('datasets')
    def validate_datasets(cls, v):
        if not v:
            raise ValueError('At least one dataset is required')
        return v


class MetricConfiguration(BaseModel):
    """Configuration for metric cards."""
    id: str
    title: str
    value: Union[str, float, int]
    change: str
    trend: MetricTrend
    metadata: Optional[Dict[str, Any]] = None


class TableColumn(BaseModel):
    """Table column configuration."""
    key: str
    label: str
    type: Literal["string", "number", "currency", "percentage", "date"]
    width: Optional[str] = None
    align: Literal["left", "center", "right"] = "left"


class TableConfiguration(BaseModel):
    """Configuration for table components."""
    id: str
    title: str
    description: Optional[str] = None
    columns: List[TableColumn]
    data: List[Dict[str, Any]]
    pagination: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None

    @validator('columns')
    def validate_columns(cls, v):
        if not v:
            raise ValueError('At least one column is required')
        return v


class DashboardLayout(BaseModel):
    """Dashboard layout configuration."""
    type: LayoutType
    grid_columns: Optional[int] = 12
    breakpoints: Optional[Dict[str, int]] = None
    spacing: Optional[str] = "normal"
    metadata: Optional[Dict[str, Any]] = None


class DashboardComponent(BaseModel):
    """Individual dashboard component configuration."""
    id: str
    type: Literal["chart", "metric", "table", "custom"]
    position: Dict[str, int]  # x, y, width, height
    component_config: Union[ChartConfiguration, MetricConfiguration, TableConfiguration, Dict[str, Any]]
    metadata: Optional[Dict[str, Any]] = None


class DashboardConfiguration(BaseModel):
    """Complete dashboard configuration."""
    id: str
    title: str
    description: Optional[str] = None
    layout: DashboardLayout
    components: List[DashboardComponent]
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @validator('components')
    def validate_components(cls, v):
        if not v:
            raise ValueError('At least one component is required')
        return v


class DashboardGenerationRequest(BaseModel):
    """Request model for dashboard generation."""
    data_source: str  # File ID or data reference
    requirements: Optional[Dict[str, Any]] = None
    layout_preference: Optional[LayoutType] = LayoutType.GRID
    chart_types: Optional[List[ChartType]] = None
    metadata: Optional[Dict[str, Any]] = None


class DashboardGenerationResponse(BaseModel):
    """Response model for dashboard generation."""
    success: bool
    dashboard_config: Optional[DashboardConfiguration] = None
    processing_time: Optional[float] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class DashboardRefreshRequest(BaseModel):
    """Request model for dashboard refresh."""
    dashboard_id: str
    data_source: Optional[str] = None
    force_refresh: bool = False


class DashboardRefreshResponse(BaseModel):
    """Response model for dashboard refresh."""
    success: bool
    dashboard_config: Optional[DashboardConfiguration] = None
    refresh_time: Optional[datetime] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ChartDataRequest(BaseModel):
    """Request model for chart data."""
    chart_id: str
    filters: Optional[Dict[str, Any]] = None
    aggregation: Optional[str] = None
    time_range: Optional[Dict[str, Any]] = None


class ChartDataResponse(BaseModel):
    """Response model for chart data."""
    success: bool
    data: Optional[List[ChartDataPoint]] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

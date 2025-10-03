"""
Enhanced chart type definitions for data visualization recommendations.
Comprehensive chart type system with validation, categorization, and frontend compatibility.
"""

from typing import Dict, List, Any, Optional, Tuple
from enum import Enum

# Chart type categories
class ChartCategory(Enum):
    BASIC = "basic"
    STATISTICAL = "statistical"
    BUSINESS = "business"
    ADVANCED = "advanced"

# Enhanced chart types with comprehensive metadata
CHART_TYPES = {
    # Basic Charts
    "line_chart": {
        "name": "Line Chart",
        "description": "Show trends over time or continuous data. Best for time series analysis and trend visualization.",
        "category": ChartCategory.BASIC,
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "datetime"]
        },
        "use_cases": [
            "Time series analysis",
            "Trend visualization",
            "Performance tracking over time",
            "Continuous data monitoring"
        ],
        "validation_rules": {
            "requires_time_series": True,
            "supports_multiple_series": True,
            "handles_missing_data": True
        },
        "styling_options": {
            "line_styles": ["solid", "dashed", "dotted"],
            "markers": ["circle", "square", "triangle"],
            "colors": "auto"
        },
        "frontend_mapping": "line"
    },
    
    "bar_chart": {
        "name": "Bar Chart",
        "description": "Compare categorical data with rectangular bars. Good for comparing values across categories.",
        "category": ChartCategory.BASIC,
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Category comparison",
            "Performance metrics by group",
            "Survey results",
            "Sales by region/product"
        ],
        "validation_rules": {
            "requires_categorical_data": True,
            "supports_horizontal_orientation": True,
            "handles_negative_values": True
        },
        "styling_options": {
            "orientation": ["vertical", "horizontal"],
            "bar_spacing": "auto",
            "colors": "auto"
        },
        "frontend_mapping": "bar"
    },
    
    "pie_chart": {
        "name": "Pie Chart",
        "description": "Show parts of a whole as percentages. Best for categorical composition and proportion analysis.",
        "category": ChartCategory.BASIC,
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Market share analysis",
            "Budget allocation",
            "Survey response distribution",
            "Resource utilization"
        ],
        "validation_rules": {
            "max_categories": 10,
            "requires_positive_values": True,
            "suitable_for_proportions": True
        },
        "styling_options": {
            "color_scheme": "auto",
            "label_position": ["inside", "outside"],
            "show_percentages": True
        },
        "frontend_mapping": "pie"
    },
    
    "area_chart": {
        "name": "Area Chart",
        "description": "Show trends over time with filled areas. Good for cumulative data and volume visualization.",
        "category": ChartCategory.BASIC,
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "datetime"]
        },
        "use_cases": [
            "Cumulative data visualization",
            "Volume analysis",
            "Stacked metrics over time",
            "Resource accumulation"
        ],
        "validation_rules": {
            "requires_time_series": True,
            "supports_stacking": True,
            "handles_missing_data": True
        },
        "styling_options": {
            "fill_opacity": 0.6,
            "stacking": ["none", "normal", "percent"],
            "colors": "auto"
        },
        "frontend_mapping": "area"
    },
    
    "scatter_plot": {
        "name": "Scatter Plot",
        "description": "Show relationship between two numerical variables. Best for correlation analysis and pattern detection.",
        "category": ChartCategory.BASIC,
        "data_requirements": {
            "min_data_points": 3,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "numeric"]
        },
        "use_cases": [
            "Correlation analysis",
            "Pattern detection",
            "Outlier identification",
            "Regression analysis"
        ],
        "validation_rules": {
            "requires_numeric_data": True,
            "supports_trend_lines": True,
            "handles_large_datasets": True
        },
        "styling_options": {
            "point_size": "auto",
            "point_shape": ["circle", "square", "triangle"],
            "trend_line": True
        },
        "frontend_mapping": "scatter"
    },
    
    # Statistical Charts
    "histogram": {
        "name": "Histogram",
        "description": "Show distribution of numerical data. Best for understanding data frequency and distribution patterns.",
        "category": ChartCategory.STATISTICAL,
        "data_requirements": {
            "min_data_points": 5,
            "required_columns": ["value"],
            "data_types": ["numeric"]
        },
        "use_cases": [
            "Data distribution analysis",
            "Frequency analysis",
            "Statistical modeling",
            "Quality control"
        ],
        "validation_rules": {
            "requires_numeric_data": True,
            "auto_binning": True,
            "handles_outliers": True
        },
        "styling_options": {
            "bin_count": "auto",
            "bin_width": "auto",
            "normalization": ["count", "density", "percent"]
        },
        "frontend_mapping": "histogram"
    },
    
    "box_plot": {
        "name": "Box Plot", 
        "description": "Show statistical summary (median, quartiles, outliers) of numerical data. Best for distribution comparison.",
        "category": ChartCategory.STATISTICAL,
        "data_requirements": {
            "min_data_points": 5,
            "required_columns": ["value", "group"],
            "data_types": ["numeric", "categorical"]
        },
        "use_cases": [
            "Distribution comparison",
            "Outlier detection",
            "Statistical analysis",
            "Quality assessment"
        ],
        "validation_rules": {
            "requires_numeric_data": True,
            "supports_grouping": True,
            "shows_outliers": True
        },
        "styling_options": {
            "box_width": "auto",
            "outlier_detection": True,
            "notch_display": False
        },
        "frontend_mapping": "box_plot"
    },
    
    "heatmap": {
        "name": "Heatmap",
        "description": "Show correlation or intensity between variables using color mapping. Best for pattern recognition and correlation analysis.",
        "category": ChartCategory.STATISTICAL,
        "data_requirements": {
            "min_data_points": 4,
            "required_columns": ["x", "y", "value"],
            "data_types": ["categorical", "categorical", "numeric"]
        },
        "use_cases": [
            "Correlation matrix",
            "Performance heatmaps",
            "Geographic data",
            "Time-based patterns"
        ],
        "validation_rules": {
            "requires_matrix_data": True,
            "color_scale_required": True,
            "supports_annotations": True
        },
        "styling_options": {
            "color_scheme": ["viridis", "plasma", "inferno", "magma"],
            "cell_size": "auto",
            "annotations": True
        },
        "frontend_mapping": "heatmap"
    },
    
    # Business Intelligence Charts
    "metric": {
        "name": "Metric Card",
        "description": "Display key performance indicators and metrics with trend indicators. Best for executive dashboards and KPI tracking.",
        "category": ChartCategory.BUSINESS,
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["value"],
            "data_types": ["numeric"]
        },
        "use_cases": [
            "KPI dashboards",
            "Executive summaries",
            "Performance tracking",
            "Goal monitoring"
        ],
        "validation_rules": {
            "requires_single_value": True,
            "supports_trend_indicators": True,
            "handles_percentages": True
        },
        "styling_options": {
            "trend_indicators": ["up", "down", "stable"],
            "color_coding": True,
            "formatting": ["number", "currency", "percentage"]
        },
        "frontend_mapping": "metric"
    },
    
    "table": {
        "name": "Data Table",
        "description": "Display structured data in tabular format with sorting and filtering. Best for detailed data analysis and reporting.",
        "category": ChartCategory.BUSINESS,
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": [],
            "data_types": ["any"]
        },
        "use_cases": [
            "Detailed data analysis",
            "Financial reports",
            "Inventory management",
            "Customer records"
        ],
        "validation_rules": {
            "supports_sorting": True,
            "supports_filtering": True,
            "handles_pagination": True
        },
        "styling_options": {
            "row_striping": True,
            "column_sorting": True,
            "cell_formatting": "auto"
        },
        "frontend_mapping": "table"
    },
    
    "activity_feed": {
        "name": "Activity Feed",
        "description": "Display chronological events and activities. Best for timeline visualization and audit trails.",
        "category": ChartCategory.BUSINESS,
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["timestamp", "activity"],
            "data_types": ["datetime", "text"]
        },
        "use_cases": [
            "Audit trails",
            "User activity tracking",
            "System logs",
            "Project timelines"
        ],
        "validation_rules": {
            "requires_timestamp": True,
            "supports_grouping": True,
            "handles_high_frequency": True
        },
        "styling_options": {
            "timeline_style": ["vertical", "horizontal"],
            "group_by": ["day", "hour", "user"],
            "color_coding": True
        },
        "frontend_mapping": "activity_feed"
    },
    
    # Advanced Charts
    "geographic": {
        "name": "Geographic Chart",
        "description": "Display data on maps and geographic visualizations. Best for location-based analysis and geographic patterns.",
        "category": ChartCategory.ADVANCED,
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["latitude", "longitude"],
            "data_types": ["numeric", "numeric"]
        },
        "use_cases": [
            "Location analysis",
            "Geographic distribution",
            "Regional performance",
            "Supply chain visualization"
        ],
        "validation_rules": {
            "requires_coordinates": True,
            "supports_zoom_levels": True,
            "handles_clustering": True
        },
        "styling_options": {
            "map_style": ["light", "dark", "satellite"],
            "marker_size": "auto",
            "color_intensity": True
        },
        "frontend_mapping": "geographic"
    },
    
    "composed": {
        "name": "Composed Chart",
        "description": "Combine multiple chart types in a single visualization. Best for complex data relationships and multi-metric analysis.",
        "category": ChartCategory.ADVANCED,
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y1", "y2"],
            "data_types": ["numeric", "numeric", "numeric"]
        },
        "use_cases": [
            "Multi-metric analysis",
            "Complex relationships",
            "Comparative analysis",
            "Advanced reporting"
        ],
        "validation_rules": {
            "supports_multiple_series": True,
            "requires_dual_axis": True,
            "handles_different_scales": True
        },
        "styling_options": {
            "chart_combination": ["line+bar", "area+line", "bar+scatter"],
            "dual_axis": True,
            "legend_position": ["top", "bottom", "right"]
        },
        "frontend_mapping": "composed"
    },
    
    "donut": {
        "name": "Donut Chart",
        "description": "Enhanced pie chart with center space for additional information. Best for proportion analysis with center metrics.",
        "category": ChartCategory.ADVANCED,
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Proportion analysis with totals",
            "Budget allocation with center KPI",
            "Market share with center metric",
            "Resource distribution with summary"
        ],
        "validation_rules": {
            "max_categories": 8,
            "requires_positive_values": True,
            "supports_center_metrics": True
        },
        "styling_options": {
            "inner_radius": 0.5,
            "center_content": True,
            "color_scheme": "auto"
        },
        "frontend_mapping": "donut"
    }
}

# Chart type categories mapping
CHART_CATEGORIES = {
    ChartCategory.BASIC: ["line_chart", "bar_chart", "pie_chart", "area_chart", "scatter_plot"],
    ChartCategory.STATISTICAL: ["histogram", "box_plot", "heatmap"],
    ChartCategory.BUSINESS: ["metric", "table", "activity_feed"],
    ChartCategory.ADVANCED: ["geographic", "composed", "donut"]
}

def get_chart_types() -> Dict[str, Any]:
    """Get all available chart types with their metadata."""
    return CHART_TYPES

def get_chart_categories() -> Dict[ChartCategory, List[str]]:
    """Get chart types organized by category."""
    return CHART_CATEGORIES

def get_chart_by_category(category: ChartCategory) -> List[str]:
    """Get chart types for a specific category."""
    return CHART_CATEGORIES.get(category, [])

def is_chart_type_supported(chart_type: str) -> bool:
    """Check if a chart type is supported."""
    return chart_type in CHART_TYPES

def get_chart_metadata(chart_type: str) -> Optional[Dict[str, Any]]:
    """Get metadata for a specific chart type."""
    return CHART_TYPES.get(chart_type)

def validate_chart_data(chart_type: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Validate data against chart type requirements."""
    if not is_chart_type_supported(chart_type):
        return False, [f"Unsupported chart type: {chart_type}"]
    
    metadata = get_chart_metadata(chart_type)
    if not metadata:
        return False, [f"No metadata found for chart type: {chart_type}"]
    
    errors = []
    requirements = metadata.get("data_requirements", {})
    
    # Check minimum data points
    min_points = requirements.get("min_data_points", 1)
    if len(data.get("data", [])) < min_points:
        errors.append(f"Minimum {min_points} data points required")
    
    # Check required columns
    required_columns = requirements.get("required_columns", [])
    data_columns = list(data.get("columns", {}).keys())
    for col in required_columns:
        if col not in data_columns:
            errors.append(f"Required column '{col}' not found")
    
    return len(errors) == 0, errors

def get_chart_recommendations(data_characteristics: Dict[str, Any]) -> List[str]:
    """Get recommended chart types based on data characteristics."""
    recommendations = []
    
    # Time series data
    if data_characteristics.get("has_time_series"):
        recommendations.extend(["line_chart", "area_chart"])
    
    # Categorical data
    if data_characteristics.get("has_categorical_data"):
        recommendations.extend(["bar_chart", "pie_chart", "donut"])
    
    # Numerical data
    if data_characteristics.get("has_numerical_data"):
        recommendations.extend(["histogram", "box_plot", "scatter_plot"])
    
    # Geographic data
    if data_characteristics.get("has_geographic_data"):
        recommendations.append("geographic")
    
    # Single metric
    if data_characteristics.get("is_single_metric"):
        recommendations.append("metric")
    
    # Tabular data
    if data_characteristics.get("is_tabular"):
        recommendations.append("table")
    
    # Activity/timeline data
    if data_characteristics.get("has_timestamps"):
        recommendations.append("activity_feed")
    
    return list(set(recommendations))  # Remove duplicates

def get_frontend_mapping(chart_type: str) -> Optional[str]:
    """Get the corresponding frontend chart type."""
    metadata = get_chart_metadata(chart_type)
    return metadata.get("frontend_mapping") if metadata else None

def get_chart_use_cases(chart_type: str) -> List[str]:
    """Get use cases for a specific chart type."""
    metadata = get_chart_metadata(chart_type)
    return metadata.get("use_cases", []) if metadata else []

def get_chart_styling_options(chart_type: str) -> Dict[str, Any]:
    """Get styling options for a specific chart type."""
    metadata = get_chart_metadata(chart_type)
    return metadata.get("styling_options", {}) if metadata else {}
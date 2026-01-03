"""
Simple chart type definitions for data visualization recommendations.
Optimized for LLM processing with essential information only.
"""

from typing import Dict, List, Any, Optional

# Chart types matching frontend ChartFactory.tsx exactly
CHART_TYPES = {
    "line": {
        "name": "Line Chart",
        "description": "Show trends over time or continuous data. Best for time series analysis and trend visualization.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "datetime"]
        },
        "use_cases": [
            "Time series analysis",
            "Trend visualization", 
            "Performance tracking over time"
        ]
    },
    "bar": {
        "name": "Bar Chart",
        "description": "Compare categorical data with rectangular bars. Good for comparing values across categories.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Category comparison",
            "Performance metrics by group",
            "Sales by region/product"
        ]
    },
    "pie": {
        "name": "Pie Chart", 
        "description": "Show parts of a whole as percentages. Best for categorical composition and proportion analysis.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Market share analysis",
            "Budget allocation",
            "Survey response distribution"
        ]
    },
    "area": {
        "name": "Area Chart",
        "description": "Show trends over time with filled areas. Good for cumulative data and volume visualization.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "datetime"]
        },
        "use_cases": [
            "Cumulative data visualization",
            "Volume analysis",
            "Stacked metrics over time"
        ]
    },
    "scatter": {
        "name": "Scatter Plot",
        "description": "Show relationship between two numerical variables. Best for correlation analysis and pattern detection.",
        "data_requirements": {
            "min_data_points": 3,
            "required_columns": ["x", "y"],
            "data_types": ["numeric", "numeric"]
        },
        "use_cases": [
            "Correlation analysis",
            "Pattern detection",
            "Outlier identification"
        ]
    },
    "donut": {
        "name": "Donut Chart",
        "description": "Enhanced pie chart with center space for additional information. Best for proportion analysis with center metrics.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Proportion analysis with totals",
            "Budget allocation with center KPI",
            "Market share with center metric"
        ]
    },
    "composed": {
        "name": "Composed Chart",
        "description": "Combine multiple chart types in a single visualization. Best for complex data relationships and multi-metric analysis.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["x", "y1", "y2"],
            "data_types": ["numeric", "numeric", "numeric"]
        },
        "use_cases": [
            "Multi-metric analysis",
            "Complex relationships",
            "Comparative analysis"
        ]
    },
    "radar": {
        "name": "Radar Chart",
        "description": "Display multivariate data in a two-dimensional chart. Best for comparing multiple variables across categories.",
        "data_requirements": {
            "min_data_points": 3,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Performance comparison",
            "Multi-dimensional analysis",
            "Skill assessment"
        ]
    },
    "radial_bar": {
        "name": "Radial Bar Chart",
        "description": "Circular bar chart showing data in a radial layout. Best for displaying progress and completion metrics.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Progress tracking",
            "Completion metrics",
            "Circular data visualization"
        ]
    },
    "funnel": {
        "name": "Funnel Chart",
        "description": "Show stages in a process with decreasing values. Best for conversion analysis and process visualization.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["stage", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Sales funnel analysis",
            "Conversion tracking",
            "Process optimization"
        ]
    },
    "treemap": {
        "name": "Treemap Chart",
        "description": "Display hierarchical data as nested rectangles. Best for showing proportions within categories.",
        "data_requirements": {
            "min_data_points": 2,
            "required_columns": ["category", "value"],
            "data_types": ["categorical", "numeric"]
        },
        "use_cases": [
            "Hierarchical data visualization",
            "Proportion analysis",
            "Category breakdown"
        ]
    },
    "sankey": {
        "name": "Sankey Chart",
        "description": "Show flow between different entities. Best for visualizing energy, material, or cost flows.",
        "data_requirements": {
            "min_data_points": 3,
            "required_columns": ["source", "target", "value"],
            "data_types": ["categorical", "categorical", "numeric"]
        },
        "use_cases": [
            "Flow analysis",
            "Energy flow visualization",
            "Process flow mapping"
        ]
    },
    "metric": {
        "name": "Metric Card",
        "description": "Display key performance indicators and metrics with trend indicators. Best for executive dashboards and KPI tracking.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["value"],
            "data_types": ["numeric"]
        },
        "use_cases": [
            "KPI dashboards",
            "Executive summaries",
            "Performance tracking"
        ]
    },
    "table": {
        "name": "Data Table",
        "description": "Display structured data in tabular format with sorting and filtering. Best for detailed data analysis and reporting.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": [],
            "data_types": ["any"]
        },
        "use_cases": [
            "Detailed data analysis",
            "Financial reports",
            "Customer records"
        ]
    },
    # "geographic": {
    #     "name": "Geographic Chart",
    #     "description": "Display data on maps and geographic visualizations. Best for location-based analysis and geographic patterns.",
    #     "data_requirements": {
    #         "min_data_points": 1,
    #         "required_columns": ["latitude", "longitude"],
    #         "data_types": ["numeric", "numeric"]
    #     },
    #     "use_cases": [
    #         "Location analysis",
    #         "Geographic distribution",
    #         "Regional performance"
    #     ]
    # },
}

# Layout defaults per visualization kind for LLM output generation.
# Intentionally only specify minimum height floors; minW remains flexible.
# These values are in grid units assuming a 24-column grid system.
LAYOUT_DEFAULTS: Dict[str, Dict[str, int]] = {
    # Charts with heavier legends/axes or radial layouts benefit from taller floors
    "line": {"minH": 12},
    "area": {"minH": 12},
    "pie": {"minH": 12},
    "donut": {"minH": 12},
    "radial_bar": {"minH": 12},
    "treemap": {"minH": 12},
    "sankey": {"minH": 12},

    # Other charts render well at a 10-row minimum
    "bar": {"minH": 10},
    "scatter": {"minH": 10},
    "composed": {"minH": 10},
    "radar": {"minH": 10},
    "funnel": {"minH": 10},
    "geographic": {"minH": 10},

    # Non-chart components for reference
    "table": {"minH": 10},
    "metric": {"minH": 4},
}

def get_chart_types() -> Dict[str, Any]:
    """Get all available chart types with their metadata."""
    return CHART_TYPES

def is_chart_type_supported(chart_type: str) -> bool:
    """Check if a chart type is supported."""
    return chart_type in CHART_TYPES

def get_chart_metadata(chart_type: str) -> Optional[Dict[str, Any]]:
    """Get metadata for a specific chart type."""
    return CHART_TYPES.get(chart_type)


def get_layout_defaults(chart_type: str) -> Dict[str, int]:
    """Return layout default constraints for a chart/component type.

    Currently exposes only minimum height (minH). If a type is unknown,
    returns a safe default of {"minH": 10} suitable for most charts.
    """
    return LAYOUT_DEFAULTS.get(chart_type, {"minH": 10})


def get_min_height(chart_type: str) -> int:
    """Convenience helper to fetch the minH floor for a given type."""
    defaults = get_layout_defaults(chart_type)
    try:
        return int(defaults.get("minH", 10))
    except Exception:
        return 10
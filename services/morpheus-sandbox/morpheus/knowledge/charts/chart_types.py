"""
Simple chart type definitions for data visualization recommendations.
Optimized for LLM processing with essential information only.
"""

from typing import Dict, List, Any, Optional

# Simplified chart types with essential metadata only
CHART_TYPES = {
    # Basic Charts
    "line_chart": {
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
    
    "bar_chart": {
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
    
    "pie_chart": {
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
    
    "area_chart": {
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
    
    "scatter_plot": {
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
    
    "histogram": {
        "name": "Histogram",
        "description": "Show distribution of numerical data. Best for understanding data frequency and distribution patterns.",
        "data_requirements": {
            "min_data_points": 5,
            "required_columns": ["value"],
            "data_types": ["numeric"]
        },
        "use_cases": [
            "Data distribution analysis",
            "Frequency analysis",
            "Statistical modeling"
        ]
    },
    
    "box_plot": {
        "name": "Box Plot", 
        "description": "Show statistical summary (median, quartiles, outliers) of numerical data. Best for distribution comparison.",
        "data_requirements": {
            "min_data_points": 5,
            "required_columns": ["value", "group"],
            "data_types": ["numeric", "categorical"]
        },
        "use_cases": [
            "Distribution comparison",
            "Outlier detection",
            "Statistical analysis"
        ]
    },
    
    "heatmap": {
        "name": "Heatmap",
        "description": "Show correlation or intensity between variables using color mapping. Best for pattern recognition and correlation analysis.",
        "data_requirements": {
            "min_data_points": 4,
            "required_columns": ["x", "y", "value"],
            "data_types": ["categorical", "categorical", "numeric"]
        },
        "use_cases": [
            "Correlation matrix",
            "Performance heatmaps",
            "Time-based patterns"
        ]
    },
    
    # Business Charts
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
    
    "activity_feed": {
        "name": "Activity Feed",
        "description": "Display chronological events and activities. Best for timeline visualization and audit trails.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["timestamp", "activity"],
            "data_types": ["datetime", "text"]
        },
        "use_cases": [
            "Audit trails",
            "User activity tracking",
            "System logs"
        ]
    },
    
    # Advanced Charts
    "geographic": {
        "name": "Geographic Chart",
        "description": "Display data on maps and geographic visualizations. Best for location-based analysis and geographic patterns.",
        "data_requirements": {
            "min_data_points": 1,
            "required_columns": ["latitude", "longitude"],
            "data_types": ["numeric", "numeric"]
        },
        "use_cases": [
            "Location analysis",
            "Geographic distribution",
            "Regional performance"
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
    }
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
"""
Simple chart type definitions for data visualization recommendations.
"""

CHART_TYPES = {
    "bar_chart": {
        "name": "Bar Chart",
        "description": "Compare categorical data with rectangular bars. Good for comparing values across categories."
    },
    "line_chart": {
        "name": "Line Chart", 
        "description": "Show trends over time or continuous data. Best for time series analysis."
    },
    "scatter_plot": {
        "name": "Scatter Plot",
        "description": "Show relationship between two numerical variables. Best for correlation analysis."
    },
    "pie_chart": {
        "name": "Pie Chart",
        "description": "Show parts of a whole as percentages. Best for categorical composition."
    },
    "histogram": {
        "name": "Histogram",
        "description": "Show distribution of numerical data. Best for understanding data frequency."
    },
    "box_plot": {
        "name": "Box Plot", 
        "description": "Show statistical summary (median, quartiles, outliers) of numerical data."
    },
    "heatmap": {
        "name": "Heatmap",
        "description": "Show correlation or intensity between variables using color mapping."
    },
    "area_chart": {
        "name": "Area Chart",
        "description": "Show trends over time with filled areas. Good for cumulative data."
    }
}
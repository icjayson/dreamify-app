"""
Simple chart knowledge tool that returns available chart types.
"""

from langchain_core.tools import tool
from morpheus.knowledge.charts.chart_types import CHART_TYPES

@tool
def get_available_chart_types() -> str:
    """
    Get a list of all available chart types with their basic information.
    Use this tool to understand what chart types are available for data visualization.
    """
    chart_list = []
    
    for chart_id, info in CHART_TYPES.items():
        chart_desc = f"- {chart_id}: {info['name']} - {info['description']}"
        chart_list.append(chart_desc)
    
    result = "AVAILABLE CHART TYPES:\n\n" + "\n".join(chart_list)
    result += "\n\nUse these chart types in your recommendations based on the data analysis."
    
    return result
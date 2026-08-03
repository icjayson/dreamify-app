from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    file_path: str
    prompt: Optional[str] = "Please analyze this CSV file and recommend appropriate chart types for visualization."

class ChartRecommendation(BaseModel):
    chart_type: str
    title: Optional[str] = None
    columns: List[str]
    x_axis: Optional[str] = None
    y_axis: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    metadata: Dict[str, Any] = {}
    confidence: float
    reasoning: str

class DataMetric(BaseModel):
    name: str
    value: Any
    type: str  # e.g., "sum", "average", "count", "categorical"
    description: str

class DataInsight(BaseModel):
    column: str
    insight_type: str  # e.g., "data_type", "missing_values", "statistics", "unique_values"
    value: Any
    description: str

class AnalyzeResponse(BaseModel):
    status: str
    file_path: str
    chart_recommendations: List[ChartRecommendation]
    metrics: List[DataMetric]
    insights: List[DataInsight]
    messages_saved_to: str
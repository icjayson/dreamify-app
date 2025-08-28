"""
Response models for API endpoints
"""
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from datetime import datetime


class BaseResponse(BaseModel):
    """Base response model"""
    success: bool
    message: str
    timestamp: datetime = Field(default_factory=datetime.now)


class ErrorResponse(BaseResponse):
    """Error response model"""
    success: bool = False
    error_code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class SuccessResponse(BaseResponse):
    """Success response model"""
    success: bool = True
    data: Optional[Dict[str, Any]] = None


class FileUploadResponse(BaseResponse):
    """File upload response model"""
    success: bool = True
    data: Dict[str, Any] = Field(
        description="File upload information",
        example={
            "filename": "data.csv",
            "records": 1000,
            "columns": ["id", "name", "value"],
            "size": 1024000
        }
    )


class AnalyticsSummaryResponse(BaseResponse):
    """Analytics summary response model"""
    success: bool = True
    data: Dict[str, Any] = Field(
        description="Analytics summary data",
        example={
            "totalRecords": 1000,
            "totalRevenue": 50000.0,
            "averageOrderValue": 50.0,
            "topProduct": "Product A",
            "topCategory": "Electronics"
        }
    )


class ChartDataResponse(BaseResponse):
    """Chart data response model"""
    success: bool = True
    data: List[Dict[str, Any]] = Field(
        description="Chart data array",
        example=[
            {
                "type": "line",
                "title": "Revenue Over Time",
                "data": [{"date": "2023-01", "revenue": 1000}],
                "config": {"color": "#3b82f6"}
            }
        ]
    )


class HealthCheckResponse(BaseResponse):
    """Health check response model"""
    success: bool = True
    data: Dict[str, Any] = Field(
        description="Health check information",
        example={
            "status": "healthy",
            "version": "1.0.0",
            "uptime": 3600.5,
            "database": "connected",
            "services": ["analytics", "file_processing"]
        }
    )


class ValidationErrorResponse(BaseResponse):
    """Validation error response model"""
    success: bool = False
    error_code: str = "VALIDATION_ERROR"
    details: Dict[str, List[str]] = Field(
        description="Validation error details",
        example={
            "field_name": ["This field is required", "Invalid format"]
        }
    )


class FileProcessingResponse(BaseResponse):
    """File processing response model"""
    success: bool = True
    data: Dict[str, Any] = Field(
        description="File processing status",
        example={
            "job_id": "job_123",
            "status": "processing",
            "progress": 75.0,
            "estimated_completion": "2023-12-01T10:30:00Z"
        }
    )


class AnalyticsDataResponse(BaseResponse):
    """Complete analytics data response model"""
    success: bool = True
    data: Dict[str, Any] = Field(
        description="Complete analytics data",
        example={
            "summary": {
                "totalRecords": 1000,
                "totalRevenue": 50000.0,
                "averageOrderValue": 50.0,
                "topProduct": "Product A",
                "topCategory": "Electronics"
            },
            "charts": [
                {
                    "type": "line",
                    "title": "Revenue Over Time",
                    "data": [{"date": "2023-01", "revenue": 1000}]
                }
            ],
            "metrics": [
                {
                    "label": "Total Revenue",
                    "value": 50000.0,
                    "change": 12.5,
                    "trend": "up"
                }
            ]
        }
    )


# Generic response types
ApiResponse = Union[
    SuccessResponse,
    ErrorResponse,
    FileUploadResponse,
    AnalyticsSummaryResponse,
    ChartDataResponse,
    HealthCheckResponse,
    ValidationErrorResponse,
    FileProcessingResponse,
    AnalyticsDataResponse
]

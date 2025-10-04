"""
Data models for the application
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, JSON
from sqlalchemy.sql import func
from config.database import Base


class FileUpload(Base):
    """File upload model"""
    __tablename__ = "file_uploads"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=False)
    file_type = Column(String(50), nullable=False)
    upload_date = Column(DateTime(timezone=True), server_default=func.now())
    processed = Column(String(10), default="pending")  # pending, processing, completed, failed
    columns = Column(JSON)  # Store column information
    row_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    
    def __repr__(self):
        return f"<FileUpload(id={self.id}, filename='{self.filename}', processed='{self.processed}')>"


class AnalyticsResult(Base):
    """Analytics result model"""
    __tablename__ = "analytics_results"
    
    id = Column(Integer, primary_key=True, index=True)
    file_upload_id = Column(Integer, nullable=False)
    analysis_type = Column(String(100), nullable=False)  # summary, charts, metrics
    result_data = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processing_time = Column(Float, nullable=True)  # Processing time in seconds
    
    def __repr__(self):
        return f"<AnalyticsResult(id={self.id}, type='{self.analysis_type}', file_id={self.file_upload_id})>"


class DataProcessingJob(Base):
    """Data processing job model"""
    __tablename__ = "data_processing_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    file_upload_id = Column(Integer, nullable=False)
    job_type = Column(String(100), nullable=False)  # upload, process, analyze
    status = Column(String(20), default="pending")  # pending, running, completed, failed
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    progress = Column(Float, default=0.0)  # Progress percentage
    
    def __repr__(self):
        return f"<DataProcessingJob(id={self.id}, type='{self.job_type}', status='{self.status}')>"


# Pydantic models for API responses
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class FileUploadResponse(BaseModel):
    """File upload response model"""
    id: int
    filename: str
    original_filename: str
    file_size: int
    file_type: str
    upload_date: datetime
    processed: str
    columns: Optional[List[str]] = None
    row_count: int = 0
    error_message: Optional[str] = None
    
    class Config:
        from_attributes = True


class AnalyticsResultResponse(BaseModel):
    """Analytics result response model"""
    id: int
    file_upload_id: int
    analysis_type: str
    result_data: Dict[str, Any]
    created_at: datetime
    processing_time: Optional[float] = None
    
    class Config:
        from_attributes = True


class DataProcessingJobResponse(BaseModel):
    """Data processing job response model"""
    id: int
    file_upload_id: int
    job_type: str
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    progress: float = 0.0
    
    class Config:
        from_attributes = True


class AnalyticsSummaryResponse(BaseModel):
    """Analytics summary response model"""
    total_records: int
    total_revenue: float
    average_order_value: float
    top_product: str
    top_category: str
    processing_time: Optional[float] = None


class ChartDataResponse(BaseModel):
    """Chart data response model"""
    type: str  # line, bar, pie, area
    title: str
    data: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]] = None


class MetricDataResponse(BaseModel):
    """Metric data response model"""
    label: str
    value: float
    change: float
    trend: str  # up, down, stable


class HealthCheckResponse(BaseModel):
    """Health check response model"""
    status: str
    timestamp: datetime
    version: str
    uptime: Optional[float] = None

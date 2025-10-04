"""
Logging configuration
"""
import logging
import logging.handlers
import os
from typing import Optional
from config.settings import get_settings

settings = get_settings()


def setup_logging(
    log_level: Optional[str] = None,
    log_file: Optional[str] = None,
    log_format: Optional[str] = None
) -> None:
    """
    Setup application logging
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Log file path
        log_format: Log format string
    """
    # Use settings if not provided
    log_level = log_level or settings.LOG_LEVEL
    log_file = log_file or settings.LOG_FILE
    log_format = log_format or "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # Convert string to logging level
    level = getattr(logging, log_level.upper(), logging.INFO)
    
    # Create formatter
    formatter = logging.Formatter(log_format)
    
    # Setup root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # File handler (if log file is specified)
    if log_file:
        # Ensure log directory exists
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        
        # Create rotating file handler
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    
    # Set specific logger levels
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("requests").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance
    
    Args:
        name: Logger name
        
    Returns:
        Logger instance
    """
    return logging.getLogger(name)


# Application logger
app_logger = get_logger("animato_data")


def log_request(request, response=None, error=None):
    """
    Log HTTP request/response
    
    Args:
        request: Flask request object
        response: Flask response object
        error: Exception if any
    """
    log_data = {
        "method": request.method,
        "url": request.url,
        "remote_addr": request.remote_addr,
        "user_agent": request.headers.get("User-Agent", ""),
    }
    
    if response:
        log_data["status_code"] = response.status_code
        log_data["content_length"] = response.content_length
    
    if error:
        log_data["error"] = str(error)
        app_logger.error("Request failed", extra=log_data)
    else:
        app_logger.info("Request processed", extra=log_data)


def log_analytics(operation: str, data: dict, duration: float = None):
    """
    Log analytics operations
    
    Args:
        operation: Operation name
        data: Operation data
        duration: Operation duration in seconds
    """
    log_data = {
        "operation": operation,
        "data": data,
    }
    
    if duration is not None:
        log_data["duration"] = duration
    
    app_logger.info("Analytics operation", extra=log_data)


def log_file_upload(filename: str, file_size: int, success: bool, error: str = None):
    """
    Log file upload operations
    
    Args:
        filename: Uploaded file name
        file_size: File size in bytes
        success: Whether upload was successful
        error: Error message if upload failed
    """
    log_data = {
        "filename": filename,
        "file_size": file_size,
        "success": success,
    }
    
    if error:
        log_data["error"] = error
        app_logger.error("File upload failed", extra=log_data)
    else:
        app_logger.info("File upload successful", extra=log_data)

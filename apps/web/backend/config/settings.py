"""
Application settings configuration
"""
import os
from typing import List, Optional
from dataclasses import dataclass


@dataclass
class Settings:
    """Application settings"""
    
    # Application
    APP_NAME: str = "Animato Data Analytics"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "dev-secret-key")
    
    # Server
    HOST: str = os.getenv("FLASK_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("FLASK_PORT", "5000"))
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///animato_data.db")
    DATABASE_TEST_URL: str = os.getenv("DATABASE_TEST_URL", "sqlite:///test_animato_data.db")
    
    # File Upload
    MAX_FILE_SIZE: int = int(os.getenv("MAX_FILE_SIZE", "10485760"))  # 10MB
    UPLOAD_FOLDER: str = os.getenv("UPLOAD_FOLDER", "uploads")
    ALLOWED_EXTENSIONS: List[str] = os.getenv("ALLOWED_EXTENSIONS", "csv,xlsx,xls").split(",")
    
    # CORS
    CORS_ORIGINS: List[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    
    # API
    API_VERSION: str = os.getenv("API_VERSION", "v1")
    API_PREFIX: str = os.getenv("API_PREFIX", "/api")
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE: str = os.getenv("LOG_FILE", "logs/app.log")
    
    # Security
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "jwt-secret-key")
    JWT_ACCESS_TOKEN_EXPIRES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "3600"))
    JWT_REFRESH_TOKEN_EXPIRES: int = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRES", "86400"))
    
    # External Services
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    GOOGLE_ANALYTICS_ID: Optional[str] = os.getenv("GOOGLE_ANALYTICS_ID")
    
    def __post_init__(self):
        """Validate settings after initialization"""
        self._validate_settings()
    
    def _validate_settings(self):
        """Validate required settings"""
        if not self.SECRET_KEY or self.SECRET_KEY == "dev-secret-key":
            print("Warning: Using default secret key. Set FLASK_SECRET_KEY for production.")
        
        if not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY == "jwt-secret-key":
            print("Warning: Using default JWT secret key. Set JWT_SECRET_KEY for production.")
        
        # Ensure upload folder exists
        os.makedirs(self.UPLOAD_FOLDER, exist_ok=True)
        
        # Ensure logs directory exists
        log_dir = os.path.dirname(self.LOG_FILE)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)


# Create settings instance
settings = Settings()


def get_settings() -> Settings:
    """Get application settings"""
    return settings

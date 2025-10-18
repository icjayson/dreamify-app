"""
Application settings and configuration.
"""

import os
from typing import Dict, Any

class Settings:
    """Application settings."""
    
    def __init__(self):
        """Initialize settings."""
        self.secret_key = os.getenv('SECRET_KEY', 'dev-secret-key')
        self.debug = os.getenv('DEBUG', 'True').lower() == 'true'
        self.port = int(os.getenv('PORT', 5000))
        
        # Database settings
        self.database_url = os.getenv('DATABASE_URL', 'sqlite:///app.db')
        
        # API settings
        self.api_version = os.getenv('API_VERSION', 'v1')
        self.cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:8080,http://localhost:3000').split(',')
        
        # File upload settings
        self.max_file_size = int(os.getenv('MAX_FILE_SIZE', 52428800))  # 50MB
        self.upload_folder = os.getenv('UPLOAD_FOLDER', 'uploads')
        
        # Logging settings
        self.log_level = os.getenv('LOG_LEVEL', 'INFO')
        self.log_file = os.getenv('LOG_FILE', 'logs/app.log')
        
        # Security settings
        self.jwt_secret_key = os.getenv('JWT_SECRET_KEY', 'dev-jwt-secret')
        self.jwt_access_token_expires = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 3600))

# Create global settings instance
settings = Settings()

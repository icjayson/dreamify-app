"""
Database configuration and session management.
"""
from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
import os

try:
    from utils.config import config
except ImportError:
    # Fallback for different import contexts
    import sys
    from pathlib import Path
    project_root = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(project_root))
    from utils.config import config

# Build database URL from config
database_url = (
    f"postgresql+psycopg2://"
    f"{config.aws.database.POSTGRES_USERNAME}:"
    f"{config.aws.database.POSTGRES_PASSWORD}@"
    f"{config.aws.database.POSTGRES_HOST}:"
    f"{config.aws.database.POSTGRES_PORT}/"
    f"{config.aws.database.POSTGRES_DATABASE}"
)

# Database engine
engine = create_engine(
    database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

# Metadata
metadata = MetaData()


def get_db() -> Generator[Session, None, None]:
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


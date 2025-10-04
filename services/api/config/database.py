"""
Database configuration
"""
from typing import Optional
from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from config.settings import get_settings

settings = get_settings()

# Database engine
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_recycle=300,
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

# Metadata
metadata = MetaData()


def get_db() -> Session:
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database"""
    # Import all models here to ensure they are registered
    from app.models import data_models, response_models
    
    # Create all tables
    Base.metadata.create_all(bind=engine)


def get_test_db() -> Session:
    """Get test database session"""
    test_engine = create_engine(
        settings.DATABASE_TEST_URL,
        echo=False,
    )
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_test_db():
    """Initialize test database"""
    test_engine = create_engine(
        settings.DATABASE_TEST_URL,
        echo=False,
    )
    
    # Import all models here to ensure they are registered
    from app.models import data_models, response_models
    
    # Create all tables
    Base.metadata.create_all(bind=test_engine)
    
    return test_engine

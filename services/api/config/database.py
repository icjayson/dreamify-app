"""
Database configuration (legacy - use utils/postgres/db.py instead).
This module is kept for backward compatibility but delegates to the new system.
"""
from utils.postgres.db import (
    engine,
    SessionLocal,
    Base,
    metadata,
    get_db
)

# Legacy functions for backward compatibility
def init_db():
    """Initialize database (legacy - use make_database.py instead)"""
    from utils.postgres.models import Base as ModelsBase
    ModelsBase.metadata.create_all(bind=engine)


def get_test_db():
    """Get test database session (legacy)"""
    # For test, use the same database connection
    # In production, you might want separate test database
    return get_db()


def init_test_db():
    """Initialize test database (legacy)"""
    from utils.postgres.models import Base as ModelsBase
    ModelsBase.metadata.create_all(bind=engine)
    return engine

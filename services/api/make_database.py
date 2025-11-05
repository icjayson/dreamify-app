#!/usr/bin/env python3
"""
Database initialization script.
Creates all database tables and optionally migrates local files to S3.
"""
import sys
import os
import argparse
import logging

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.postgres.db import engine, Base
from utils.config import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_database(drop_and_recreate=False):
    """Initialize database tables."""
    try:
        # Test database connection
        logger.info("Testing database connection...")
        with engine.connect() as conn:
            logger.info(f"Connected to database: {config.aws.database.POSTGRES_DATABASE}")
        
        if drop_and_recreate:
            logger.warning("Dropping all existing tables...")
            Base.metadata.drop_all(bind=engine)
            logger.info("All tables dropped")
        
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
        
        # List created tables
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        logger.info(f"Created tables: {', '.join(tables)}")
        
    except Exception as e:
        logger.error(f"Error initializing database: {str(e)}")
        raise


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Initialize Dreamify database")
    parser.add_argument(
        "--drop-and-recreate",
        action="store_true",
        help="Drop all existing tables before creating (WARNING: This will delete all data!)"
    )
    parser.add_argument(
        "--migrate-local",
        action="store_true",
        help="Migrate local file-storage files to S3 after creating tables"
    )
    
    args = parser.parse_args()
    
    try:
        # Initialize database
        init_database(drop_and_recreate=args.drop_and_recreate)
        
        # Migrate local files if requested
        if args.migrate_local:
            logger.info("Starting local to S3 migration...")
            from scripts.migrate_local_to_s3 import migrate_local_to_s3
            migrate_local_to_s3()
            logger.info("Migration complete")
        
        logger.info("Database initialization complete!")
        
    except Exception as e:
        logger.error(f"Failed to initialize database: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()


"""Database lifecycle and request-scoped transactions."""

from contextlib import contextmanager
from typing import Generator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.platform.errors import ApiError
from app.platform.models import Base
from app.platform.settings import Settings


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+" not in url.split("://", 1)[0]:
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


class Database:
    def __init__(self, settings: Settings):
        url = normalize_database_url(settings.database_url)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args=connect_args,
        )
        if url.startswith("sqlite"):
            event.listen(self.engine, "connect", self._enable_sqlite_foreign_keys)
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            autoflush=False,
            expire_on_commit=False,
        )

    @staticmethod
    def _enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def dispose(self) -> None:
        self.engine.dispose()

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        with self.session_factory() as db_session:
            try:
                yield db_session
                db_session.commit()
            except Exception:
                db_session.rollback()
                raise


def get_session(request: Request) -> Generator[Session, None, None]:
    database: Database = request.app.state.database
    with database.session() as session:
        yield session


def get_runtime_settings(request: Request) -> Settings:
    return request.app.state.settings


def ensure_database_write_capacity(session: Session, settings: Settings) -> None:
    """Fail new high-growth writes once the Postgres demo budget is exhausted.

    SQLite is used only for local and deterministic test runs, where
    ``pg_database_size`` does not exist. Production validation already requires
    PostgreSQL, so bypassing non-Postgres dialects is explicit and safe.
    """

    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return
    try:
        used_bytes = session.scalar(text("SELECT pg_database_size(current_database())"))
    except SQLAlchemyError as exc:
        raise ApiError(
            503,
            "DATABASE_SIZE_UNAVAILABLE",
            "Database capacity could not be verified",
        ) from exc
    if used_bytes is None:
        raise ApiError(
            503,
            "DATABASE_SIZE_UNAVAILABLE",
            "Database capacity could not be verified",
        )
    if int(used_bytes) >= settings.max_database_bytes:
        raise ApiError(
            507,
            "DATABASE_SOFT_LIMIT",
            "Database storage soft limit has been reached",
            {
                "max_bytes": settings.max_database_bytes,
                "used_bytes": int(used_bytes),
            },
        )

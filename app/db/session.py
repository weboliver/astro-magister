from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app import config as app_config


def _build_database_url() -> str:
    configured_url = (os.environ.get('DATABASE_URL') or app_config.get_env_setting('DATABASE_URL') or '').strip()
    if configured_url:
        return configured_url

    db_password = os.environ.get('DB_PASSWORD') or app_config.get_env_setting('DB_PASSWORD')
    if not db_password:
        raise ValueError(
            "Database configuration error: DB_PASSWORD is not set. "
            "Either set DATABASE_URL or provide DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD."
        )

    db_host = (os.environ.get('DB_HOST') or app_config.get_env_setting('DB_HOST') or 'localhost').strip()
    db_name = (os.environ.get('DB_NAME') or app_config.get_env_setting('DB_NAME') or 'astronex').strip()
    db_user = (os.environ.get('DB_USER') or app_config.get_env_setting('DB_USER') or 'postgres').strip()
    db_port = 5432
    return f'postgresql+psycopg2://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}'


DATABASE_URL = _build_database_url()

# Create engine and sessionmaker
engine = create_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_engine():
    return engine


def get_session(request_state=None):
    """
    Get a database session.
    
    If request_state is provided (from middleware), returns the request-scoped session.
    Otherwise, creates a new session (backward compatibility).
    """
    if request_state and hasattr(request_state, 'db_session'):
        return request_state.db_session
    return SessionLocal()


# For use in FastAPI dependencies
def get_db_from_request(request) -> SessionLocal:
    """Get database session from request state. Creates new session if not available."""
    if hasattr(request.state, 'db_session'):
        return request.state.db_session
    return SessionLocal()
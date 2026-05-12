"""
Database middleware for request-scoped sessions.

Provides automatic session management for each request.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.db.session import SessionLocal, engine


class DatabaseMiddleware(BaseHTTPMiddleware):
    """Middleware that provides request-scoped database sessions."""

    async def dispatch(self, request: Request, call_next):
        # Create a session for this request
        session = SessionLocal()
        request.state.db_session = session
        
        try:
            response = await call_next(request)
            # Commit if successful
            session.commit()
            return response
        except Exception:
            # Rollback on error
            session.rollback()
            raise
        finally:
            # Always close the session
            session.close()


def get_db_session(request: Request):
    """
    FastAPI dependency to get the request-scoped database session.
    
    Usage:
        @router.get("/users")
        def get_users(db = Depends(get_db_session)):
            return db.query(User).all()
    """
    if hasattr(request.state, 'db_session'):
        return request.state.db_session
    # Fallback: create new session (for non-database routes)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@asynccontextmanager
async def get_db_session_context() -> AsyncGenerator[SessionLocal, None]:
    """Context manager for database sessions (for background tasks)."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
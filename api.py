"""Compatibility wrapper for legacy imports.

Exposes the FastAPI instance from the modular application so legacy commands
like ``uvicorn api:app`` keep working. The real app lives in app/main.py.
"""

from app.main import app

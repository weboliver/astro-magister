"""Alembic environment configuration.

Uses the project's existing SQLAlchemy engine and Base metadata so all
ORM models are automatically detected for autogenerate support.

Run migrations:
    alembic upgrade head

Generate a new migration after model changes:
    alembic revision --autogenerate -m "describe the change"

Mark an existing database as up-to-date (no schema changes needed):
    alembic stamp head
"""
from __future__ import annotations

import logging
from logging.config import fileConfig
from pathlib import Path

from alembic import context

# ---------------------------------------------------------------------------
# Load .env from the project root (same pattern as app/main.py)
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parents[1] / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Import Base (metadata) + all ORM models so autogenerate can detect tables.
# The import of app.db.models registers every ORM class on Base.metadata.
# ---------------------------------------------------------------------------
from app.db.session import Base, get_engine  # noqa: E402
import app.db.models  # noqa: F401, E402

# ---------------------------------------------------------------------------
# Alembic config object — provides values from alembic.ini
# ---------------------------------------------------------------------------
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

log = logging.getLogger("alembic.env")


def run_migrations_offline() -> None:
    """Emit SQL for migrations without a live DB connection (--sql mode)."""
    from app.db.session import DATABASE_URL  # noqa: PLC0415

    url = config.get_main_option("sqlalchemy.url") or DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations with a live DB connection."""
    engine = get_engine()
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

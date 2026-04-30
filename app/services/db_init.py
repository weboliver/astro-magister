from pathlib import Path

from sqlalchemy import text

from app.db.models.users import Role
from app.db.session import Base, get_engine, get_session


DEFAULT_ROLES = [
    (1, 'Laie'),
    (2, 'Fortgeschritten'),
    (3, 'Experte'),
]


def _run_alembic_upgrade() -> None:
    """Run ``alembic upgrade head`` using the project's alembic.ini."""
    from alembic.config import Config
    from alembic import command as alembic_command

    ini_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    alembic_cfg = Config(str(ini_path))
    alembic_command.upgrade(alembic_cfg, "head")


def _seed_roles(engine) -> None:
    """Insert default roles if the table is empty."""
    session = get_session()
    try:
        if session.query(Role).count() == 0:
            session.add_all(
                Role(role_id=role_id, role_name=role_name)
                for role_id, role_name in DEFAULT_ROLES
            )
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _reset_pg_sequences(engine) -> None:
    """Repair PostgreSQL sequences after bulk data imports."""
    try:
        with engine.begin() as conn:
            for table, col in [
                ("users", "id"),
                ("user_persons", "id"),
                ("refresh_tokens", "id"),
                ("roles", "role_id"),
            ]:
                conn.execute(
                    text(
                        f"SELECT setval("
                        f"pg_get_serial_sequence('{table}', '{col}'), "
                        f"COALESCE((SELECT MAX({col}) FROM {table}), 1), true)"
                    )
                )
    except Exception:
        pass


def init_users_db() -> None:
    """Initialise the database schema and seed required reference data.

    * **PostgreSQL**: delegates all schema management to Alembic
      (``alembic upgrade head``).  For an existing database that was
      previously managed without Alembic, run once:
      ``alembic stamp 0001``
      before the first deployment with this version.

    * **SQLite** (used by the test suite): falls back to
      ``Base.metadata.create_all`` so tests remain self-contained without
      needing a running Alembic environment.
    """
    engine = get_engine()
    dialect = getattr(engine.dialect, "name", "")

    if dialect == "postgresql":
        _run_alembic_upgrade()
    else:
        # SQLite / other in-process engines (tests)
        Base.metadata.create_all(bind=engine)

    _seed_roles(engine)

    if dialect == "postgresql":
        _reset_pg_sequences(engine)
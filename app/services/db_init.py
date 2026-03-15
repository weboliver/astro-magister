from sqlalchemy import inspect, text

from app.db.models.users import Role
from app.db.models.wiki import Section
from app.db.session import Base, get_engine, get_session


DEFAULT_ROLES = [
    (1, 'Laie'),
    (2, 'Fortgeschritten'),
    (3, 'Experte'),
]


def _ensure_role_columns(engine):
    inspector = inspect(engine)
    required_columns = {
        'user_profiles': {
            'role_id': 'INTEGER NOT NULL DEFAULT 1',
            'is_poweruser': 'BOOLEAN NOT NULL DEFAULT false',
        },
        'user_persons': {
            'role_id': 'INTEGER NOT NULL DEFAULT 1',
        },
    }

    with engine.begin() as conn:
        for table_name, columns in required_columns.items():
            existing_columns = {column['name'] for column in inspector.get_columns(table_name)}
            for column_name, column_sql in columns.items():
                if column_name not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))


def _ensure_wiki_columns(engine):
    inspector = inspect(engine)
    required_columns = {
        'sections': {
            'wiki_active': 'BOOLEAN NOT NULL DEFAULT true',
        },
        'entries': {
            'generate_text': 'TEXT',
            'ispublic': "BOOLEAN NOT NULL DEFAULT false",
        },
    }

    with engine.begin() as conn:
        for table_name, columns in required_columns.items():
            existing_columns = {column['name'] for column in inspector.get_columns(table_name)}
            for column_name, column_sql in columns.items():
                if column_name not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))


def _ensure_user_columns(engine):
    inspector = inspect(engine)
    created_column_sql = 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' if getattr(engine.dialect, 'name', '') == 'sqlite' else 'TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()'
    required_columns = {
        'users': {
            'created': created_column_sql,
        },
    }

    with engine.begin() as conn:
        for table_name, columns in required_columns.items():
            existing_columns = {column['name'] for column in inspector.get_columns(table_name)}
            for column_name, column_sql in columns.items():
                if column_name not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))


def init_users_db():
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _ensure_role_columns(engine)
    _ensure_wiki_columns(engine)
    _ensure_user_columns(engine)
    session = get_session()
    try:
        if session.query(Role).count() == 0:
            session.add_all(Role(role_id=role_id, role_name=role_name) for role_id, role_name in DEFAULT_ROLES)
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    try:
        if getattr(engine.dialect, 'name', '') == 'postgresql':
            with engine.begin() as conn:
                conn.execute(text("SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users), 1), true)"))
                conn.execute(text("SELECT setval(pg_get_serial_sequence('user_persons','id'), COALESCE((SELECT MAX(id) FROM user_persons), 1), true)"))
                conn.execute(text("SELECT setval(pg_get_serial_sequence('refresh_tokens','id'), COALESCE((SELECT MAX(id) FROM refresh_tokens), 1), true)"))
                conn.execute(text("SELECT setval(pg_get_serial_sequence('roles','role_id'), COALESCE((SELECT MAX(role_id) FROM roles), 1), true)"))
    except Exception:
        pass
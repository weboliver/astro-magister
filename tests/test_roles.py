from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.models.users import Role
from app.services import auth as auth_service
from app.services import db_init


def test_init_users_db_seeds_roles_when_table_is_empty(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    monkeypatch.setattr(db_init, "get_engine", lambda: engine)
    monkeypatch.setattr(db_init, "get_session", lambda: SessionLocal())

    db_init.init_users_db()

    with SessionLocal() as session:
        roles = session.query(Role).order_by(Role.role_id).all()
        assert [(role.role_id, role.role_name) for role in roles] == [
            (1, "Laie"),
            (2, "Fortgeschritten"),
            (3, "Experte"),
        ]

    db_init.init_users_db()

    with SessionLocal() as session:
        assert session.query(Role).count() == 3


def test_init_users_db_adds_role_columns_with_default(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE user_profiles (user_id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE user_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL)"))

    monkeypatch.setattr(db_init, "get_engine", lambda: engine)
    monkeypatch.setattr(db_init, "get_session", lambda: SessionLocal())

    db_init.init_users_db()

    with engine.begin() as conn:
        profile_columns = {row[1]: row for row in conn.execute(text("PRAGMA table_info('user_profiles')"))}
        person_columns = {row[1]: row for row in conn.execute(text("PRAGMA table_info('user_persons')"))}

        assert 'role_id' in profile_columns
        assert 'is_poweruser' in profile_columns
        assert 'role_id' in person_columns
        assert str(profile_columns['role_id'][4]) == '1'
        assert str(profile_columns['is_poweruser'][4]).lower() in {'false', '0'}
        assert str(person_columns['role_id'][4]) == '1'

        conn.execute(text("INSERT INTO user_profiles (user_id) VALUES (10)"))
        conn.execute(text("INSERT INTO user_persons (user_id, name) VALUES (20, 'Test')"))

        profile_role = conn.execute(text("SELECT role_id FROM user_profiles WHERE user_id = 10")).scalar_one()
        profile_poweruser = conn.execute(text("SELECT is_poweruser FROM user_profiles WHERE user_id = 10")).scalar_one()
        person_role = conn.execute(text("SELECT role_id FROM user_persons WHERE user_id = 20")).scalar_one()

        assert profile_role == 1
        assert profile_poweruser in (False, 0)
        assert person_role == 1


def test_list_roles_returns_seeded_roles(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    monkeypatch.setattr(db_init, "get_engine", lambda: engine)
    monkeypatch.setattr(db_init, "get_session", lambda: SessionLocal())
    monkeypatch.setattr(auth_service, "get_session", lambda: SessionLocal())

    db_init.init_users_db()

    assert auth_service.list_roles() == [
        {"role_id": 1, "role_name": "Laie"},
        {"role_id": 2, "role_name": "Fortgeschritten"},
        {"role_id": 3, "role_name": "Experte"},
    ]
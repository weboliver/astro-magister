#!/usr/bin/env python3
"""Migration helper: copy users, user_profiles, user_persons, refresh_tokens
from the local SQLite `users.db` into the SQLAlchemy/Postgres DB.

Run from repository root with the virtualenv activated:

    ./scripts/migrate_users_sqlite_to_sqlalchemy.py

"""
import sqlite3
import os
from pathlib import Path
from app.db.session import get_session, get_engine
from app.db import models
from sqlalchemy.exc import IntegrityError


def sqlite_path():
    home = os.environ.get('ASTRONEX_HOME') or str(Path.home().joinpath('.astronex'))
    return Path(home).joinpath('users.db')


def rows_from_cursor(cur, sql):
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    for row in cur.fetchall():
        yield dict(zip(cols, row))


def migrate():
    sqli = sqlite_path()
    if not sqli.exists():
        print(f"SQLite users DB not found at: {sqli}")
        return 1

    conn = sqlite3.connect(str(sqli))
    cur = conn.cursor()

    engine = get_engine()
    print('Target SQLAlchemy engine:', engine.url)

    # ensure target tables exist
    try:
        from app.db.session import Base
        print('Creating missing target tables (if any)')
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print('Warning: could not create tables automatically:', e)

    session = get_session()
    try:
        # migrate users
        users_sql = "SELECT id, username, password_hash FROM users"
        ucount = 0
        for u in rows_from_cursor(cur, users_sql):
            obj = models.User(id=u['id'], username=u['username'], password_hash=u['password_hash'])
            try:
                session.add(obj)
                session.commit()
                ucount += 1
            except IntegrityError:
                session.rollback()
                # try update existing user
                existing = session.get(models.User, u['id'])
                if existing:
                    existing.username = u['username']
                    existing.password_hash = u['password_hash']
                    session.add(existing)
                    session.commit()
        print(f'Migrated users: {ucount}')

        # migrate user_profiles
        profiles_sql = "SELECT * FROM user_profiles"
        pcount = 0
        for p in rows_from_cursor(cur, profiles_sql):
            obj = models.UserProfile(**p)
            try:
                session.add(obj)
                session.commit()
                pcount += 1
            except IntegrityError:
                session.rollback()
                # update
                existing = session.get(models.UserProfile, p.get('user_id'))
                if existing:
                    for k, v in p.items():
                        setattr(existing, k, v)
                    session.add(existing)
                    session.commit()
        print(f'Migrated profiles: {pcount}')

        # migrate user_persons
        persons_sql = "SELECT * FROM user_persons"
        noc = 0
        for r in rows_from_cursor(cur, persons_sql):
            # ensure keys match model
            obj = models.UserPerson(**{k: r.get(k) for k in r.keys()})
            try:
                session.add(obj)
                session.commit()
                noc += 1
            except IntegrityError:
                session.rollback()
        print(f'Migrated persons: {noc}')

    finally:
        try:
            session.close()
        except Exception:
            pass
        conn.close()

    return 0


if __name__ == '__main__':
    raise SystemExit(migrate())

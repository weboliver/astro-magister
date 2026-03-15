"""Reflection helpers and lightweight models for the bundled local SQLite DB.

This module does not hardcode every country table (those are many and named
per-country). Instead it reflects the `astronex/db/local.db` file and exposes
the reflected `Table` objects via `TABLES`. For common tables used by the
API we also provide small wrapper ORM-like helpers.
"""
from __future__ import annotations
from pathlib import Path
from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import registry
from app.db.session import Base
from sqlalchemy import Table
from sqlalchemy import inspect
from typing import Dict


# Prefer bundled DB under the repository: repo_root/astronex/db/local.db
LOCAL_DB_PATH = Path(__file__).resolve().parents[3] / 'astronex' / 'db' / 'local.db'
if not LOCAL_DB_PATH.exists():
    # fall back to user home ~/.astronex/local.db if bundled file missing
    LOCAL_DB_PATH = Path.home().joinpath('.astronex', 'local.db')

# SQLite engine for the local DB (read-only reflection)
_local_engine = create_engine(f'sqlite:///{LOCAL_DB_PATH}', echo=False, future=True)
_local_metadata = MetaData()
_local_metadata.reflect(bind=_local_engine)

# Use a registry to map classes to reflected tables dynamically
_mapper_registry = registry()
LOCAL_CLASSES: dict[str, type] = {}
LOCAL_DECLARATIVE: Dict[str, type] = {}


def _camelize(name: str) -> str:
    return ''.join(part.capitalize() for part in name.replace('-', '_').split('_'))


for tname, table in _local_metadata.tables.items():
    cls_name = _camelize(tname)

    # create a lightweight wrapper class that holds the Table and simple helpers
    def _make_all(table):
        def all(cls, limit: int | None = None):
            from sqlalchemy import select
            conn = _local_engine.connect()
            stmt = select(table)
            if limit:
                stmt = stmt.limit(limit)
            try:
                res = conn.execute(stmt)
                cols = res.keys()
                return [dict(zip(cols, row)) for row in res.fetchall()]
            finally:
                conn.close()
        return classmethod(all)

    def _make_count(table):
        def count(cls):
            from sqlalchemy import select, func
            conn = _local_engine.connect()
            stmt = select(func.count()).select_from(table)
            try:
                res = conn.execute(stmt).scalar_one()
                return int(res)
            finally:
                conn.close()
        return classmethod(count)

    cls_dict = {
        '__table__': table,
        'all': _make_all(table),
        'count': _make_count(table),
    }
    cls = type(cls_name, (object,), cls_dict)
    LOCAL_CLASSES[tname] = cls
    globals()[cls_name] = cls

# Also create declarative classes bound to the application's Base.metadata so
# we can create equivalent tables in the target DB (e.g. Postgres). We create
# a new Table in Base.metadata by reflecting column definitions from the
# local SQLite `table` via `autoload_with` and then assign it to a declarative
# class that subclasses `Base`.
_LOCAL_TABLES_IN_BASE: dict[str, Table] = {}


def _ensure_declarative_mappings():
    """Create Table objects in `Base.metadata` for all reflected local tables and
    create declarative ORM classes only for those tables that have an explicit
    primary key. This avoids mapper errors for tables without PKs.
    """
    inspector = inspect(_local_engine)
    for tname in list(_local_metadata.tables.keys()):
        try:
            reflected = Table(tname, Base.metadata, autoload_with=_local_engine, extend_existing=True)
            _LOCAL_TABLES_IN_BASE[tname] = reflected
            # determine PK presence
            try:
                pk = inspector.get_pk_constraint(tname).get('constrained_columns') or []
            except Exception:
                pk = []
            if pk:
                decl_name = _camelize(tname)
                DeclClass = type(decl_name, (Base,), {'__table__': reflected})
                LOCAL_DECLARATIVE[tname] = DeclClass
                globals()[f"D{decl_name}"] = DeclClass
        except Exception:
            continue


def create_all_in_target(target_engine):
    """Create all reflected local tables in the target database using
    the application's `Base.metadata` (which holds the declarative Table
    objects created above).
    """
    # ensure declarative classes have been created; create them lazily if needed
    if not LOCAL_DECLARATIVE:
        for tname in list(_local_metadata.tables.keys()):
            try:
                reflected = Table(tname, Base.metadata, autoload_with=_local_engine, extend_existing=True)
                decl_name = _camelize(tname)
                DeclClass = type(decl_name, (Base,), {'__table__': reflected})
                LOCAL_DECLARATIVE[tname] = DeclClass
                globals()[f"D{decl_name}"] = DeclClass
            except Exception:
                continue
    Base.metadata.create_all(bind=target_engine)


def get_table(name: str):
    return _local_metadata.tables.get(name)


def get_model_for_table(name: str):
    return LOCAL_CLASSES.get(name)


WORLDNAMES = _local_metadata.tables.get('worldnames')
WORLDADMIN = _local_metadata.tables.get('worldadmin')
USASTATES = _local_metadata.tables.get('usastates')
USAADMIN = _local_metadata.tables.get('usaadmin')
ZONETAB = _local_metadata.tables.get('zonetab')


def list_tables() -> list[str]:
    return list(_local_metadata.tables.keys())


__all__ = [
    'LOCAL_DB_PATH',
    'get_table',
    'get_model_for_table',
    'LOCAL_CLASSES',
    'WORLDNAMES',
    'WORLDADMIN',
    'USASTATES',
    'USAADMIN',
    'ZONETAB',
    'list_tables',
]

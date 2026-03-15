#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.db.session import Base, get_engine, get_session
from app.db.models.locations import (
    CountryName,
    WorldAdminRegion,
    UsaState,
    UsaAdminRegion,
    ZoneEntry,
    Location,
)


META_TABLES = {
    'worldnames',
    'worldadmin',
    'usastates',
    'usaadmin',
    'zonetab',
}


def _local_db_path() -> Path:
    p = Path(__file__).resolve().parents[1] / 'astronex' / 'db' / 'local.db'
    return p


def _to_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        pass
    try:
        from astronex.utils import degtodec
        return float(degtodec(text))
    except Exception:
        return None


def _load_rows(conn: sqlite3.Connection, table_name: str):
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM '{table_name}'")
    return [dict(r) for r in cur.fetchall()]


def migrate():
    source_db = _local_db_path()
    if not source_db.exists():
        raise SystemExit(f"Source DB not found: {source_db}")

    target_engine = get_engine()
    Base.metadata.create_all(bind=target_engine)

    src = sqlite3.connect(str(source_db))
    src.row_factory = sqlite3.Row
    cur = src.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    table_names = [r[0] for r in cur.fetchall() if not str(r[0]).startswith('sqlite_')]

    session = get_session()
    try:
        usa_state_codes = set()

        # clean target tables before full refresh migration
        session.query(Location).delete()
        session.query(ZoneEntry).delete()
        session.query(UsaAdminRegion).delete()
        session.query(UsaState).delete()
        session.query(WorldAdminRegion).delete()
        session.query(CountryName).delete()
        session.commit()

        # metadata tables
        if 'worldnames' in table_names:
            for row in _load_rows(src, 'worldnames'):
                session.add(CountryName(code=row.get('code'), name=row.get('name') or ''))

        if 'worldadmin' in table_names:
            for row in _load_rows(src, 'worldadmin'):
                session.add(WorldAdminRegion(alfa=row.get('alfa'), code=row.get('code'), name=row.get('name') or ''))

        if 'usastates' in table_names:
            for row in _load_rows(src, 'usastates'):
                alfa = (row.get('alfa') or '').upper()
                if alfa:
                    usa_state_codes.add(alfa)
                session.add(UsaState(alfa=row.get('alfa'), code=row.get('code'), name=row.get('name') or ''))

        if 'usaadmin' in table_names:
            for row in _load_rows(src, 'usaadmin'):
                session.add(
                    UsaAdminRegion(
                        alfa=row.get('alfa'),
                        state=row.get('state'),
                        code=row.get('code'),
                        name=row.get('name') or '',
                    )
                )

        if 'zonetab' in table_names:
            for row in _load_rows(src, 'zonetab'):
                session.add(ZoneEntry(alfa=row.get('alfa'), zones=row.get('zones'), name=row.get('name') or ''))

        session.commit()

        # all country/city tables into normalized `locations`
        inserted_locations = 0
        for tname in table_names:
            if tname in META_TABLES:
                continue
            try:
                rows = _load_rows(src, tname)
            except Exception:
                continue
            if not rows:
                continue

            # process only rows that look like city/location rows
            if 'Ciudad' not in rows[0]:
                continue

            for row in rows:
                cc = row.get('CC')
                ac = row.get('AC')
                city = row.get('Ciudad')
                lat_raw = row.get('Latitud')
                lon_raw = row.get('Longitud')

                country_code = cc
                if not country_code:
                    if tname.upper() in usa_state_codes:
                        country_code = 'US'
                    elif tname.upper().startswith('US') and len(tname) >= 4:
                        country_code = 'US'
                    elif len(tname) == 2:
                        country_code = tname.upper()
                    else:
                        country_code = tname[:2].upper()

                location = Location(
                    source_table=tname,
                    cc=cc,
                    ac=ac,
                    country_code=country_code,
                    region_code=ac,
                    city=city,
                    latitude=_to_float(lat_raw),
                    longitude=_to_float(lon_raw),
                    latitude_text=str(lat_raw) if lat_raw is not None else None,
                    longitude_text=str(lon_raw) if lon_raw is not None else None,
                )
                session.add(location)
                inserted_locations += 1

            # commit per table to keep memory bounded
            session.commit()

        # backfill missing countries from actual location country codes
        known_country_codes = {
            (code or '').upper()
            for (code,) in session.query(CountryName.code).all()
            if code
        }
        location_country_codes = {
            (code or '').upper()
            for (code,) in session.query(Location.country_code).distinct().all()
            if code
        }
        missing_country_codes = sorted(location_country_codes - known_country_codes)
        for code in missing_country_codes:
            session.add(CountryName(code=code, name=code))
        if missing_country_codes:
            session.commit()

        # stats
        print('Target SQLAlchemy engine:', target_engine.url)
        print('Source tables:', len(table_names))
        print('Country names:', session.query(CountryName).count())
        print('World admin regions:', session.query(WorldAdminRegion).count())
        print('USA states:', session.query(UsaState).count())
        print('USA admin regions:', session.query(UsaAdminRegion).count())
        print('Zone entries:', session.query(ZoneEntry).count())
        print('Locations inserted:', inserted_locations)
        print('Locations total:', session.query(Location).count())
        print('Country names backfilled:', len(missing_country_codes))
    finally:
        session.close()
        src.close()


if __name__ == '__main__':
    migrate()

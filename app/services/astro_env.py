import builtins
import threading
from typing import Optional

from fastapi import FastAPI
from sqlalchemy import func

from astronex import countries
from astronex.config import read_config
from astronex.nex import init_config, langs
from astronex.state import Current
if not hasattr(builtins, '_'):
    builtins._ = lambda value: value
from astronex.boss import Manager
from astronex import database as astronex_database_adapter
from astronex.utils import degtodec, dectodeg

from app.db.session import get_session
from app.db.models.locations import (
    CountryName,
    WorldAdminRegion,
    UsaState,
    UsaAdminRegion,
    ZoneEntry,
    Location,
)


class AstroEnvironment:
    """Holds the shared Astronex boss/state needed for drawing."""

    def __init__(self, manager: Manager, state: Current, opts):
        self.manager = manager
        self.state = state
        self.opts = opts
        self.lock = threading.Lock()
        self._drawer_cls = None

    def get_drawer(self):
        if self._drawer_cls is None:
            from astronex.drawing.dispatcher import DrawMixin

            self._drawer_cls = DrawMixin
        return self._drawer_cls


_env_lock = threading.Lock()
_env_instance: Optional[AstroEnvironment] = None
_db_adapter_patched = False


def _to_decimal(value, text_value=None):
    if value is not None:
        try:
            f = float(value)
            # already decimal-style value
            if abs(f) <= 180:
                return f
        except Exception:
            pass
    text = None
    if text_value is not None:
        text = str(text_value).strip()
    elif value is not None:
        text = str(value).strip()
    if not text:
        return None
    try:
        return float(degtodec(text))
    except Exception:
        return None


def _resolve_world_zone(session, country_code: str, region_code: str):
    entries = session.query(ZoneEntry).filter(ZoneEntry.alfa == country_code).all()
    for entry in entries:
        zone = entry.zones or ''
        if zone.startswith('*'):
            return entry.name
        if zone.startswith('-'):
            nozone = zone[1:].split(',')
            if region_code not in nozone:
                return entry.name
        else:
            okzone = zone.split(',')
            if region_code in okzone:
                return entry.name
    return ''


def _resolve_usa_zone(session, state_code: str, region_code: str):
    entries = session.query(ZoneEntry).filter(ZoneEntry.alfa == 'US').all()
    for entry in entries:
        zones = entry.zones or ''
        for code in zones.split(';'):
            code = code.strip()
            if not code.startswith(state_code):
                continue
            if len(code) == len(state_code):
                return entry.name
            suffix = code[2:]
            if suffix.startswith('-'):
                nozone = suffix[1:].split(',')
                if region_code not in nozone:
                    return entry.name
            else:
                okzone = suffix[1:].split(',') if len(suffix) > 1 else []
                if region_code in okzone:
                    return entry.name
    return ''


def _patch_astronex_database_adapter_for_web():
    global _db_adapter_patched
    if _db_adapter_patched:
        return

    def connect(_app):
        # no-op: web app uses SQLAlchemy via DATABASE_URL
        return None

    def fetch_worldcity(country, city, code, loc):
        session = get_session()
        try:
            country_in = str(country or '').strip()
            country_code = country_in.upper()
            table_hint = country_in.lower()
            query = session.query(Location).filter(
                func.lower(Location.city) == str(city or '').lower(),
                Location.region_code == str(code),
            )
            row = query.filter(
                (Location.source_table == table_hint) | (Location.country_code == country_code)
            ).first()
            if not row:
                raise StopIteration

            loc.country_code = row.country_code or country_code
            loc.region_code = row.region_code or str(code)
            loc.city = row.city
            loc.latdec = _to_decimal(row.latitude, row.latitude_text)
            loc.longdec = _to_decimal(row.longitude, row.longitude_text)
            loc.latitud = row.latitude_text or (dectodeg(loc.latdec) if loc.latdec is not None else '')
            loc.longitud = row.longitude_text or (dectodeg(loc.longdec) if loc.longdec is not None else '')

            reg = (
                session.query(WorldAdminRegion)
                .filter(WorldAdminRegion.alfa == loc.country_code, WorldAdminRegion.code == loc.region_code)
                .first()
            )
            loc.region = reg.name if reg else ''
            cnt = session.query(CountryName).filter(CountryName.code == loc.country_code).first()
            loc.country = cnt.name if cnt else loc.country_code
            loc.zone = _resolve_world_zone(session, loc.country_code, loc.region_code)
        finally:
            session.close()

    def fetch_usacity(country, city, code, loc):
        session = get_session()
        try:
            state_alpha = str(country or '').upper()
            table_name = f"US{state_alpha}"
            row = (
                session.query(Location)
                .filter(
                    Location.source_table == table_name,
                    func.lower(Location.city) == str(city or '').lower(),
                    Location.region_code == str(code),
                )
                .first()
            )
            if not row:
                raise StopIteration

            loc.country = state_alpha
            loc.region_code = row.region_code or str(code)
            loc.city = row.city
            loc.latdec = _to_decimal(row.latitude, row.latitude_text)
            loc.longdec = _to_decimal(row.longitude, row.longitude_text)
            loc.latitud = dectodeg(float(loc.latdec)) if loc.latdec is not None else ''
            loc.longitud = dectodeg(float(loc.longdec)) if loc.longdec is not None else ''

            admin = (
                session.query(UsaAdminRegion)
                .filter(UsaAdminRegion.alfa == state_alpha, UsaAdminRegion.code == loc.region_code)
                .first()
            )
            if admin:
                loc.country_code = admin.state
                loc.region = admin.name
            else:
                loc.country_code = state_alpha
                loc.region = ''

            state = session.query(UsaState).filter(UsaState.alfa == state_alpha).first()
            state_name = state.name if state else state_alpha
            loc.region = f"{loc.region} ({state_name})" if loc.region else state_name
            loc.country = 'USA'
            loc.zone = _resolve_usa_zone(session, loc.country_code, loc.region_code)
        finally:
            session.close()

    def get_favlist(_tbl, _lim, _chart):
        # API drawing path does not load chart favorites from file-based DBs.
        return []

    astronex_database_adapter.connect = connect
    astronex_database_adapter.fetch_worldcity = fetch_worldcity
    astronex_database_adapter.fetch_usacity = fetch_usacity
    astronex_database_adapter.get_favlist = get_favlist
    astronex_database_adapter.local_conn = None
    _db_adapter_patched = True


def ensure_astro_env(app: FastAPI) -> AstroEnvironment:
    """Initialize Astronex boss/state once and return the shared environment."""

    global _env_instance
    if _env_instance is not None:
        return _env_instance
    with _env_lock:
        if _env_instance is not None:
            return _env_instance
        opts = read_config(app.home_dir)
        opts.home_dir = app.home_dir
        langs[opts.lang].install()
        countries.install(opts.lang)
        app.lang = opts.lang
        _patch_astronex_database_adapter_for_web()
        state = Current(app)
        init_config(app.home_dir, opts, state)
        manager = Manager(app, opts, state)
        _env_instance = AstroEnvironment(manager, state, opts)
        return _env_instance

import io
from datetime import datetime
from types import SimpleNamespace
from typing import Optional

from fastapi import FastAPI
from astronex import gi_init  # noqa: F401
try:
    from gi.repository import cairo as gi_cairo
    if not hasattr(gi_cairo, 'ImageSurface'):
        raise AttributeError
    cairo = gi_cairo
except (ImportError, AttributeError):
    import cairo
from pytz import timezone as pytz_timezone

from astronex.chart import Chart
from app import config as app_config

from app.schemas.datetime_models import DateTimeRequest
from app.services.astro_env import ensure_astro_env
from app.services.ephemeris import houses, julday, calc
from app.services.planet_positions import calculate_api_planet_longitudes


class _ChartSurface:
    """Minimal surface object so DrawMixin has the attributes it expects."""

    def __init__(self, operation: str) -> None:
        self.opaux = [operation]
        self.pepending = [False, None, None]


def _decimal_hour(request: DateTimeRequest) -> tuple[float, datetime]:
    """Return the UTC decimal hour and UTC datetime for the request."""

    naive_dt = datetime(
        request.year,
        request.month,
        request.day,
        request.hour,
        request.minute,
        request.second,
    )
    tz_name = request.timezone or 'UTC'
    try:
        local_tz = pytz_timezone(tz_name)
    except Exception:
        local_tz = pytz_timezone('UTC')
    try:
        local_dt = local_tz.localize(naive_dt, is_dst=True)
    except Exception:
        local_dt = pytz_timezone('UTC').localize(naive_dt)
    utc_dt = local_dt.astimezone(pytz_timezone('UTC'))
    decimal = utc_dt.hour + utc_dt.minute / 60.0 + utc_dt.second / 3600.0
    return decimal, utc_dt


def build_chart_from_request(request: DateTimeRequest) -> Chart:
    """Create an Astronex Chart instance from the DateTimeRequest payload."""

    app_config.init_swisseph_path()
    decimal_hour, utc_dt = _decimal_hour(request)
    jd = julday(request.year, request.month, request.day, decimal_hour)
    chart = Chart()
    chart.first = ''
    chart.last = ''
    chart.city = ''
    chart.country = ''
    chart.region = ''
    chart.latitud = request.latitude
    chart.longitud = request.longitude
    chart.zone = request.timezone or 'UTC'
    chart.date = utc_dt.strftime('%Y-%m-%dT%H:%M:%S%zUTC')
    loc = SimpleNamespace(latdec=request.latitude, longdec=request.longitude, zone=chart.zone)
    chart.planets = calculate_api_planet_longitudes(jd, calc, epheflag=4)
    chart.houses = houses(jd, request.latitude, request.longitude) or chart.calc(
        (request.year, request.month, request.day, decimal_hour), loc, 4
    )[1]
    return chart


def draw_chart_png(
    app: FastAPI,
    chart: Chart,
    width: int = 600,
    height: int = 600,
    operation: str = 'draw_nat',
    transit_chart: Optional[Chart] = None,
    second_chart: Optional[Chart] = None,
) -> bytes:
    """Render the provided chart as a PNG byte blob using the requested draw operation."""

    env = ensure_astro_env(app)
    drawer_cls = env.get_drawer()
    surface_obj = _ChartSurface(operation)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    cr = cairo.Context(surface)
    cr.set_source_rgb(1.0, 1.0, 1.0)
    cr.paint()
    state = env.state
    prev = {
        'curr_chart': state.curr_chart,
        'curr_click': state.curr_click,
        'curr_op': state.curr_op,
        'opmode': state.opmode,
        'opleft': state.opleft,
        'opright': state.opright,
        'clickmode': state.clickmode,
        'now': state.now,
        'charts_now': state.charts.get('now'),
    }

    if second_chart is not None:
        # Synastry mode: use the second chart directly for curr_click (not a copy)
        click_chart = second_chart
    else:
        # Original behavior: copy the primary chart for curr_click
        click_chart = Chart('click')
        click_chart.planets = list(chart.planets)
        click_chart.houses = list(chart.houses)
        click_chart.first = chart.first
        click_chart.last = chart.last
        click_chart.city = chart.city
        click_chart.region = chart.region
        click_chart.country = chart.country
        click_chart.latitud = chart.latitud
        click_chart.longitud = chart.longitud
        click_chart.zone = chart.zone
        click_chart.date = chart.date

    with env.lock:
        try:
            state.curr_chart = chart
            state.curr_click = click_chart
            state.curr_op = operation
            state.opmode = 'simple'
            state.opleft = operation
            state.opright = operation
            state.clickmode = 'master'
            if transit_chart is not None:
                state.now = transit_chart
                state.charts['now'] = transit_chart
            else:
                state.now = chart
                state.charts['now'] = chart
            drawer = drawer_cls(env.opts, surface_obj)
            drawer.dispatch_pres(cr, width, height)
            buffer = io.BytesIO()
            surface.write_to_png(buffer)
            return buffer.getvalue()
        finally:
            state.curr_chart = prev['curr_chart']
            state.curr_click = prev['curr_click']
            state.curr_op = prev['curr_op']
            state.opmode = prev['opmode']
            state.opleft = prev['opleft']
            state.opright = prev['opright']
            state.clickmode = prev['clickmode']
            state.now = prev['now']
            if prev['charts_now'] is not None:
                state.charts['now'] = prev['charts_now']
            else:
                state.charts['now'] = state.now

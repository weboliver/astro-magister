from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import asyncio
import json
import logging
logger = logging.getLogger(__name__)

from app.services.ephemeris import julday, revjul, calc_ut, calc_ut_with_speed, houses
from app import config as app_config
from app.schemas.datetime_models import SolarReturnRequest, SolarReturnResponse
from app.static.texte import get_general_anweisung
import astronex.chart as chart_module
from astronex.chart import Chart
from astronex.config import ORBS as CONFIG_ORBS
from astronex.nexdate import NeXDate
from pytz import timezone as pytz_timezone
from app.services.planet_names import get_planet_name
from app.static.zodiac_names import get_zodiac_name
try:
    from timezonefinder import TimezoneFinder
except Exception as e:
    logger.debug(f"TimezoneFinder not available: {e}")
    TimezoneFinder = None
from app.services.horoscope_graphics import draw_chart_png
from app.services.providers import get_chat_provider
from app.services.perplexity import append_additional_question
from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate

router = APIRouter(tags=["solar"], dependencies=[Depends(require_authenticated_user)])
logger = logging.getLogger(__name__)

SOLAR_RETURN_SYSTEM_PROMPT = "solar_return"


def _resolve_role_name_for_solar_return(request: Request, payload: SolarReturnRequest) -> str:
    """Resolve role name for solar return interpretation.

    Args:
        request: FastAPI request.
        payload: SolarReturnRequest with optional person_id.

    Returns:
        Role name string.
    """
    user = _get_user_from_request(request)
    if not user:
        return "Laie"
    return auth_service.get_role_name_for_subject(user['id'], getattr(payload, 'person_id', None))


def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Events message.

    Args:
        event: Event type string.
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _normalize_diff(target: float, current: float) -> float:
    """Normalize longitude difference to [-180, 180] range.

    Args:
        target: Target longitude.
        current: Current longitude.

    Returns:
        Normalized difference in degrees.
    """
    # Bring longitude difference into [-180, 180] to avoid wrap issues
    return (target - current + 540.0) % 360.0 - 180.0


def _build_solar_return_response(request: SolarReturnRequest) -> SolarReturnResponse:
    """Compute exact solar return time (UTC) and return all planets and houses for that moment.

    Args:
        request: SolarReturnRequest with birth data and target year.

    Returns:
        SolarReturnResponse with solar return positions and AI summary.

    Raises:
        HTTPException: If target_year precedes birth_year or calculation fails.
    """
    target_year = request.target_year or (request.birth_year + 1)
    if target_year < request.birth_year:
        raise HTTPException(status_code=400, detail="target_year must not precede birth_year")

    # Determine birth time in UT hours. Prefer explicit IANA `timezone`,
    # otherwise fall back to lat/lon -> timezone via timezonefinder when available.
    birth_hour = request.birth_hour + request.birth_minute / 60.0 + request.birth_second / 3600.0
    if request.timezone:
        try:
            nx = NeXDate(None)
            tz = nx.patch_timezone(request.timezone)
            local_dt = pytz_timezone(request.timezone).localize(
                __import__('datetime').datetime(
                    request.birth_year, request.birth_month, request.birth_day,
                    request.birth_hour, request.birth_minute, request.birth_second
                ), is_dst=True
            )
            ut = local_dt.astimezone(pytz_timezone('UTC'))
            birth_hour = ut.hour + ut.minute / 60.0 + ut.second / 3600.0
        except Exception as e:
            logger.debug(f"Timezone parse failed, using UT: {e}")
    elif TimezoneFinder and (request.latitude != 0.0 or request.longitude != 0.0):
        try:
            tf = TimezoneFinder()
            tzname = tf.timezone_at(lat=request.latitude, lng=request.longitude)
            if tzname:
                nx = NeXDate(None)
                tz = nx.patch_timezone(tzname)
                local_dt = pytz_timezone(tzname).localize(
                    __import__('datetime').datetime(
                        request.birth_year, request.birth_month, request.birth_day,
                        request.birth_hour, request.birth_minute, request.birth_second
                    ), is_dst=True
                )
                ut = local_dt.astimezone(pytz_timezone('UTC'))
                birth_hour = ut.hour + ut.minute / 60.0 + ut.second / 3600.0
        except Exception as e:
            logger.warning(f"Failed to parse birth timezone, using UT: {e}")

    # 1. Sonnenstand zum Geburtszeitpunkt
    flags, natal_lon, natal_speed, error = calc_ut_with_speed(
        julday(request.birth_year, request.birth_month, request.birth_day, birth_hour), 0, 4
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Error computing natal Sun: {error}")

    # 2. Solar-Return-Zeitpunkt iterativ bestimmen
    current_jd = julday(target_year, request.birth_month, request.birth_day, birth_hour)
    iterations = 0
    last_lon = natal_lon
    last_diff = _normalize_diff(natal_lon, last_lon)

    for _ in range(15):
        iterations += 1
        flags, lon, speed_lon, calc_error = calc_ut_with_speed(current_jd, 0, 4)
        if calc_error:
            raise HTTPException(status_code=400, detail=f"Error computing solar return: {calc_error}")

        last_lon = lon
        last_diff = _normalize_diff(natal_lon, lon)
        if abs(last_diff) < 1e-6:
            break

        speed = speed_lon if abs(speed_lon) > 1e-6 else 0.9856  # deg/day fallback
        step_days = last_diff / speed
        if step_days > 1.0:
            step_days = 1.0
        elif step_days < -1.0:
            step_days = -1.0
        if abs(step_days) < 1e-6:
            step_days = 0.0001 if last_diff > 0 else -0.0001

        current_jd += step_days

    y, m, d, h = revjul(current_jd, 1)

    # 3. Planeten zum Solar-Return-Zeitpunkt
    planet_list = []
    for planet_id in range(13):
        try:
            ephe_id = {0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:13,12:15}.get(planet_id, planet_id)
            flags, lon, speed_lon, error = calc_ut_with_speed(current_jd, ephe_id, 4)
            # Retry once for Chiron (SE id 15) if initial calc failed
            if error and ephe_id == 15:
                try:
                    app_config.init_swisseph_path()
                    flags, lon, speed_lon, error = calc_ut_with_speed(current_jd, ephe_id, 4)
                except Exception as e:
                    logger.warning(f"Failed to reinit Swiss Ephemeris for Chiron: {e}")
            if not error:
                sign_idx = int(lon // 30) % 12
                deg_in_sign = lon - sign_idx * 30
                minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
                sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
                planet_list.append({
                    "planet_id": planet_id,
                    "planet_name": get_planet_name(planet_id),
                    "longitude": lon,
                    "sign_index": sign_idx,
                    "sign": get_zodiac_name(sign_idx) if sign_idx is not None else None,
                    "sign_degree": sign_deg,
                })
        except Exception:
            continue

    # Ensure Chiron is present: if it wasn't added above try a direct calc and append
    if not any(p.get('planet_id') == 12 for p in planet_list):
        try:
            flags, lon, speed_lon, error = calc_ut_with_speed(current_jd, 15, 4)
            if error:
                try:
                    app_config.init_swisseph_path()
                    flags, lon, speed_lon, error = calc_ut_with_speed(current_jd, 15, 4)
                except Exception:
                    pass
            if not error:
                sign_idx = int(lon // 30) % 12
                deg_in_sign = lon - sign_idx * 30
                minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
                sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
                planet_list.append({
                    "planet_id": 12,
                    "planet_name": get_planet_name(12),
                    "longitude": lon,
                    "sign_index": sign_idx,
                    "sign": get_zodiac_name(sign_idx) if sign_idx is not None else None,
                    "sign_degree": sign_deg,
                })
        except Exception:
            pass

    # As a final safety: ensure all expected planet IDs (0..12) are present.
    existing_ids = {p.get('planet_id') for p in planet_list}
    for expected in range(13):
        if expected in existing_ids:
            continue
        try:
            ephe_id = {0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:13,12:15}.get(expected, expected)
            flags, lon, error = calc_ut(current_jd, ephe_id, 4)
            if error:
                try:
                    app_config.init_swisseph_path()
                    flags, lon, error = calc_ut(current_jd, ephe_id, 4)
                except Exception:
                    continue
            if not error:
                planet_list.append({
                    "planet_id": expected,
                    "planet_name": get_planet_name(expected),
                    "longitude": lon,
                    "sign_index": int(lon // 30) % 12,
                    "sign": get_zodiac_name(int(lon // 30) % 12),
                    "sign_degree": f"{int((lon - int(lon // 30) * 30)) :02d}\u00b0 {int(((lon - int(lon // 30) * 30) - int(lon - int(lon // 30) * 30)) * 60):02d}\u2032",
                })
        except Exception:
            continue

    # 3b. Aspekte zwischen Planeten (für Response):
    # Ensure global 'orbs' table in chart module is populated (used by Chart.aspects)
    if not getattr(chart_module, 'orbs', None):
        chart_module.orbs.extend([
            CONFIG_ORBS['lum'],
            CONFIG_ORBS['normal'],
            CONFIG_ORBS['short'],
            CONFIG_ORBS['far'],
            CONFIG_ORBS['useless'],
        ])

    chart = Chart()
    # ensure planets list order matches chart expectations: 11 longitudes
    chart.planets = [p["longitude"] for p in planet_list]
    # Try to compute aspects with full chart logic; fall back to a simple safe calculation
    try:
        raw_aspects = chart.aspects()
    except Exception:
        raw_aspects = []
        pl = chart.planets[:]
        for i in range(len(pl)):
            for j in range(i+1, len(pl)):
                dis = abs(pl[i] - pl[j])
                if dis > 180.0:
                    dis = 360.0 - dis
                a = int(round(dis / 30.0)) % 12
                raw_aspects.append({"p1": i, "p2": j, "a": a, "f1": None, "f2": None, "gw": False})

    # Normalize aspects: add human-readable label and separation
    aspects = []
    aspnames = getattr(chart_module, 'aspnames', None)
    from app.static.aspect_names import get_aspect_english_by_index
    for asp in raw_aspects:
        p1 = asp.get('p1')
        p2 = asp.get('p2')
        a = int(asp.get('a', 0)) if asp.get('a') is not None else 0
        f1 = asp.get('f1')
        f2 = asp.get('f2')
        gw = bool(asp.get('gw', False))
        label = get_aspect_english_by_index(a)
        sep = None
        try:
            pl = chart.planets
            sep = abs(pl[p1] - pl[p2])
            if sep > 180.0:
                sep = 360.0 - sep
        except Exception:
            sep = None

        # resolve names from planet_list built above (includes Lilith/Chiron)
        try:
            n1 = planet_list[p1]['planet_name'] if isinstance(p1, int) and p1 < len(planet_list) else str(p1)
        except Exception:
            n1 = str(p1)
        try:
            n2 = planet_list[p2]['planet_name'] if isinstance(p2, int) and p2 < len(planet_list) else str(p2)
        except Exception:
            n2 = str(p2)

        aspects.append({
            'p1': p1, 'p2': p2, 'p1_name': n1, 'p2_name': n2,
            'a': a, 'f1': f1, 'f2': f2, 'gw': gw,
            'label': label, 'separation': sep
        })

    # 4. Häuser (Placidus) zum Solar-Return-Zeitpunkt (mit Ort falls angegeben)
    lat = getattr(request, "latitude", 0.0)
    lon = getattr(request, "longitude", 0.0)
    houses_list = houses(current_jd, lat, lon) or [None]*12

    # Build a concise summary string for KI input
    try:
        # attach houses to chart for which_house
        chart.houses = list(houses_list) if houses_list else [None]*12
        planet_house_parts = []
        for p in planet_list:
            name = p.get('planet_name')
            plon = p.get('longitude')
            try:
                house_idx = chart.which_house(plon)
                hl = chart.house_label(house_idx)
                house_str = str(hl) if hl is not None else 'unknown'
            except Exception:
                house_idx = None
                hl = None
                house_str = 'unknown'
            # attach explicit house info to the planet entry for debugging/clarity
            p['house_index'] = house_idx
            p['house'] = hl
            # compute degree within house (distance from cusp)
            try:
                cusp = chart.houses[house_idx]
                deg_from_cusp = (plon - cusp) % 360.0
                if deg_from_cusp < 0:
                    deg_from_cusp += 360.0
                deg_int = int(deg_from_cusp)
                minutes = int((deg_from_cusp - deg_int) * 60)
                p['house_degree'] = f"{deg_int:02d}\u00b0 {minutes:02d}\u2032"
            except Exception:
                p['house_degree'] = None
            # include zodiac sign and formatted degree in summary if available
            sign = p.get('sign')
            sign_deg = p.get('sign_degree')
            house_deg = p.get('house_degree')
            if house_deg:
                house_text = f"{house_str} ({house_deg})"
            else:
                house_text = str(house_str)
            if sign:
                planet_house_parts.append(f"{name} in house {house_text} ({sign} {sign_deg})")
            else:
                planet_house_parts.append(f"{name} in house {house_text}")

        aspect_parts = []
        planames = getattr(chart_module, 'planames', None)
        for a in aspects:
            p1 = a.get('p1')
            p2 = a.get('p2')
            label = a.get('label')
            try:
                n1 = a.get('p1_name') or (planames[p1] if planames and isinstance(p1, int) and p1 < len(planames) else str(p1))
                n2 = a.get('p2_name') or (planames[p2] if planames and isinstance(p2, int) and p2 < len(planames) else str(p2))
            except Exception:
                n1 = str(p1); n2 = str(p2)
            aspect_parts.append(f"{n1} to {n2} / {label}")

        birth = f"{request.birth_year:04d}-{request.birth_month:02d}-{request.birth_day:02d}"
        summary = "Huber Astrologische Psychologie. "  + "\n\n"
        summary += f"Interpretiere zum Geburtshoroskop vom {birth}" + f" das Solarhoroskop im Jahr: {target_year}:\n\n" + "; ".join(planet_house_parts) + ". Aspects: " + "\n".join(aspect_parts) + "\n\n" +\
                        get_general_anweisung()
    except Exception:
        summary = ""

    # 4. Häuser (Placidus) zum Solar-Return-Zeitpunkt (mit Ort falls angegeben)
    lat = getattr(request, "latitude", 0.0)
    lon = getattr(request, "longitude", 0.0)
    houses_list = houses(current_jd, lat, lon) or [None]*12

    return SolarReturnResponse(
        target_year=target_year,
        return_year=int(y),
        return_month=int(m),
        return_day=int(d),
        return_hour=h,
        julian_day=current_jd,
        natal_sun_longitude=natal_lon,
        solar_return_longitude=last_lon,
        longitude_difference=last_diff,
        iterations=iterations,
        planets=planet_list,
        houses=list(houses_list) if houses_list else [None]*12,
        aspects=aspects,
        summary=append_additional_question(summary, getattr(request, 'additional_question', None)),
    )


@router.post("/solar-return", response_model=SolarReturnResponse)
def get_solar_return(request: SolarReturnRequest):
    """Calculate the solar return for a birth chart in a given target year.

    Finds the exact moment when the Sun returns to its natal position and
    computes planet positions, houses, and aspects for that moment.

    Args:
        request: SolarReturnRequest with birth data and target year.

    Returns:
        SolarReturnResponse with solar return positions, houses, aspects, and AI summary.

    Raises:
        HTTPException: If target_year precedes birth_year or calculation fails.
    """
    return _build_solar_return_response(request)


@router.post("/solar-return/stream")
async def get_solar_return_stream(payload: SolarReturnRequest, request: Request):
    """Stream solar return calculation with real-time AI summary generation.

    Calculates the solar return and streams the AI interpretation incrementally.

    Args:
        payload: SolarReturnRequest with birth data and target year.
        request: FastAPI Request with user authentication context.

    Returns:
        StreamingResponse with SSE events: "meta", "done", "summary_delta",
        "saved", and "error".

    Raises:
        HTTPException: If not authenticated, rate limited, or calculation fails.
    """
    cached_summary = None
    provider = None
    try:
        result = _build_solar_return_response(payload)
        response_data = result.model_dump()
        summary_prompt = response_data.pop("summary")
        if summary_prompt:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_solar_return(request, payload)
            provider = get_chat_provider(role_type=role_name)
            cached_summary = provider.get_cached(summary_prompt, SOLAR_RETURN_SYSTEM_PROMPT)
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:solar-return')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Solar return stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error preparing /solar-return/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating solar return: {exc}")

    async def event_stream():
        if not summary_prompt:
            yield _sse_event("meta", response_data)
            yield _sse_event("done", {"summary": ""})
            return

        summary_parts = []

        yield _sse_event("meta", response_data)

        if cached_summary is not None:
            yield _sse_event("done", {"summary": cached_summary})
            if summary_prompt and user:
                try:
                    db = get_session()
                    try:
                        _interp_id = _istore.save_or_append_stream_result(
                            db,
                            user_id=user['id'],
                            interpretation_id=getattr(payload, 'interpretation_id', None),
                            user_question=getattr(payload, 'additional_question', None) or "",
                            query_content=summary_prompt or "",
                            assistant_content=cached_summary,
                            user_persons_id=getattr(payload, 'person_id', None),
                            context_type="solar",
                            model=provider.model_name,
                            interp_year=result.return_year,
                            interp_month=result.return_month,
                            interp_day=result.return_day,
                            interp_hour=None,
                            interp_minute=None,
                            location_latitude=getattr(payload, 'latitude', None),
                            location_longitude=getattr(payload, 'longitude', None),
                        )
                        yield _sse_event("saved", {"interpretation_id": _interp_id})
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save cached interpretation for solar")
            return

        try:
            async for chunk in provider.stream_completion(
                summary=summary_prompt,
                system_prompt=SOLAR_RETURN_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            if not summary_parts:
                try:
                    text = await asyncio.to_thread(
                        provider.chat_completion,
                        summary_prompt,
                        SOLAR_RETURN_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                except Exception:
                    logger.exception("Synchronous fallback to chat_completion failed for solar return")

            full_summary = "".join(summary_parts)
            try:
                provider.cache_result(summary_prompt, SOLAR_RETURN_SYSTEM_PROMPT, full_summary)
            except Exception:
                logger.exception("Failed to set cache for solar return")

            yield _sse_event("done", {"summary": full_summary})
            try:
                db = get_session()
                try:
                    _interp_id = _istore.save_or_append_stream_result(
                        db,
                        user_id=user['id'],
                        interpretation_id=getattr(payload, 'interpretation_id', None),
                        user_question=getattr(payload, 'additional_question', None) or "",
                        query_content=summary_prompt or "",
                        assistant_content=full_summary,
                        user_persons_id=getattr(payload, 'person_id', None),
                        context_type="solar",
                        model=provider.model_name,
                        interp_year=result.return_year,
                        interp_month=result.return_month,
                        interp_day=result.return_day,
                        interp_hour=None,
                        interp_minute=None,
                        location_latitude=getattr(payload, 'latitude', None),
                        location_longitude=getattr(payload, 'longitude', None),
                    )
                    yield _sse_event("saved", {"interpretation_id": _interp_id})
                finally:
                    db.close()
            except Exception:
                logger.exception("Failed to save interpretation after solar stream")
        except Exception as exc:
            logger.exception("Error streaming /solar-return/stream")
            yield _sse_event("error", {"detail": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/solar-return/graphic")
def get_solar_return_graphic(
    payload: SolarReturnRequest,
    request: Request,
    width: int = Query(600, gt=0),
    height: int = Query(600, gt=0),
):
    """Render the solar return chart as a PNG graphic.

    Args:
        payload: SolarReturnRequest with birth data and target year.
        request: FastAPI Request.
        width: Image width in pixels (must be > 0).
        height: Image height in pixels (must be > 0).

    Returns:
        PNG image of the solar return chart.
    """
    base = _build_solar_return_response(payload)
    chart = Chart()
    planets_sorted = sorted(base.planets, key=lambda p: p.planet_id)
    planets_for_chart = [p.longitude for p in planets_sorted]
    if len(planets_for_chart) < 13:
        # Pad to 13 entries so the Astronex renderer always sees the expected planet count
        planets_for_chart.extend([0.0] * (13 - len(planets_for_chart)))
    chart.planets = planets_for_chart[:13]
    houses_list = base.houses or [None] * 12
    chart.houses = list(houses_list)
    chart.latitud = payload.latitude
    chart.longitud = payload.longitude
    chart.zone = payload.timezone or 'UTC'
    chart.city = ''
    chart.region = ''
    chart.country = ''
    chart.first = 'Solar Return'
    chart.last = str(base.return_year)
    hour_value = base.return_hour or 0.0
    hour_int = int(hour_value)
    minute = int((hour_value - hour_int) * 60)
    second = int(round(((hour_value - hour_int) * 60 - minute) * 60))
    if second == 60:
        second = 0
        minute += 1
    if minute == 60:
        minute = 0
        hour_int = (hour_int + 1) % 24
    chart.date = (
        f"{base.return_year:04d}-{base.return_month:02d}-{base.return_day:02d}T"
        f"{hour_int:02d}:{minute:02d}:{second:02d}+0000UTC"
    )
    png = draw_chart_png(
        request.app,
        chart,
        width=width,
        height=height,
        operation='solar_rev',
    )
    return Response(content=png, media_type='image/png')

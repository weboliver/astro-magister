from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
import json
import logging
from app.services.ephemeris import julday, calc_ut, houses

logger = logging.getLogger(__name__)
from app import config as app_config
from app.schemas.datetime_models import DateTimeRequest
from app.schemas.datetime_models import PlanetPosition, Aspect, SolarReturnResponse
from app.services.horoscope_graphics import build_chart_from_request, draw_chart_png
from app.services.planet_names import get_planet_name
from app.services.planet_positions import calculate_api_planet_entries
from app.services.perplexity import PerplexityClient, _make_cache_key, _cache_set, append_additional_question
import asyncio
from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.services.auth import is_poweruser
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate
from app.static.aspect_names import get_aspect_english_by_index
from app.static.texte import get_general_anweisung
from app.static.zodiac_names import get_zodiac_name
import astronex.chart as chart_module
from astronex.chart import Chart
from astronex.config import ORBS as CONFIG_ORBS
from pytz import timezone as pytz_timezone
try:
    from timezonefinder import TimezoneFinder
except Exception as e:
    logger.debug(f"TimezoneFinder not available: {e}")
    TimezoneFinder = None

router = APIRouter(tags=["horoscope"], dependencies=[Depends(require_authenticated_user)])

HOROSCOPE_SYSTEM_PROMPT = (
    "horoskop"
)


def _resolve_role_name_for_horoscope(request: Request, payload: DateTimeRequest) -> str:
    """Resolve the role name for horoscope generation based on user and payload.

    Args:
        request: FastAPI Request with user context.
        payload: DateTimeRequest with birth data and optional person_id.

    Returns:
        Role name string (e.g. "Laie" for anonymous, or subject role for authenticated).
    """
    user = _get_user_from_request(request)
    if not user:
        return "Laie"
    return auth_service.get_role_name_for_subject(user['id'], getattr(payload, 'person_id', None))


def _normalize_diff(target: float, current: float) -> float:
    """Normalize the difference between two angles to range [-180, 180].

    Args:
        target: Target longitude in degrees.
        current: Current longitude in degrees.

    Returns:
        Normalized difference in degrees in range [-180, 180].
    """
    return (target - current + 540.0) % 360.0 - 180.0


def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Events message.

    Args:
        event: Event type string (e.g. "meta", "done", "summary_delta").
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string with event name and JSON data.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_horoscope_response_data(request: DateTimeRequest) -> dict:
    """Build the response data for horoscope calculation.

    Computes planetary positions, aspects, houses, and generates the summary
    prompt for AI interpretation based on birth data and location.

    Args:
        request: DateTimeRequest with year, month, day, hour, minute, second,
            latitude, longitude, and optional timezone and person_id.

    Returns:
        Dictionary containing target_year, return_year, return_month, return_day,
        return_hour, julian_day, natal_sun_longitude, solar_return_longitude,
        longitude_difference, iterations, planets (list), houses (list),
        aspects (list), and summary_prompt (str).
    """
    # Ensure Swiss Ephemeris search path is initialized (covers import-order races)
    try:
        app_config.init_swisseph_path()
    except Exception as e:
        logger.debug(f"Swiss Ephemeris init failed: {e}")
    # compute decimal hour in UT
    decimal_hour = request.hour + request.minute / 60.0 + request.second / 3600.0
    if getattr(request, 'timezone', None):
        try:
            local_dt = pytz_timezone(request.timezone).localize(
                __import__('datetime').datetime(
                    request.year, request.month, request.day,
                    request.hour, request.minute, request.second
                ), is_dst=True
            )
            ut = local_dt.astimezone(pytz_timezone('UTC'))
            decimal_hour = ut.hour + ut.minute / 60.0 + ut.second / 3600.0
        except Exception:
            pass

    jd = julday(request.year, request.month, request.day, decimal_hour)
    birth = f"{request.year:04d}-{request.month:02d}-{request.day:02d}"

    planet_list = []
    for entry in calculate_api_planet_entries(jd, calc_ut, epheflag=4):
        lon = entry['longitude']
        sign_idx = int(lon // 30) % 12
        deg_in_sign = lon - sign_idx * 30
        minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
        sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
        planet_list.append({
            'planet_id': entry['planet_id'],
            'planet_name': entry['planet_name'],
            'longitude': lon,
            'sign_index': sign_idx,
            'sign': get_zodiac_name(sign_idx) if sign_idx is not None else None,
            'sign_degree': sign_deg,
        })

    if not getattr(chart_module, 'orbs', None):
        chart_module.orbs.extend([
            CONFIG_ORBS['lum'], CONFIG_ORBS['normal'], CONFIG_ORBS['short'], CONFIG_ORBS['far'], CONFIG_ORBS['useless']
        ])

    chart = Chart()
    chart.planets = [p['longitude'] for p in planet_list]
    try:
        raw_aspects = chart.aspects()
    except Exception as e:
        logger.warning(f"Chart aspects calculation failed: {e}")
        raw_aspects = []
        pl = chart.planets[:]
        for i in range(len(pl)):
            for j in range(i + 1, len(pl)):
                dis = abs(pl[i] - pl[j])
                if dis > 180.0:
                    dis = 360.0 - dis
                a = int(round(dis / 30.0)) % 12
                raw_aspects.append({"p1": i, "p2": j, "a": a, "f1": None, "f2": None, "gw": False})

    aspects = []
    planames = getattr(chart_module, 'planames', None)
    for asp in raw_aspects:
        p1 = asp.get('p1')
        p2 = asp.get('p2')
        a = int(asp.get('a', 0)) if asp.get('a') is not None else 0
        label = get_aspect_english_by_index(a)
        sep = None
        try:
            pl = chart.planets
            sep = abs(pl[p1] - pl[p2])
            if sep > 180.0:
                sep = 360.0 - sep
        except Exception:
            sep = None

        try:
            if isinstance(p1, int) and p1 < len(planet_list):
                n1 = planet_list[p1].get('planet_name')
            else:
                n1 = planames[p1] if planames and isinstance(p1, int) and p1 < len(planames) else str(p1)
        except Exception:
            n1 = str(p1)
        try:
            if isinstance(p2, int) and p2 < len(planet_list):
                n2 = planet_list[p2].get('planet_name')
            else:
                n2 = planames[p2] if planames and isinstance(p2, int) and p2 < len(planames) else str(p2)
        except Exception:
            n2 = str(p2)

        aspects.append({
            'p1': p1,
            'p2': p2,
            'p1_name': n1,
            'p2_name': n2,
            'a': a,
            'f1': asp.get('f1'),
            'f2': asp.get('f2'),
            'gw': bool(asp.get('gw', False)),
            'label': label,
            'separation': sep
        })

    latitude = request.latitude
    longitude = request.longitude
    houses_list = houses(jd, latitude, longitude) or [None] * 12
    chart.houses = list(houses_list)
    for p in planet_list:
        try:
            idx = chart.which_house(p['longitude'])
            p['house_index'] = idx
            p['house'] = chart.house_label(idx)
            try:
                cusp = chart.houses[idx]
                deg_from_cusp = (p['longitude'] - cusp) % 360.0
                if deg_from_cusp < 0:
                    deg_from_cusp += 360.0
                deg_int = int(deg_from_cusp)
                minutes = int((deg_from_cusp - deg_int) * 60)
                p['house_degree'] = f"{deg_int:02d}\u00b0 {minutes:02d}\u2032"
            except Exception:
                p['house_degree'] = None
        except Exception:
            p['house_index'] = None
            p['house'] = None
            p['house_degree'] = None

    try:
        cusp_parts = []
        try:
            def _fmt_lon(lon):
                if lon is None:
                    return None
                si = int(lon // 30) % 12
                deg_in = lon - si * 30
                minutes = int((deg_in - int(deg_in)) * 60)
                sign_deg = f"{int(deg_in):02d}\u00b0 {minutes:02d}\u2032"
                return (si, get_zodiac_name(si), sign_deg, lon)

            ac = houses_list[0] if houses_list and len(houses_list) > 0 else None
            ic = houses_list[3] if houses_list and len(houses_list) > 3 else None
            dc = houses_list[6] if houses_list and len(houses_list) > 6 else None
            mc = houses_list[9] if houses_list and len(houses_list) > 9 else None
            for label, lon in (("AC", ac), ("IC", ic), ("DC", dc), ("MC", mc)):
                formatted = _fmt_lon(lon)
                if formatted:
                    _, sign_name, sign_deg, raw = formatted
                    cusp_parts.append(f"{label}: {sign_name} {sign_deg} ({raw:.2f}\u00b0)")
        except Exception:
            cusp_parts = []

        planet_parts = []
        for p in planet_list:
            pname = p.get('planet_name')
            house = p.get('house') or 'unknown'
            house_deg = p.get('house_degree')
            sign = p.get('sign')
            sign_deg = p.get('sign_degree')
            if house_deg:
                house_text = f"{house} ({house_deg})"
            else:
                house_text = str(house)
            if sign:
                planet_parts.append(f"{pname} in house {house_text} ({sign} {sign_deg})")
            else:
                planet_parts.append(f"{pname} in house {house_text}")

        aspect_parts = []
        for a in aspects:
            p1 = a.get('p1')
            p2 = a.get('p2')
            label = a.get('label')
            try:
                n1 = a.get('p1_name') or (planames[p1] if planames and isinstance(p1, int) and p1 < len(planames) else str(p1))
                n2 = a.get('p2_name') or (planames[p2] if planames and isinstance(p2, int) and p2 < len(planames) else str(p2))
            except Exception:
                n1 = str(p1)
                n2 = str(p2)
            aspect_parts.append(f"{n1} to {n2} / {label}")

        summary_prompt = f"Huber Astrologische Psychologie.\n\nInterpretiere Horoskop: {birth} folgendermaßen.\n\n"
        if cusp_parts:
            summary_prompt += "Erstelle ein Liste aller Häuserspitzen mit Erklärung:\n\n"
            summary_prompt += "; ".join(cusp_parts) + "\n\n"
            summary_prompt += "Erstelle eine Liste aller Planeten im Haus mit Erklärung:\n\n"
            summary_prompt += "; ".join(planet_parts)
            summary_prompt += ".\n\nErstelle eine Liste aller Aspekte mit Erklärung:\n\n"
            summary_prompt += "; ".join(aspect_parts)
            summary_prompt += "\n\nErstelle eine Themenachsen Bündelung bzgl. der Häuserspitzen."
            summary_prompt += "\n\n" + get_general_anweisung()
    except Exception:
        summary_prompt = ""

    planet_models = []
    for p in planet_list:
        planet_models.append(PlanetPosition(
            planet_id=p['planet_id'],
            planet_name=p['planet_name'],
            longitude=p['longitude'],
            house_index=p.get('house_index'),
            house=p.get('house'),
            house_degree=p.get('house_degree'),
            sign_index=p.get('sign_index'),
            sign=p.get('sign'),
            sign_degree=p.get('sign_degree'),
        ).model_dump())

    natal_sun_longitude = None
    for p in planet_list:
        if p.get('planet_id') == 0:
            natal_sun_longitude = p.get('longitude')
            break

    return {
        'target_year': request.year,
        'return_year': request.year,
        'return_month': request.month,
        'return_day': request.day,
        'return_hour': decimal_hour,
        'julian_day': jd,
        'natal_sun_longitude': natal_sun_longitude or 0.0,
        'solar_return_longitude': natal_sun_longitude or 0.0,
        'longitude_difference': 0.0,
        'iterations': 0,
        'planets': planet_models,
        'houses': list(houses_list) if houses_list else [None] * 12,
        'aspects': aspects,
        'summary_prompt': append_additional_question(summary_prompt, getattr(request, 'additional_question', None)),
    }


@router.post("/horoscope")
def get_horoscope(payload: DateTimeRequest, request: Request):
    """Generate a complete horoscope interpretation for the given birth data.

    Args:
        payload: DateTimeRequest with birth date, time, and location.
        request: FastAPI Request with user authentication context.

    Returns:
        JSONResponse with SolarReturnResponse containing planets, houses,
        aspects, and summary (AI interpretation text).

    Raises:
        HTTPException: If not authenticated, not a power user (for AI interpretation),
            rate limited, or calculation fails.
    """
    try:
        response_data = _build_horoscope_response_data(payload)
        summary = response_data['summary_prompt'] or ''
        if response_data['summary_prompt']:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_horoscope(request, payload)
            if user and not is_poweruser(user['id']):
                raise HTTPException(
                    status_code=403,
                    detail='KI-Interpretation ist Mitgliedern mit Spenderstatus vorbehalten. Bitte unterstützen Sie uns über Buy me a coffee: https://buymeacoffee.com/shinengakic',
                )
            perplexityClient = PerplexityClient(role_type=role_name)
            cached_summary = perplexityClient.get_cached_summary(
                summary=response_data['summary_prompt'],
                system_prompt="horoskop",
            )
            if cached_summary is not None:
                summary = cached_summary
            else:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:horoscope')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Horoscope interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
                summary = perplexityClient.send_summary_text(
                    summary=response_data['summary_prompt'],
                    system_prompt="horoskop",
                )

        response_obj = SolarReturnResponse(
            target_year=response_data['target_year'],
            return_year=response_data['return_year'],
            return_month=response_data['return_month'],
            return_day=response_data['return_day'],
            return_hour=response_data['return_hour'],
            julian_day=response_data['julian_day'],
            natal_sun_longitude=response_data['natal_sun_longitude'],
            solar_return_longitude=response_data['solar_return_longitude'],
            longitude_difference=response_data['longitude_difference'],
            iterations=response_data['iterations'],
            planets=response_data['planets'],
            houses=response_data['houses'],
            aspects=response_data['aspects'],
            summary=summary,
        )

        return JSONResponse(content=response_obj.model_dump())
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /horoscope")
        raise HTTPException(status_code=400, detail=f"Error calculating horoscope: {str(e)}")


@router.post("/horoscope/stream")
async def get_horoscope_stream(payload: DateTimeRequest, request: Request):
    """Stream a horoscope interpretation using Server-Sent Events.

    Computes the horoscope and streams the AI interpretation incrementally.

    Args:
        payload: DateTimeRequest with birth date, time, and location.
        request: FastAPI Request with user authentication context.

    Returns:
        StreamingResponse with SSE events: "meta", "done", "summary_delta",
        "saved", and "error".

    Raises:
        HTTPException: If not authenticated, rate limited, or calculation fails.
    """
    cached_summary = None
    perplexity_client = None
    try:
        response_data = _build_horoscope_response_data(payload)
        if response_data['summary_prompt']:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_horoscope(request, payload)
            perplexity_client = PerplexityClient(role_type=role_name)
            cached_summary = perplexity_client.get_cached_summary(
                summary=response_data['summary_prompt'],
                system_prompt=HOROSCOPE_SYSTEM_PROMPT,
            )
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:horoscope')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Horoscope stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error preparing /horoscope/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating horoscope: {str(e)}")

    async def event_stream():
        if not response_data['summary_prompt']:
            meta_payload = {key: value for key, value in response_data.items() if key != 'summary_prompt'}
            yield _sse_event("meta", meta_payload)
            yield _sse_event("done", {"summary": ""})
            return

        summary_parts = []
        meta_payload = {key: value for key, value in response_data.items() if key != 'summary_prompt'}

        yield _sse_event("meta", meta_payload)

        if cached_summary is not None:
            yield _sse_event("done", {"summary": cached_summary})
            if user:
                try:
                    db = get_session()
                    try:
                        _interp_id = _istore.save_or_append_stream_result(
                            db,
                            user_id=user['id'],
                            interpretation_id=getattr(payload, 'interpretation_id', None),
                            user_question=getattr(payload, 'additional_question', None) or "",
                            query_content=response_data['summary_prompt'] or "",
                            assistant_content=cached_summary,
                            user_persons_id=getattr(payload, 'person_id', None),
                            context_type="horoscope",
                            model=perplexity_client.model,
                            interp_year=payload.year,
                            interp_month=payload.month,
                            interp_day=payload.day,
                            interp_hour=getattr(payload, 'hour', None),
                            interp_minute=getattr(payload, 'minute', None),
                            location_latitude=getattr(payload, 'latitude', None),
                            location_longitude=getattr(payload, 'longitude', None),
                        )
                        yield _sse_event("saved", {"interpretation_id": _interp_id})
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save cached interpretation for horoscope")
            return

        try:
            async for chunk in perplexity_client.send_summary_stream(
                summary=response_data['summary_prompt'],
                system_prompt=HOROSCOPE_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            # If we didn't receive any streamed chunks, try a synchronous fallback
            if not summary_parts:
                try:
                    logger.debug("No streamed chunks received, invoking synchronous fallback")
                    text = await asyncio.to_thread(
                        perplexity_client.send_summary_text,
                        response_data['summary_prompt'],
                        HOROSCOPE_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                    logger.debug("Fallback returned length=%d", len(text))
                except Exception:
                    logger.exception("Synchronous fallback to send_summary_text failed")

            full_summary = "".join(summary_parts)
            logger.debug("Assembled full summary, length=%d", len(full_summary))
            # store the assembled summary in the cache for identical future requests
            try:
                resolved_prompt = perplexity_client._resolve_system_prompt(HOROSCOPE_SYSTEM_PROMPT)
                key = _make_cache_key(response_data['summary_prompt'], resolved_prompt, perplexity_client.model)
                _cache_set(key, full_summary)
                logger.debug("Wrote full summary to Perplexity cache key=%s", key[:16])
            except Exception:
                logger.exception("Failed to set Perplexity cache")

            yield _sse_event("done", {"summary": full_summary})
            try:
                db = get_session()
                try:
                    _interp_id = _istore.save_or_append_stream_result(
                        db,
                        user_id=user['id'],
                        interpretation_id=getattr(payload, 'interpretation_id', None),
                        user_question=getattr(payload, 'additional_question', None) or "",
                        query_content=response_data['summary_prompt'] or "",
                        assistant_content=full_summary,
                        user_persons_id=getattr(payload, 'person_id', None),
                        context_type="horoscope",
                        model=perplexity_client.model,
                        interp_year=payload.year,
                        interp_month=payload.month,
                        interp_day=payload.day,
                        interp_hour=getattr(payload, 'hour', None),
                        interp_minute=getattr(payload, 'minute', None),
                        location_latitude=getattr(payload, 'latitude', None),
                        location_longitude=getattr(payload, 'longitude', None),
                    )
                    yield _sse_event("saved", {"interpretation_id": _interp_id})
                finally:
                    db.close()
            except Exception:
                logger.exception("Failed to save interpretation after horoscope stream")
        except Exception as exc:
            logger.exception("Error streaming /horoscope/stream")
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


@router.post(
    "/horoscope/graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def get_horoscope_graphic(
    payload: DateTimeRequest,
    request: Request,
    width: int = Query(750, ge=200, le=2048, description="Image width in pixels"),
    height: int = Query(750, ge=200, le=2048, description="Image height in pixels"),
):
    """Render the natal horoscope as a PNG graphic using the Astronex drawing code."""

    try:
        chart = build_chart_from_request(payload)
        png_bytes = draw_chart_png(request.app, chart, width, height)
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error rendering horoscope graphic: {exc}")

"""Router for lunar node (Mondknoten) horoscope calculations and interpretation."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import json
import logging
import asyncio

from app.services.ephemeris import julday, calc_ut, houses
from app.static.zodiac_names import get_zodiac_name
from app.static.aspect_names import get_aspect_english_by_index
from app.services.planet_names import get_planet_name
from app.static.texte import get_general_anweisung
from app.services.perplexity import PerplexityClient, _make_cache_key, _cache_set, append_additional_question
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.datetime_models import DateTimeRequest, PlanetPosition
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.services import auth as auth_service
from app import config as app_config
from pytz import timezone as pytz_timezone
from app.services.planet_positions import calculate_api_planet_entries
from app.services.ephemeris import calc_ut as _calc_ut
from astronex.chart import Chart
from app.services.horoscope_graphics import build_chart_from_request, draw_chart_png
import astronex.chart as chart_module
from astronex.config import ORBS as CONFIG_ORBS

logger = logging.getLogger(__name__)

router = APIRouter(tags=["nodes"], dependencies=[Depends(require_authenticated_user)])

NODES_SYSTEM_PROMPT = "mondknoten"

_NODE_EPHE_ID = 10


def _resolve_role_name_for_nodes(request: Request, payload: DateTimeRequest) -> str:
    """Resolve the role name for lunar node interpretation based on user and payload.

    Args:
        request: FastAPI Request with user context.
        payload: DateTimeRequest with optional person_id.

    Returns:
        Role name string (e.g. "Laie" for anonymous, or subject role for authenticated).
    """
    user = _get_user_from_request(request)
    if not user:
        return "Laie"
    return auth_service.get_role_name_for_subject(user['id'], getattr(payload, 'person_id', None))


def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Events message.

    Args:
        event: Event type string (e.g. "meta", "done", "summary_delta").
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string with event name and JSON data.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _format_degree(lon: float) -> str:
    """Format ecliptic longitude as sign degree string.

    Args:
        lon: Ecliptic longitude in degrees.

    Returns:
        Formatted string like "15°23'".
    """
    sign_idx = int(lon // 30) % 12
    deg_in_sign = lon - sign_idx * 30
    minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
    return f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"


def _calculate_nodes_response(payload: DateTimeRequest) -> dict:
    """Calculate lunar node positions (Rahu/Ketu) for birth data.

    Args:
        payload: DateTimeRequest with birth date, time, and location.

    Returns:
        Dictionary containing julian_day, planets (list), summary_prompt (str).
    """
    try:
        app_config.init_swisseph_path()
    except Exception as e:
        logger.debug(f"Swiss Ephemeris init failed: {e}")

    decimal_hour = payload.hour + payload.minute / 60.0 + payload.second / 3600.0
    if getattr(payload, 'timezone', None):
        try:
            local_dt = pytz_timezone(payload.timezone).localize(
                __import__('datetime').datetime(
                    payload.year, payload.month, payload.day,
                    payload.hour, payload.minute, payload.second
                ), is_dst=True
            )
            ut = local_dt.astimezone(pytz_timezone('UTC'))
            decimal_hour = ut.hour + ut.minute / 60.0 + ut.second / 3600.0
        except Exception:
            pass

    jd = julday(payload.year, payload.month, payload.day, decimal_hour)
    birth = f"{payload.year:04d}-{payload.month:02d}-{payload.day:02d}"

    flags, rahu_lon, error = calc_ut(jd, _NODE_EPHE_ID, 4)
    if error:
        raise HTTPException(status_code=400, detail=f"Lunar node calculation error: {error}")

    ketu_lon = (rahu_lon + 180.0) % 360.0

    houses_list = houses(jd, payload.latitude, payload.longitude) or [None] * 12
    chart = Chart()
    chart.houses = list(houses_list)

    def _get_node_info(lon: float, planet_id: int, planet_name: str) -> dict:
        sign_idx = int(lon // 30) % 12
        sign_deg = _format_degree(lon)
        try:
            idx = chart.which_house(lon)
            house_label = chart.house_label(idx)
            cusp = chart.houses[idx]
            deg_from_cusp = (lon - cusp) % 360.0
            if deg_from_cusp < 0:
                deg_from_cusp += 360.0
            deg_int = int(deg_from_cusp)
            minutes_h = int((deg_from_cusp - deg_int) * 60)
            house_degree = f"{deg_int:02d}\u00b0 {minutes_h:02d}\u2032"
        except Exception:
            house_label = None
            house_degree = None
            idx = None

        return {
            'planet_id': planet_id,
            'planet_name': planet_name,
            'longitude': lon,
            'sign_index': sign_idx,
            'sign': get_zodiac_name(sign_idx) if sign_idx is not None else None,
            'sign_degree': sign_deg,
            'house_index': idx,
            'house': house_label,
            'house_degree': house_degree,
        }

    rahu_info = _get_node_info(rahu_lon, 10, "Mondknoten")
    ketu_info = _get_node_info(ketu_lon, 13, "Südknoten")

    planets_entries = []
    for planet_id in range(10):
        flags_p, lon_p, err_p = _calc_ut(jd, planet_id, 4)
        if err_p or flags_p < 0:
            continue
        sign_idx_p = int(lon_p // 30) % 12
        sign_deg_p = _format_degree(lon_p)
        try:
            idx_p = chart.which_house(lon_p)
            house_label_p = chart.house_label(idx_p)
        except Exception:
            house_label_p = None
        planets_entries.append({
            'planet_id': planet_id,
            'planet_name': get_planet_name(planet_id),
            'longitude': lon_p,
            'sign_index': sign_idx_p,
            'sign': get_zodiac_name(sign_idx_p),
            'sign_degree': sign_deg_p,
            'house': house_label_p,
        })

    chart.planets = [entry['longitude'] for entry in planets_entries]
    chart.planets.append(rahu_lon)
    chart.planets.append(ketu_lon)

    mirrored_planets = chart.urnodplan()

    mirrored_entries = []
    for i, lon_m in enumerate(mirrored_planets):
        if i >= 10:
            break
        radix_entry = planets_entries[i]
        sign_deg_m = radix_entry['sign_degree']
        try:
            idx_m = chart.which_house(lon_m)
            house_num = chart.house_label(idx_m)
        except Exception:
            house_num = None
        mirrored_entries.append({
            'planet_id': i,
            'planet_name': get_planet_name(i),
            'longitude': lon_m,
            'sign': radix_entry['sign'],
            'sign_degree': sign_deg_m,
            'house': house_num,
        })

    chart.planets = mirrored_planets[:10]
    chart.planets.append(rahu_lon)
    chart.planets.append(ketu_lon)
    if not getattr(chart_module, 'orbs', None):
        chart_module.orbs.extend([
            CONFIG_ORBS['lum'], CONFIG_ORBS['normal'], CONFIG_ORBS['short'], CONFIG_ORBS['far'], CONFIG_ORBS['useless']
        ])
    try:
        raw_aspects = chart.aspects()
    except Exception:
        raw_aspects = []

    aspects_list = []
    planames_chart = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
    for asp in raw_aspects:
        p1 = asp.get('p1')
        p2 = asp.get('p2')
        a = int(asp.get('a', 0)) if asp.get('a') is not None else 0
        label = get_aspect_english_by_index(a)
        try:
            n1 = planames_chart[p1] if isinstance(p1, int) and p1 < len(planames_chart) else str(p1)
            n2 = planames_chart[p2] if isinstance(p2, int) and p2 < len(planames_chart) else str(p2)
        except Exception:
            n1 = str(p1)
            n2 = str(p2)
        aspects_list.append(f"{n1}-{label}-{n2}")

    rahu_sign = rahu_info['sign'] or 'unbekannt'
    rahu_deg = rahu_info['sign_degree'] or ''
    rahu_house = rahu_info['house'] if rahu_info['house'] is not None else 'unbekannt'
    rahu_house_deg = rahu_info['house_degree'] or ''

    ketu_sign = ketu_info['sign'] or 'unbekannt'
    ketu_deg = ketu_info['sign_degree'] or ''
    ketu_house = ketu_info['house'] if ketu_info['house'] is not None else 'unbekannt'
    ketu_house_deg = ketu_info['house_degree'] or ''

    planets_str = "; ".join([f"{p['planet_name']} in {p['sign']} {p['sign_degree']} (Haus {p['house'] or 'unbekannt'})" for p in mirrored_entries])
    aspects_str = "; ".join(aspects_list) if aspects_list else "keine"

    summary_prompt = f"""Huber Astrologische Psychologie.

Interpretiere das Mondknoten Horoskop: {birth}.

Mondknoten (North Node): {rahu_sign} ({rahu_deg}) / Haus {rahu_house} ({rahu_house_deg})
Südknoten (South Node): {ketu_sign} ({ketu_deg}) / Haus {ketu_house} ({ketu_house_deg})

Planeten (gespiegelt): {planets_str}

Aspekte (gespiegelt): {aspects_str}

Der Mondknoten zeigt den Lebensweg und die karmischen Themen.
Der Südknoten zeigt die Themen der Vergangenheit und des Loslassens.

Erstelle eine detaillierte Interpretation:
1. Die Position des Mondknotens in Zeichen und Haus - was bringt der Lebensweg?
2. Die Position des Südnotens - welche Themen sollen transformiert werden?
3. Die Achse Mondknoten-Südknoten und ihre Bedeutung für die persönliche Entwicklung
4. Karmische und spirituelle Aspekte der Konstellation

Erstelle eine Liste der wichtigsten astrologischen Themen.
(Keine Meta Information, nur die Interpretation. Verwende eine klare und verständliche Sprache)

{get_general_anweisung()}"""

    summary_prompt = append_additional_question(summary_prompt, getattr(payload, 'additional_question', None))

    return {
        'julian_day': jd,
        'planets': [rahu_info, ketu_info],
        'summary_prompt': summary_prompt,
    }


@router.post("/nodes/stream")
async def get_nodes_stream(payload: DateTimeRequest, request: Request):
    """Stream lunar node (Rahu/Ketu) positions with AI interpretation via SSE.

    Calculates lunar node positions and streams the AI interpretation incrementally.

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
        response_data = _calculate_nodes_response(payload)
        if response_data['summary_prompt']:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_nodes(request, payload)
            perplexity_client = PerplexityClient(role_type=role_name)
            cached_summary = perplexity_client.get_cached_summary(
                response_data['summary_prompt'],
                NODES_SYSTEM_PROMPT,
            )
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:nodes')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Nodes stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error preparing /nodes/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating lunar nodes: {str(e)}")

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
                            context_type="nodes",
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
                    logger.exception("Failed to save cached interpretation for nodes")
            return

        try:
            async for chunk in perplexity_client.send_summary_stream(
                summary=response_data['summary_prompt'],
                system_prompt=NODES_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            if not summary_parts:
                try:
                    logger.debug("No streamed chunks received, invoking synchronous fallback for nodes")
                    text = await asyncio.to_thread(
                        perplexity_client.send_summary_text,
                        response_data['summary_prompt'],
                        NODES_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                    logger.debug("Fallback returned length=%d", len(text))
                except Exception:
                    logger.exception("Synchronous fallback to send_summary_text failed for nodes")

            full_summary = "".join(summary_parts)
            logger.debug("Assembled full nodes summary, length=%d", len(full_summary))
            try:
                resolved_prompt = perplexity_client._resolve_system_prompt(NODES_SYSTEM_PROMPT)
                key = _make_cache_key(response_data['summary_prompt'], resolved_prompt, perplexity_client.model)
                _cache_set(key, full_summary)
                logger.debug("Wrote full nodes summary to cache key=%s", key[:16])
            except Exception:
                logger.exception("Failed to set Perplexity cache for nodes")

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
                        context_type="nodes",
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
                logger.exception("Failed to save interpretation after nodes stream")
        except Exception as exc:
            logger.exception("Error streaming /nodes/stream")
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
    "/nodes/graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def get_nodes_graphic(
    payload: DateTimeRequest,
    request: Request,
    width: int = Query(750, ge=200, le=2048, description="Image width in pixels"),
    height: int = Query(750, ge=200, le=2048, description="Image height in pixels"),
):
    """Render the lunar node (Mondknoten) chart as a PNG graphic using draw_ur_nodal operation."""

    try:
        chart = build_chart_from_request(payload)
        png_bytes = draw_chart_png(request.app, chart, width, height, operation='draw_ur_nodal')
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error rendering nodes graphic: {exc}")
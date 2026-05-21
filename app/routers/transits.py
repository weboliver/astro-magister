from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
import asyncio
import json
import logging
logger = logging.getLogger(__name__)
from app.services.ephemeris import julday, planets, houses
from astronex.chart import zodnames, planames, Chart, aspnames, planclass, aspclass, orbs
from app.services.planet_names import get_planet_name
from app.static.aspect_names import get_aspect_english_by_index
from app.static.zodiac_names import get_zodiac_name
from astronex.config import ORBS as CONFIG_ORBS
from datetime import datetime
from pytz import timezone as pytz_timezone
from app.services.horoscope_graphics import build_chart_from_request, draw_chart_png
from app.services.astro_env import ensure_astro_env
from app.schemas.datetime_models import DateTimeRequest
from app.static.texte import get_general_anweisung
from app.services.providers import get_chat_provider
from app.services.perplexity import append_additional_question
from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.schemas.transits import *
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate


router = APIRouter(tags=["transits"], dependencies=[Depends(require_authenticated_user)])
logger = logging.getLogger(__name__)

TRANSITS_SYSTEM_PROMPT = "transits"


def _resolve_role_name_for_transits(request: Request, payload: TransitRequest) -> str:
    """Resolve role name for transits interpretation.

    Args:
        request: FastAPI request.
        payload: TransitRequest with optional person_id.

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


def _to_datetime_request(date_obj: DateObject, location: Location) -> DateTimeRequest:
    """Convert transit request pieces into a DateTimeRequest for graphics helper.

    Args:
        date_obj: DateObject with birth/transit date.
        location: Location with latitude and longitude.

    Returns:
        DateTimeRequest for graphics calculation.
    """
    return DateTimeRequest(
        year=date_obj.year,
        month=date_obj.month,
        day=date_obj.day,
        hour=date_obj.hour,
        minute=date_obj.minute,
        second=date_obj.second,
        timezone=date_obj.timezone,
        latitude=location.latitude,
        longitude=location.longitude,
    )


def _decimal_hour(dt: DateObject):
    """Convert DateObject to decimal hour.

    Args:
        dt: DateObject with hour, minute, second.

    Returns:
        Decimal hour as float.
    """
    return dt.hour + dt.minute / 60.0 + dt.second / 3600.0


def _to_utc_components(dt: DateObject):
    try:
        local_dt = datetime(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
        if dt.timezone:
            local_dt = pytz_timezone(dt.timezone).localize(local_dt, is_dst=True)
            local_dt = local_dt.astimezone(pytz_timezone('UTC'))
        return (
            local_dt.year,
            local_dt.month,
            local_dt.day,
            local_dt.hour + local_dt.minute / 60.0 + local_dt.second / 3600.0,
        )
    except Exception as e:
        logger.warning(f"Failed to parse local datetime, using UTC: {e}")
        return (dt.year, dt.month, dt.day, _decimal_hour(dt))

def _planet_entries(jd, lat, lon):
    from app.services.ephemeris import calc
    from app.services.planet_positions import calculate_api_planet_entries
    planet_entries = calculate_api_planet_entries(jd, calc, epheflag=4)
    if not planet_entries:
        raise HTTPException(status_code=500, detail="Fehler beim Berechnen der Planeten")
    pls = [entry.get('longitude') for entry in planet_entries]

    hs = houses(jd, lat, lon) or [None] * 12
    out = []
    chart = Chart()
    try:
        chart.houses = list(hs) if hs else [None] * 12
    except Exception as e:
        logger.warning(f"Failed to calculate houses, using defaults: {e}")
        chart.houses = [None] * 12
    for ix, entry in enumerate(planet_entries):
        lon_val = entry.get('longitude')
        sign_idx = int(lon_val // 30) % 12
        deg_in_sign = lon_val - sign_idx * 30
        minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
        sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
        hidx = None
        hlabel = None
        house_deg = None
        try:
            hidx = chart.which_house(lon_val)
            hlabel = chart.house_label(hidx)
            cusp = chart.houses[hidx]
            deg_from_cusp = (lon_val - cusp) % 360.0
            if deg_from_cusp < 0:
                deg_from_cusp += 360.0
            deg_int = int(deg_from_cusp)
            minutes_h = int((deg_from_cusp - deg_int) * 60)
            house_deg = f"{deg_int:02d}\u00b0 {minutes_h:02d}\u2032"
        except Exception as e:
            logger.debug(f"Failed to calculate house degree: {e}")
            hidx = None
            hlabel = None
            house_deg = None
        out.append(
            {
                "planet_id": entry.get('planet_id', ix),
                "planet_name": entry.get('planet_name') or get_planet_name(entry.get('planet_id', ix)),
                "longitude": lon_val,
                "sign_index": sign_idx,
                "sign": get_zodiac_name(sign_idx) if sign_idx is not None else None,
                "sign_degree": sign_deg,
                "house_index": hidx,
                "house": hlabel,
                "house_degree": house_deg,
            }
        )
    return out


def _build_transits_response(req: TransitRequest, request: Request) -> TransitResponse:
    b = req.birthday
    t = req.transitdate
    env = ensure_astro_env(request.app)
    birth_year, birth_month, birth_day, birth_hour = _to_utc_components(b)
    transit_year, transit_month, transit_day, transit_hour = _to_utc_components(t)
    jd_birth = julday(birth_year, birth_month, birth_day, birth_hour)
    jd_transit = julday(transit_year, transit_month, transit_day, transit_hour)

    natal = _planet_entries(jd_birth, req.birth_location.latitude, req.birth_location.longitude)
    transit = _planet_entries(jd_transit, req.transit_location.latitude, req.transit_location.longitude)

    # ensure each natal planet also records its natal-house fields in the cross-chart slots
    for p in natal:
        try:
            p['house_at_natal_index'] = p.get('house_index')
            p['house_at_natal'] = p.get('house')
            p['house_at_natal_degree'] = p.get('house_degree')
        except Exception as e:
            logger.debug(f"Failed to set natal house fields: {e}")
            p['house_at_natal_index'] = None
            p['house_at_natal'] = None
            p['house_at_natal_degree'] = None

    # ensure each transit planet also records its transit-house fields in the cross-chart slots
    for p in transit:
        try:
            p['house_at_transit_index'] = p.get('house_index')
            p['house_at_transit'] = p.get('house')
            p['house_at_transit_degree'] = p.get('house_degree')
        except Exception as e:
            logger.debug(f"Failed to set transit house fields: {e}")
            p['house_at_transit_index'] = None
            p['house_at_transit'] = None
            p['house_at_transit_degree'] = None

    # compute houses lists for cross-checking
    try:
        transit_houses = houses(jd_transit, req.transit_location.latitude, req.transit_location.longitude) or [None] * 12
    except Exception as e:
        logger.warning(f"Failed to calculate transit houses: {e}")
        transit_houses = [None] * 12
    try:
        natal_houses = houses(jd_birth, req.birth_location.latitude, req.birth_location.longitude) or [None] * 12
    except Exception as e:
        logger.warning(f"Failed to calculate natal houses: {e}")
        natal_houses = [None] * 12

    # annotate natal planets with their house in the transit chart
    try:
        th_chart = Chart()
        th_chart.houses = list(transit_houses)
        for p in natal:
            try:
                plon = p.get('longitude')
                hidx = th_chart.which_house(plon)
                hlab = th_chart.house_label(hidx)
                cusp = th_chart.houses[hidx]
                deg_from_cusp = (plon - cusp) % 360.0
                if deg_from_cusp < 0:
                    deg_from_cusp += 360.0
                di = int(deg_from_cusp)
                mi = int((deg_from_cusp - di) * 60)
                p['house_at_transit_index'] = hidx
                p['house_at_transit'] = hlab
                p['house_at_transit_degree'] = f"{di:02d}\u00b0 {mi:02d}\u2032"
            except Exception as e:
                logger.debug(f"Failed to calculate transit house: {e}")
                p['house_at_transit_index'] = None
                p['house_at_transit'] = None
                p['house_at_transit_degree'] = None
    except Exception as e:
        logger.debug(f"Failed to set transit house fields: {e}")

    # annotate transit planets with their house in the natal chart
    try:
        nh_chart = Chart()
        # ensure natal_houses look valid; if not, try recomputing
        try:
            valid = any(isinstance(x, (int, float)) for x in natal_houses)
        except Exception as e:
            logger.debug(f"Failed to validate natal houses: {e}")
            valid = False
        if not valid:
            try:
                natal_houses = houses(jd_birth, req.birth_location.latitude, req.birth_location.longitude) or [None] * 12
            except Exception as e:
                logger.warning(f"Failed to recompute natal houses: {e}")
                natal_houses = [None] * 12

        nh_chart.houses = list(natal_houses)
        for p in transit:
            plon = p.get('longitude')
            hidx = None
            try:
                hidx = nh_chart.which_house(plon)
            except Exception as e:
                logger.debug(f"Failed to get natal house: {e}")
                hidx = None

            if hidx is None or not (0 <= hidx < len(nh_chart.houses)):
                p['house_at_natal_index'] = None
                p['house_at_natal'] = None
                p['house_at_natal_degree'] = None
                continue

            cusp = nh_chart.houses[hidx]
            if cusp is None:
                p['house_at_natal_index'] = None
                p['house_at_natal'] = None
                p['house_at_natal_degree'] = None
                continue

            deg_from_cusp = (plon - cusp) % 360.0
            if deg_from_cusp < 0:
                deg_from_cusp += 360.0
            di = int(deg_from_cusp)
            mi = int((deg_from_cusp - di) * 60)
            p['house_at_natal_index'] = hidx
            p['house_at_natal'] = nh_chart.house_label(hidx)
            p['house_at_natal_degree'] = f"{di:02d}\u00b0 {mi:02d}\u2032"
    except Exception:
        pass

    # ensure chart.orbs populated (same as other routers) so orb lookups work
    try:
        if not orbs:
            orbs.extend([
                CONFIG_ORBS['lum'],
                CONFIG_ORBS['normal'],
                CONFIG_ORBS['short'],
                CONFIG_ORBS['far'],
                CONFIG_ORBS['useless'],
            ])
    except Exception:
        pass

    transit_orbs = []
    try:
        if env and hasattr(env.state, 'transits') and env.state.transits:
            transit_orbs = list(env.state.transits)
        else:
            transit_orbs = list(CONFIG_ORBS.get('transits', []))
    except Exception:
        transit_orbs = list(CONFIG_ORBS.get('transits', []))

    # compute aspects between each transit planet and each natal planet using configured orbs
    aspects = []
    # build filter sets (names lowercased and numeric ids) if requested
    filter_names = set()
    filter_ids = set()
    try:
        if req.filterplanets:
            for item in req.filterplanets:
                if item is None:
                    continue
                sval = str(item)
                # try numeric id
                try:
                    filter_ids.add(int(sval))
                except Exception:
                    filter_names.add(sval.lower())
    except Exception:
        filter_names = set()
        filter_ids = set()
    try:
        for ti, tplan in enumerate(transit):
            tlon = tplan.get('longitude')
            tname = tplan.get('planet_name')
            # check filter: if provided, skip transit planets not listed
            if req.filterplanets:
                allowed = False
                try:
                    if isinstance(tplan.get('planet_id'), int) and tplan.get('planet_id') in filter_ids:
                        allowed = True
                except Exception:
                    pass
                try:
                    if tname and tname.lower() in filter_names:
                        allowed = True
                except Exception:
                    pass
                if not allowed:
                    continue
            for ni, nplan in enumerate(natal):
                nlon = nplan.get('longitude')
                nname = nplan.get('planet_name')
                sep = abs(tlon - nlon)
                if sep > 180.0:
                    sep = 360.0 - sep
                nsig = int(sep // 30)
                orb = sep - nsig * 30
                if orb > 20.0:
                    nsig += 1
                    orb = 30.0 - orb
                aidx = nsig % 12
                label = get_aspect_english_by_index(aidx)

                # determine planclass indices for both planets using planet_id
                t_pid = tplan.get('planet_id')
                pc1 = planclass[t_pid] if isinstance(t_pid, int) and t_pid < len(planclass) else 0
                acl = aspclass[aidx] if aidx < len(aspclass) else 0
                orb1 = None
                orb2 = None
                gw = False
                within = False
                f1 = None
                f2 = None
                if orb <= 9.0:
                    if pc1 < len(orbs) and acl < len(orbs[pc1]):
                        orb1 = orbs[pc1][acl]
                    if ti < len(transit_orbs):
                        orb2 = transit_orbs[ti]
                    if orb2 and orb <= orb2:
                        if orb1 and orb1 > 0:
                            f1 = orb / orb1
                        if orb2 > 0:
                            f2 = orb / orb2
                        within = f2 is not None and f2 <= 1.0
                        aspects.append({
                            'transit_index': ti,
                            'transit_name': tname,
                            'p1': ti,
                            'p1_name': tname,
                            'transit_sign_index': tplan.get('sign_index'),
                            'transit_sign': tplan.get('sign'),
                            'transit_house_index': tplan.get('house_index'),
                            'transit_house': tplan.get('house'),
                            'transit_house_degree': tplan.get('house_degree'),
                            'natal_index': ni,
                            'natal_name': nname,
                            'p2': ni,
                            'p2_name': nname,
                            'natal_sign_index': nplan.get('sign_index'),
                            'natal_sign': nplan.get('sign'),
                            'natal_house_index': nplan.get('house_index'),
                            'natal_house': nplan.get('house'),
                            'natal_house_degree': nplan.get('house_degree'),
                            'aspect': label,
                            'separation': round(sep, 4),
                            'orb': round(orb, 4),
                            'f1': f1,
                            'f2': f2,
                            'gw': gw,
                            'within_orb': within,
                        })
    except Exception:
        aspects = []

    # group aspects according to request: by 'aspect' label or by transit planet
    grouped = {}
    mode = getattr(req, 'groupby', None) or 'aspect'
    mode = mode.lower() if isinstance(mode, str) else 'aspect'
    try:
        for a in aspects:
            if mode == 'planet':
                key = None
                if isinstance(a, dict):
                    key = a.get('transit_name') or f"planet_{a.get('transit_index', 'na')}"
                if not key:
                    key = 'unknown_planet'
            else:
                key = None
                if isinstance(a, dict):
                    key = a.get('aspect')
                if not key:
                    key = 'unknown'
            grouped.setdefault(key, []).append(a)
    except Exception:
        grouped = {}

    # build summary string
    summary = None
    try:
        if aspects:
            parts = []
            for a in aspects:
                # print("DEBUG: ", a.get('aspect'), a.get('transit_name'), a.get('transit_sign'), a.get('natal_name'), a.get('natal_house'), a.get('natal_house_degree'))
                asp = a.get('aspect') or ''
                # prefer p1/p2 name fields, fallback to transit/natal_name or numeric indices
                tname = a.get('p1_name') or a.get('transit_name') or (f"planet_{a.get('transit_index')}")
                nname = a.get('p2_name') or a.get('natal_name') or (f"planet_{a.get('natal_index')}")
                tsign = a.get('transit_sign') or ''
                thouse = a.get('natal_house') or ''
                thdeg = a.get('natal_house_degree') or ''
                parts.append(f"{asp} {tname} in {tsign} with {nname} in house: {thouse} ({thdeg})")
            summary = f"Huber Astrologische Psychologie.\n\nInterpretiere für Horoskop {birth_year}-{birth_month}-{birth_day}.\n\nTransite am: " + f"{t.year}-{t.month}-{t.day}:\n\n" + "\n".join(parts) + "\n\n" +\
                        get_general_anweisung()
    except Exception:
        summary = None

    return TransitResponse(
        aspects=aspects,
        grouped_aspects=grouped,
        summary=append_additional_question(summary, getattr(req, 'additional_question', None)),
    )


@router.post("/transits", response_model=TransitResponse)
def transits(req: TransitRequest, request: Request):
    """Calculate transit aspects between birth chart and transit date.

    Args:
        req: TransitRequest with birth date/location and transit date/location.
        request: FastAPI Request for auth context.

    Returns:
        TransitResponse with aspects, grouped aspects, and AI summary.
    """
    return _build_transits_response(req, request)


@router.post("/transits/stream")
async def transits_stream(req: TransitRequest, request: Request):
    """Stream transit calculation with real-time AI summary generation.

    Args:
        req: TransitRequest with birth and transit data.
        request: FastAPI Request for auth context.

    Returns:
        StreamingResponse with SSE events for transits and AI summary.
    """
    cached_summary = None
    provider = None
    try:
        result = _build_transits_response(req, request)
        response_data = result.model_dump()
        summary_prompt = response_data.pop("summary")
        if summary_prompt:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_transits(request, req)
            provider = get_chat_provider(role_type=role_name)
            cached_summary = provider.get_cached(summary_prompt, TRANSITS_SYSTEM_PROMPT)
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:transits')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Transit stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error preparing /transits/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating transits: {exc}")

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
                            interpretation_id=getattr(req, 'interpretation_id', None),
                            user_question=getattr(req, 'additional_question', None) or "",
                            query_content=summary_prompt or "",
                            assistant_content=cached_summary,
                            user_persons_id=getattr(req, 'person_id', None),
                            context_type="transits",
                            model=provider.model_name,
                            interp_year=req.transitdate.year,
                            interp_month=req.transitdate.month,
                            interp_day=req.transitdate.day,
                            interp_hour=req.transitdate.hour,
                            interp_minute=req.transitdate.minute,
                            location_latitude=req.birth_location.latitude,
                            location_longitude=req.birth_location.longitude,
                            transit_location_latitude=req.transit_location.latitude,
                            transit_location_longitude=req.transit_location.longitude,
                        )
                        yield _sse_event("saved", {"interpretation_id": _interp_id})
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save cached interpretation for transits")
            return

        try:
            async for chunk in provider.stream_completion(
                summary=summary_prompt,
                system_prompt=TRANSITS_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            if not summary_parts:
                try:
                    text = await asyncio.to_thread(
                        provider.chat_completion,
                        summary_prompt,
                        TRANSITS_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                except Exception:
                    logger.exception("Synchronous fallback to chat_completion failed for transits")

            full_summary = "".join(summary_parts)
            try:
                provider.cache_result(summary_prompt, TRANSITS_SYSTEM_PROMPT, full_summary)
            except Exception:
                logger.exception("Failed to set cache for transits")

            yield _sse_event("done", {"summary": full_summary})
            try:
                db = get_session()
                try:
                    _interp_id = _istore.save_or_append_stream_result(
                        db,
                        user_id=user['id'],
                        interpretation_id=getattr(req, 'interpretation_id', None),
                        user_question=getattr(req, 'additional_question', None) or "",
                        query_content=summary_prompt or "",
                        assistant_content=full_summary,
                        user_persons_id=getattr(req, 'person_id', None),
                        context_type="transits",
                        model=provider.model_name,
                        interp_year=req.transitdate.year,
                        interp_month=req.transitdate.month,
                        interp_day=req.transitdate.day,
                        interp_hour=req.transitdate.hour,
                        interp_minute=req.transitdate.minute,
                        location_latitude=req.birth_location.latitude,
                        location_longitude=req.birth_location.longitude,
                        transit_location_latitude=req.transit_location.latitude,
                        transit_location_longitude=req.transit_location.longitude,
                    )
                    yield _sse_event("saved", {"interpretation_id": _interp_id})
                finally:
                    db.close()
            except Exception:
                logger.exception("Failed to save interpretation after transits stream")
        except Exception as exc:
            logger.exception("Error streaming /transits/stream")
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
    "/transits/graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def transits_graphic(
    payload: TransitRequest,
    request: Request,
    width: int = Query(750, ge=200, le=2048, description="Image width in pixels"),
    height: int = Query(750, ge=200, le=2048, description="Image height in pixels"),
):
    """Render a transit chart graphic with natal and transit positions overlaid.

    Args:
        payload: TransitRequest with birth and transit data.
        request: FastAPI Request.
        width: Image width in pixels (200-2048).
        height: Image height in pixels (200-2048).

    Returns:
        PNG image of the transit chart.
    """

    try:
        birth_year, birth_month, birth_day, birth_hour = _to_utc_components(payload.birthday)
        transit_year, transit_month, transit_day, transit_hour = _to_utc_components(payload.transitdate)
        jd_birth = julday(birth_year, birth_month, birth_day, birth_hour)
        jd_transit = julday(transit_year, transit_month, transit_day, transit_hour)

        natal_req = _to_datetime_request(payload.birthday, payload.birth_location)
        transit_req = _to_datetime_request(payload.transitdate, payload.transit_location)
        natal_chart = build_chart_from_request(natal_req)
        transit_chart = build_chart_from_request(transit_req)

        try:
            natal_entries = _planet_entries(jd_birth, payload.birth_location.latitude, payload.birth_location.longitude)
            transit_entries = _planet_entries(jd_transit, payload.transit_location.latitude, payload.transit_location.longitude)
            if natal_entries and len(natal_entries) >= 11:
                natal_chart.planets = [entry.get('longitude') for entry in natal_entries]
            if transit_entries and len(transit_entries) >= 11:
                transit_chart.planets = [entry.get('longitude') for entry in transit_entries]
        except Exception:
            pass

        try:
            natal_houses = houses(jd_birth, payload.birth_location.latitude, payload.birth_location.longitude)
            if natal_houses and len(natal_houses) >= 12:
                natal_chart.houses = list(natal_houses[:12])
        except Exception:
            pass

        try:
            transit_houses = houses(jd_transit, payload.transit_location.latitude, payload.transit_location.longitude)
            if transit_houses and len(transit_houses) >= 12:
                transit_chart.houses = list(transit_houses[:12])
        except Exception:
            pass

        png_bytes = draw_chart_png(
            request.app,
            natal_chart,
            width=width,
            height=height,
            operation='draw_transits',
            transit_chart=transit_chart,
        )
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error rendering transit graphic: {exc}")

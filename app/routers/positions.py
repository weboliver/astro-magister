from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
import asyncio
import logging
import json
from app.services.ephemeris import julday, calc_ut, houses
from app.static.texte import get_general_anweisung
from astronex.chart import Chart
from app.static.zodiac_names import get_zodiac_name
from app import config as app_config
from app.schemas.datetime_models import DateTimeRequest, PlanetPosition, CalcResponse
from astronex.nexdate import NeXDate
from pytz import timezone as pytz_timezone
from app.services.planet_names import get_planet_name
from app.schemas.datetime_models import PositionResponse
from sqlalchemy import func

from app.db.session import get_session
from app.db.models.locations import CountryName, WorldAdminRegion, Location
from app.routers.auth import _get_user_from_request, require_authenticated_user
router = APIRouter(tags=["positions"], dependencies=[Depends(require_authenticated_user)])
logger = logging.getLogger(__name__)

# Perplexity AI streaming/caching
from app.services.providers import get_chat_provider
from app.services.perplexity import append_additional_question
from app.services import auth as auth_service
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate

PLANETS_SYSTEM_PROMPT = (
    "planets"
)


def _resolve_role_name_for_planets(request: Request, payload: DateTimeRequest) -> str:
    """Resolve role name for planet interpretation based on user and person.

    Args:
        request: FastAPI request object.
        payload: DateTimeRequest with optional person_id.

    Returns:
        Role name string (e.g., "Laie", "Fortgeschritten", "Experte").
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

# Map API planet indices to Swiss Ephemeris IDs
# Keep core planets 0..9 as-is. Add Lilith at API id 11 -> SE id 13,
# and Chiron at API id 12 -> SE id 15. Node (mean lunar node) will be available at API id 10 -> SE id 10.
_EPHEMERIS_ID = {0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:13,12:15}

@router.post("/calc", response_model=CalcResponse)
def get_calc(
    request: DateTimeRequest,
    planet_id: int = Query(..., ge=0, le=12, description="Planet ID (0=Sun, 1=Moon, 2=Mercury, etc.)"),
):
    """Calculate single planet position for birth data.

    Args:
        request: DateTimeRequest with birth date, time, latitude, longitude.
        planet_id: Planet ID (0=Sun, 1=Moon, 2=Mercury, etc.).

    Returns:
        CalcResponse with planet position, sign, house, and AI summary.
    """
    try:
        # compute decimal hour in UT: if `timezone` is provided use it
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
            except Exception as e:
                logger.warning(f"Timezone parse failed: {e}")
        jd = julday(request.year, request.month, request.day, decimal_hour)
        ephe_id = _EPHEMERIS_ID.get(planet_id, planet_id)
        flags, lon, error = calc_ut(jd, ephe_id, 4)
        # If Chiron (SE id 15) failed due to missing ephemeris path, try to reinitialize
        if error and ephe_id == 15:
            try:
                app_config.init_swisseph_path()
                flags, lon, error = calc_ut(jd, ephe_id, 4)
            except Exception as e:
                logger.warning(f"Failed to reinitialize Swiss Ephemeris for Chiron: {e}")
        speed_lon = None
        if error:
            raise HTTPException(status_code=400, detail=f"Calculation error: {error}")
        sign_idx = int(lon // 30) % 12
        deg_in_sign = lon - sign_idx * 30
        minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
        sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"

        # compute houses for the given location if available
        house_index = None
        house_label = None
        house_degree = None
        try:
            houses_list = houses(jd, request.latitude, request.longitude) or [None] * 12
            chart = Chart()
            chart.houses = list(houses_list)
            try:
                idx = chart.which_house(lon)
                house_index = idx
                house_label = chart.house_label(idx)
                # degree from cusp
                cusp = chart.houses[idx]
                deg_from_cusp = (lon - cusp) % 360.0
                if deg_from_cusp < 0:
                    deg_from_cusp += 360.0
                deg_int = int(deg_from_cusp)
                minutes_h = int((deg_from_cusp - deg_int) * 60)
                house_degree = f"{deg_int:02d}\u00b0 {minutes_h:02d}\u2032"
            except Exception:
                house_index = None
                house_label = None
                house_degree = None
        except Exception:
            house_index = None
            house_label = None
            house_degree = None

        planet = PlanetPosition(
            planet_id=planet_id,
            planet_name=get_planet_name(planet_id),
            longitude=lon,
            house_index=house_index,
            house=house_label,
            house_degree=house_degree,
            sign_index=sign_idx,
            sign=get_zodiac_name(sign_idx),
            sign_degree=sign_deg,
        )
        # build concise summary for single-planet calc
        
        birth = f"{request.year:04d}-{request.month:02d}-{request.day:02d}"
        summary_text = f"Huber Astrologische Psychologie.\n\nInterpretiere Horoskop: {birth}.\n\n"
        summary_text += f"Planeten: {planet.planet_name} - {planet.sign or 'unknown'} ({planet.sign_degree or ''}) / {planet.house_index if planet.house_index is not None else 'unknown'} ({planet.house_degree or ''})"
        summary_text += "\n\n" + get_general_anweisung()

        return CalcResponse(
            year=request.year,
            month=request.month,
            day=request.day,
            hour=decimal_hour,
            julian_day=jd,
            planets=[planet],
            status=0,
            summary=append_additional_question(summary_text, getattr(request, 'additional_question', None)),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating position: {str(e)}")


@router.post("/planets", response_model=CalcResponse)
def get_planets(
    request: DateTimeRequest,
):
    """Calculate all planet positions (0-12) for birth data.

    Args:
        request: DateTimeRequest with birth date, time, latitude, longitude.

    Returns:
        CalcResponse with all planet positions and AI summary.
    """
    planet_names = {
        0: "Sun", 1: "Moon", 2: "Mercury", 3: "Venus", 4: "Mars",
        5: "Jupiter", 6: "Saturn", 7: "Uranus", 8: "Neptune",
        9: "Pluto", 10: "Node", 11: "Lilith", 12: "Chiron",
    }
    try:
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
        planet_list = []
        # compute houses once for the request location
        try:
            houses_list = houses(jd, request.latitude, request.longitude) or [None] * 12
            chart = Chart()
            chart.houses = list(houses_list)
        except Exception:
            houses_list = [None] * 12
            chart = Chart()
        for planet_id in range(13):
            try:
                ephe_id = _EPHEMERIS_ID.get(planet_id, planet_id)
                flags, lon, error = calc_ut(jd, ephe_id, 4)
                # Retry once for Chiron if initial calc failed (maybe ephemeris path not set)
                if error and ephe_id == 15:
                    try:
                        app_config.init_swisseph_path()
                        flags, lon, error = calc_ut(jd, ephe_id, 4)
                    except Exception:
                        pass
                if not error:
                    sign_idx = int(lon // 30) % 12
                    deg_in_sign = lon - sign_idx * 30
                    minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
                    sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
                    # determine house membership and degree from cusp
                    try:
                        idx = chart.which_house(lon)
                        house_idx = idx
                        house_label = chart.house_label(idx)
                        cusp = chart.houses[idx]
                        deg_from_cusp = (lon - cusp) % 360.0
                        if deg_from_cusp < 0:
                            deg_from_cusp += 360.0
                        deg_int = int(deg_from_cusp)
                        minutes_h = int((deg_from_cusp - deg_int) * 60)
                        house_deg = f"{deg_int:02d}\u00b0 {minutes_h:02d}\u2032"
                    except Exception:
                        house_idx = None
                        house_label = None
                        house_deg = None

                    planet = PlanetPosition(
                        planet_id=planet_id,
                        planet_name=planet_names.get(planet_id, f"Object_{planet_id}"),
                        longitude=lon,
                        house_index=house_idx,
                        house=house_label,
                        house_degree=house_deg,
                        sign_index=sign_idx,
                        sign=get_zodiac_name(sign_idx),
                        sign_degree=sign_deg,
                    )
                    planet_list.append(planet)
            except Exception:
                continue
        # build summary for all planets
        try:
            parts = []
            for p in planet_list:
                pname = p.planet_name
                sign = p.sign or 'unknown'
                sdeg = p.sign_degree or ''
                hidx = p.house if p.house is not None else 'unknown'
                hdeg = p.house_degree or ''
                parts.append(f"{pname} - {sign} ({sdeg}) / house {hidx} ({hdeg})")           
        
            birth = f"{request.year:04d}-{request.month:02d}-{request.day:02d}"
            summary_text = f"Huber Astrologische Psychologie.\n\nInterpretiere Horoskop: {birth}.\n\n"
            summary_text += "Planets:\n\n" + "\n".join(parts)
            summary_text += "\n\n" + get_general_anweisung()
        except Exception:
            summary_text = None

        return CalcResponse(
            year=request.year,
            month=request.month,
            day=request.day,
            hour=decimal_hour,
            julian_day=jd,
            planets=planet_list,
            status=0,
            summary=append_additional_question(summary_text, getattr(request, 'additional_question', None)),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating planets: {str(e)}")


@router.post("/planets/stream")
async def get_planets_stream(payload: DateTimeRequest, request: Request):
    """Stream all planet positions with AI interpretation via SSE.

    Calculates planet positions and streams the AI interpretation incrementally.

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
    provider = None
    try:
        # Reuse existing logic to compute positions and a summary
        result = get_planets(payload)
        response_data = {
            "planets": [p.__dict__ for p in result.planets],
            "summary_prompt": result.summary,
        }
        if response_data["summary_prompt"]:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_planets(request, payload)
            provider = get_chat_provider(role_type=role_name)
            cached_summary = provider.get_cached(
                response_data["summary_prompt"],
                PLANETS_SYSTEM_PROMPT,
            )
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:planets')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Planets stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error preparing /planets/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating planets: {str(e)}")

    async def event_stream():
        if not response_data["summary_prompt"]:
            meta_payload = {key: value for key, value in response_data.items() if key != "summary_prompt"}
            yield _sse_event("meta", meta_payload)
            yield _sse_event("done", {"summary": ""})
            return

        summary_parts = []
        meta_payload = {key: value for key, value in response_data.items() if key != "summary_prompt"}

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
                            query_content=response_data["summary_prompt"] or "",
                            assistant_content=cached_summary,
                            user_persons_id=getattr(payload, 'person_id', None),
                            context_type="planets",
                            model=provider.model_name,
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
                    logger.exception("Failed to save cached interpretation for planets")
            return

        try:
            async for chunk in provider.stream_completion(
                summary=response_data["summary_prompt"],
                system_prompt=PLANETS_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            if not summary_parts:
                try:
                    logger.debug("No streamed chunks received, invoking synchronous fallback for planets")
                    text = await asyncio.to_thread(
                        provider.chat_completion,
                        response_data["summary_prompt"],
                        PLANETS_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                    logger.debug("Fallback returned length=%d", len(text))
                except Exception:
                    logger.exception("Synchronous fallback to chat_completion failed for planets")

            full_summary = "".join(summary_parts)
            logger.debug("Assembled full planets summary, length=%d", len(full_summary))
            try:
                provider.cache_result(response_data["summary_prompt"], PLANETS_SYSTEM_PROMPT, full_summary)
                logger.debug("Wrote full planets summary to cache")
            except Exception:
                logger.exception("Failed to set cache for planets")

            yield _sse_event("done", {"summary": full_summary})
            try:
                db = get_session()
                try:
                    _interp_id = _istore.save_or_append_stream_result(
                        db,
                        user_id=user['id'],
                        interpretation_id=getattr(payload, 'interpretation_id', None),
                        user_question=getattr(payload, 'additional_question', None) or "",
                        query_content=response_data["summary_prompt"] or "",
                        assistant_content=full_summary,
                        user_persons_id=getattr(payload, 'person_id', None),
                        context_type="planets",
                        model=provider.model_name,
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
                logger.exception("Failed to save interpretation after planets stream")
        except Exception as exc:
            logger.exception("Error streaming /planets/stream")
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



@router.get("/getPosition", response_model=PositionResponse)
def get_position(request: Request, country: str = Query(..., description="Country code/table name"), city: str = Query(..., description="City name"), district: str = Query(..., description="Region/district code (AC)")):
    """Lookup a location in normalized location tables and return decimal latitude/longitude.

    Args:
        request: FastAPI Request.
        country: DB table name / country code (e.g. 'DE').
        city: city name as stored in the DB.
        district: region/district code (AC).

    Returns:
        PositionResponse with latitude and longitude.

    Raises:
        HTTPException: If country, region, or city not found.
    """

    def resolve_country_code(session, country_name: str) -> str:
        # if caller supplied an ISO-like code, accept it directly if present
        try:
            if country_name and isinstance(country_name, str):
                cand = country_name.strip().upper()
                if len(cand) <= 3:
                    found = session.query(CountryName).filter(CountryName.code == cand).first()
                    if found:
                        return cand
        except Exception:
            pass

        # direct mapping by exact country name
        try:
            row = session.query(CountryName).filter(CountryName.name == country_name).first()
            if row:
                return str(row.code).upper()
        except Exception:
            pass

        # substring match on country names
        low = country_name.lower() if country_name else ''
        rows = session.query(CountryName).all()
        for row in rows:
            try:
                cn = str(row.name).lower()
                if low and (low in cn or cn in low):
                    return str(row.code).upper()
            except Exception:
                continue

        raise HTTPException(status_code=404, detail=f"Country not found: {country_name}")

    def resolve_region_code(session, resolved_code: str, region: str):
        if not region:
            return region
        # if already region code, accept it
        if len(region) <= 3 and region.upper() == region:
            return region
        rows = session.query(WorldAdminRegion).filter(WorldAdminRegion.alfa == resolved_code).all()
        low = region.lower()
        for row in rows:
            if low and low in str(row.name).lower():
                return row.code
        raise HTTPException(status_code=404, detail=f"Region not found: {region}")

    def _decode_legacy_coord(value, raw_text, is_longitude: bool):
        # already decimal degree
        if value is not None:
            lim = 180.0 if is_longitude else 90.0
            try:
                fval = float(value)
                if abs(fval) <= lim:
                    return fval
            except Exception:
                pass

        text = None
        if raw_text is not None:
            text = str(raw_text).strip()
        elif value is not None:
            text = str(value).strip()
        if not text:
            return None

        # remove hemisphere markers and keep sign
        sign = 1.0
        upper = text.upper()
        if upper.startswith('-'):
            sign = -1.0
        if 'W' in upper or 'S' in upper:
            sign = -1.0
        digits = ''.join(ch for ch in text if ch.isdigit())
        if len(digits) < 5:
            return None

        # Interpret as DMS with variable degree length: deg + mm + ss
        sec = int(digits[-2:])
        minute = int(digits[-4:-2])
        degree = int(digits[:-4])
        return sign * (degree + minute / 60.0 + sec / 3600.0)

    session = get_session()
    try:
        # 1) resolve country
        resolved_code = resolve_country_code(session, country)

        # 2) resolve region/district
        region_code = resolve_region_code(session, resolved_code, district)

        # 3) fetch location
        query = session.query(Location).filter(Location.country_code == resolved_code)
        if region_code:
            query = query.filter(Location.region_code == region_code)
        # prefer exact city match first
        loc = query.filter(func.lower(Location.city) == str(city).lower()).first()
        if not loc:
            # fallback fuzzy contains
            loc = query.filter(func.lower(Location.city).contains(str(city).lower())).first()
        if not loc:
            raise HTTPException(status_code=404, detail="Location not found")

        country_row = session.query(CountryName).filter(CountryName.code == resolved_code).first()
        region_row = None
        if loc.region_code:
            region_row = (
                session.query(WorldAdminRegion)
                .filter(WorldAdminRegion.alfa == resolved_code, WorldAdminRegion.code == loc.region_code)
                .first()
            )

        latitude = _decode_legacy_coord(loc.latitude, loc.latitude_text, is_longitude=False)
        longitude = _decode_legacy_coord(loc.longitude, loc.longitude_text, is_longitude=True)

        return PositionResponse(
            country_code=loc.country_code,
            country=country_row.name if country_row else None,
            region_code=loc.region_code,
            region=region_row.name if region_row else None,
            city=loc.city,
            latitude=latitude,
            longitude=longitude,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error looking up position: {str(e)}")
    finally:
        session.close()

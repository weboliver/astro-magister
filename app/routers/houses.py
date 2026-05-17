from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import asyncio
import json
import logging
from app.services.ephemeris import julday, houses
from app.services.horoscope_graphics import build_chart_from_request, draw_chart_png
from app.static.texte import get_general_anweisung
from app.static.zodiac_names import get_zodiac_name
from app.schemas.datetime_models import DateTimeRequest, HousesResponse
from pytz import timezone as pytz_timezone
from app.services.perplexity import PerplexityClient, _make_cache_key, _cache_set, append_additional_question
from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate

router = APIRouter(tags=["houses"], dependencies=[Depends(require_authenticated_user)])
logger = logging.getLogger(__name__)

HOUSES_SYSTEM_PROMPT = "houses"


def _resolve_role_name_for_houses(request: Request, payload: DateTimeRequest) -> str:
    """Resolve role name for houses interpretation based on user and person.

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
        event: Event type string.
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_houses_response(request: DateTimeRequest) -> HousesResponse:
    """Build houses response with calculated house cusps and AI summary.

    Args:
        request: DateTimeRequest with birth date, time, and location.

    Returns:
        HousesResponse with house positions and summary prompt.

    Raises:
        HTTPException: If house calculation fails.
    """
    # compute decimal hour in UT, honoring provided IANA timezone when present
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
    latitude = request.latitude
    longitude = request.longitude
    h = houses(jd, latitude, longitude)
    if h is None:
        raise HTTPException(status_code=400, detail="Error computing houses (may be above Arctic Circle)")

    house_entries = []
    for idx, cusp in enumerate(h):
        sign_idx = int(cusp // 30) % 12
        deg_in_sign = cusp - sign_idx * 30
        deg_int = int(deg_in_sign)
        minutes = int((deg_in_sign - deg_int) * 60)
        sign_deg = f"{deg_int:02d}\u00b0 {minutes:02d}\u2032"
        house_entries.append({
            "house": idx + 1,
            "longitude": float(cusp),
            "sign_index": sign_idx,
            "sign": get_zodiac_name(sign_idx),
            "sign_degree": sign_deg,
        })

    label_map = {1: "AC", 4: "IC", 7: "DC", 10: "MC"}
    parts = []
    for house_entry in house_entries:
        number = house_entry["house"]
        label = label_map.get(number, f"house {number}")
        parts.append(f"{label} - {house_entry['sign']} ({house_entry['sign_degree']})")

    birth = f"{request.year:04d}-{request.month:02d}-{request.day:02d}"
    summary_text = f"Huber Astrologische Psychologie.\n\nInterpretiere Häuser Horoskop: {birth}.\n\n"
    summary_text += "Häuser:\n\n" + "\n".join(parts)
    summary_text += "\n\n" + get_general_anweisung()

    return HousesResponse(
        year=request.year,
        month=request.month,
        day=request.day,
        hour=decimal_hour,
        julian_day=jd,
        latitude=latitude,
        longitude=longitude,
        houses=house_entries,
        summary=append_additional_question(summary_text, getattr(request, 'additional_question', None)),
    )

@router.post("/houses", response_model=HousesResponse)
def get_houses(request: DateTimeRequest):
    """Calculate house cusps using Swiss Ephemeris.

    Args:
        request: DateTimeRequest with birth date, time, latitude, longitude.

    Returns:
        HousesResponse with house positions and AI summary.

    Raises:
        HTTPException: On calculation error.
    """
    try:
        return _build_houses_response(request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating houses: {str(e)}")


@router.post("/houses/stream")
async def get_houses_stream(payload: DateTimeRequest, request: Request):
    """Stream house calculation with real-time AI summary generation.

    Args:
        payload: DateTimeRequest with birth data.
        request: FastAPI Request for auth context.

    Returns:
        StreamingResponse with SSE events for houses and AI summary.
    """
    cached_summary = None
    perplexity_client = None
    try:
        result = _build_houses_response(payload)
        response_data = result.model_dump()
        summary_prompt = response_data.pop("summary")
        if summary_prompt:
            user = _get_user_from_request(request)
            role_name = _resolve_role_name_for_houses(request, payload)
            perplexity_client = PerplexityClient(role_type=role_name)
            cached_summary = perplexity_client.get_cached_summary(summary_prompt, HOUSES_SYSTEM_PROMPT)
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user['id'] if user else None, scope='ai:houses')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Houses stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error preparing /houses/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating houses: {str(e)}")

    async def event_stream():
        if not summary_prompt:
            yield _sse_event("meta", response_data)
            yield _sse_event("done", {"summary": ""})
            return

        summary_parts = []

        yield _sse_event("meta", response_data)

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
                            query_content=summary_prompt or "",
                            assistant_content=cached_summary,
                            user_persons_id=getattr(payload, 'person_id', None),
                            context_type="houses",
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
                    logger.exception("Failed to save cached interpretation for houses")
            return

        try:
            async for chunk in perplexity_client.send_summary_stream(
                summary=summary_prompt,
                system_prompt=HOUSES_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            if not summary_parts:
                try:
                    logger.debug("No streamed chunks received, invoking synchronous fallback for houses")
                    text = await asyncio.to_thread(
                        perplexity_client.send_summary_text,
                        summary_prompt,
                        HOUSES_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                    logger.debug("Fallback returned length=%d", len(text))
                except Exception:
                    logger.exception("Synchronous fallback to send_summary_text failed for houses")

            full_summary = "".join(summary_parts)
            try:
                resolved_prompt = perplexity_client._resolve_system_prompt(HOUSES_SYSTEM_PROMPT)
                key = _make_cache_key(summary_prompt, resolved_prompt, perplexity_client.model)
                _cache_set(key, full_summary)
            except Exception:
                logger.exception("Failed to set Perplexity cache for houses")

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
                        context_type="houses",
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
                logger.exception("Failed to save interpretation after houses stream")
        except Exception as exc:
            logger.exception("Error streaming /houses/stream")
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
    "/houses/graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def get_houses_graphic(
    payload: DateTimeRequest,
    request: Request,
    width: int = Query(750, ge=200, le=2048, description="Image width in pixels"),
    height: int = Query(750, ge=200, le=2048, description="Image height in pixels"),
):
    """Render the natal houses graphic using the Astronex drawing engine."""

    try:
        chart = build_chart_from_request(payload)
        png_bytes = draw_chart_png(
            request.app, chart, width, height, operation='draw_house'
        )
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error rendering houses graphic: {exc}")

"""Router for synastry (Partnerhoroskop) two-person comparison chart interpretation."""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import logging
import asyncio

from app.services.ephemeris import julday, calc_ut, houses
from app.static.texte import get_general_anweisung
from app.services.providers import get_chat_provider
from app.services.perplexity import append_additional_question
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.datetime_models import SynastryRequest
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.services import auth as auth_service
from app import config as app_config
from pytz import timezone as pytz_timezone
from app.services.ephemeris import calc_ut as _calc_ut
from app.services.planet_names import get_planet_name
from app.static.zodiac_names import get_zodiac_name
from app.static.aspect_names import get_aspect_english_by_index
from astronex.chart import Chart
from app.services.horoscope_graphics import draw_chart_png
import astronex.chart as chart_module
from astronex.config import ORBS as CONFIG_ORBS

from app.db.models.users import UserPerson

logger = logging.getLogger(__name__)

router = APIRouter(tags=["synastry"], dependencies=[Depends(require_authenticated_user)])

SYNASTRY_SYSTEM_PROMPT = "synastrie"


def _lookup_person_birth_data(db, person_id: Optional[int], user_id: int) -> dict:
    """Look up a person's birth data from user_persons table or own profile.

    Args:
        db: SQLAlchemy session
        person_id: user_persons.id, or None for logged-in user's own profile
        user_id: The currently authenticated user's ID (for own profile lookup)

    Returns:
        Birth data dict with year, month, day, hour, minute, second, timezone, latitude, longitude

    Raises:
        HTTPException(400) if person or profile not found
    """
    if person_id is None:
        profile = auth_service.get_profile(user_id)
        if not profile:
            raise HTTPException(status_code=400, detail="Own profile not found")
        return {
            'year': profile.get('birth_year', 0),
            'month': profile.get('birth_month', 1),
            'day': profile.get('birth_day', 1),
            'hour': profile.get('birth_hour') or 12,
            'minute': profile.get('birth_minute') or 0,
            'second': profile.get('birth_second') or 0,
            'timezone': profile.get('birth_timezone') or 'UTC',
            'latitude': profile.get('birth_latitude') or 0.0,
            'longitude': profile.get('birth_longitude') or 0.0,
        }
    person = db.query(UserPerson).filter(UserPerson.id == person_id).first()
    if not person:
        raise HTTPException(status_code=400, detail=f"Person {person_id} not found")
    return {
        'year': person.birth_year,
        'month': person.birth_month,
        'day': person.birth_day,
        'hour': person.birth_hour or 12,
        'minute': person.birth_minute or 0,
        'second': person.birth_second or 0,
        'timezone': person.birth_timezone or 'UTC',
        'latitude': person.birth_latitude or 0.0,
        'longitude': person.birth_longitude or 0.0,
    }


def _build_chart_from_birth_data(birth_data: dict) -> Chart:
    """Build a Chart instance from a birth data dict.

    Args:
        birth_data: dict with year, month, day, hour, minute, second, timezone, latitude, longitude

    Returns:
        Chart instance with populated planets, houses, and metadata.
    """
    year = birth_data['year']
    month = birth_data['month']
    day = birth_data['day']
    hour = birth_data['hour']
    minute = birth_data['minute']
    second = birth_data['second']
    timezone = birth_data['timezone']
    latitude = birth_data['latitude']
    longitude = birth_data['longitude']

    app_config.init_swisseph_path()

    from datetime import datetime
    naive_dt = datetime(year, month, day, hour, minute, second)
    tz_name = timezone or 'UTC'
    try:
        local_tz = pytz_timezone(tz_name)
    except Exception:
        local_tz = pytz_timezone('UTC')
    try:
        local_dt = local_tz.localize(naive_dt, is_dst=True)
    except Exception:
        local_dt = pytz_timezone('UTC').localize(naive_dt)
    utc_dt = local_dt.astimezone(pytz_timezone('UTC'))
    decimal_hour = utc_dt.hour + utc_dt.minute / 60.0 + utc_dt.second / 3600.0

    jd = julday(year, month, day, decimal_hour)

    chart = Chart()
    chart.first = ''
    chart.last = ''
    chart.city = ''
    chart.country = ''
    chart.region = ''
    chart.latitud = latitude
    chart.longitud = longitude
    chart.zone = timezone or 'UTC'
    chart.date = utc_dt.strftime('%Y-%m-%dT%H:%M:%S%zUTC')

    from app.services.planet_positions import calculate_api_planet_longitudes
    chart.planets = calculate_api_planet_longitudes(jd, _calc_ut, epheflag=4)
    chart.houses = houses(jd, latitude, longitude) or chart.calc(
        (year, month, day, decimal_hour),
        type('loc', (), {'latdec': latitude, 'longdec': longitude, 'zone': timezone or 'UTC'})(),
        4
    )[1]
    return chart


def _calculate_synastry_response(
    birth_data_a: dict,
    birth_data_b: dict,
    comparison_mode: str,
    additional_question: str | None,
    person_a_name: str | None = None,
    person_b_name: str | None = None,
) -> dict:
    """Calculate synastry comparison data for both persons.

    Args:
        birth_data_a: Birth data dict for person A
        birth_data_b: Birth data dict for person B
        comparison_mode: 'hh' (Häuservergleich) or 'rr' (Radixvergleich)
        additional_question: Optional follow-up question

    Returns:
        Dictionary containing chart_a, chart_b, planet entries, cross_aspects,
        summary_prompt, and comparison_mode.
    """
    try:
        app_config.init_swisseph_path()
    except Exception as e:
        logger.debug(f"Swiss Ephemeris init failed: {e}")

    chart_a = _build_chart_from_birth_data(birth_data_a)
    chart_b = _build_chart_from_birth_data(birth_data_b)

    planames_chart = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']

    planet_entries_a = []
    decimal_hour_a = birth_data_a['hour'] + birth_data_a['minute'] / 60.0 + birth_data_a['second'] / 3600.0
    jd_a = julday(birth_data_a['year'], birth_data_a['month'], birth_data_a['day'], decimal_hour_a)

    for planet_id in range(10):
        flags_p, lon_p, err_p = _calc_ut(jd_a, planet_id, 4)
        if err_p or flags_p < 0:
            continue
        sign_idx_p = int(lon_p // 30) % 12
        try:
            deg_in_sign = lon_p - sign_idx_p * 30
            minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
            sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
        except Exception:
            sign_deg = f"{lon_p:.2f}\u00b0"
        try:
            idx_p = chart_a.which_house(lon_p)
            house_label_p = chart_a.house_label(idx_p)
        except Exception:
            house_label_p = None
        planet_entries_a.append({
            'planet_id': planet_id,
            'planet_name': get_planet_name(planet_id),
            'longitude': lon_p,
            'sign': get_zodiac_name(sign_idx_p),
            'sign_degree': sign_deg,
            'house': house_label_p,
        })
    chart_a.planets = [e['longitude'] for e in planet_entries_a]

    planet_entries_b = []
    decimal_hour_b = birth_data_b['hour'] + birth_data_b['minute'] / 60.0 + birth_data_b['second'] / 3600.0
    jd_b = julday(birth_data_b['year'], birth_data_b['month'], birth_data_b['day'], decimal_hour_b)

    for planet_id in range(10):
        flags_p, lon_p, err_p = _calc_ut(jd_b, planet_id, 4)
        if err_p or flags_p < 0:
            continue
        sign_idx_p = int(lon_p // 30) % 12
        try:
            deg_in_sign = lon_p - sign_idx_p * 30
            minutes = int((deg_in_sign - int(deg_in_sign)) * 60)
            sign_deg = f"{int(deg_in_sign):02d}\u00b0 {minutes:02d}\u2032"
        except Exception:
            sign_deg = f"{lon_p:.2f}\u00b0"
        try:
            idx_p = chart_b.which_house(lon_p)
            house_label_p = chart_b.house_label(idx_p)
        except Exception:
            house_label_p = None
        planet_entries_b.append({
            'planet_id': planet_id,
            'planet_name': get_planet_name(planet_id),
            'longitude': lon_p,
            'sign': get_zodiac_name(sign_idx_p),
            'sign_degree': sign_deg,
            'house': house_label_p,
        })
    chart_b.planets = [e['longitude'] for e in planet_entries_b]

    if not getattr(chart_module, 'orbs', None):
        chart_module.orbs.extend([
            CONFIG_ORBS['lum'], CONFIG_ORBS['normal'], CONFIG_ORBS['short'], CONFIG_ORBS['far'], CONFIG_ORBS['useless']
        ])

    temp_chart = Chart()
    temp_chart.planets = chart_a.planets + chart_b.planets
    temp_chart.houses = list(chart_a.houses)
    try:
        raw_aspects = temp_chart.aspects()
    except Exception:
        raw_aspects = []

    cross_aspects = []
    for asp in raw_aspects:
        p1 = asp.get('p1', 0)
        p2 = asp.get('p2', 0)
        is_cross = (p1 < 10 and p2 >= 10) or (p1 >= 10 and p2 < 10)
        if is_cross:
            cross_aspects.append(asp)

    aspects_list = []
    for asp in cross_aspects:
        p1 = asp.get('p1', 0) % 10
        p2 = asp.get('p2', 0) % 10
        a = int(asp.get('a', 0)) if asp.get('a') is not None else 0
        label = get_aspect_english_by_index(a)
        try:
            n1 = planames_chart[p1] if p1 < len(planames_chart) else str(p1)
            n2 = planames_chart[p2] if p2 < len(planames_chart) else str(p2)
        except Exception:
            n1 = str(p1)
            n2 = str(p2)
        aspects_list.append(f"{n1}-{label}-{n2}")

    mode_label = "Häuservergleich (Haus-Haus)" if comparison_mode == "hh" else "Radixvergleich (Radix-Radix)"
    birth_a = f"{birth_data_a['year']:04d}-{birth_data_a['month']:02d}-{birth_data_a['day']:02d}"
    birth_b = f"{birth_data_b['year']:04d}-{birth_data_b['month']:02d}-{birth_data_b['day']:02d}"

    planets_a_str = "; ".join([f"{p['planet_name']} in {p['sign']} {p['sign_degree']} (Haus {p['house'] or 'unbekannt'})" for p in planet_entries_a])
    planets_b_str = "; ".join([f"{p['planet_name']} in {p['sign']} {p['sign_degree']} (Haus {p['house'] or 'unbekannt'})" for p in planet_entries_b])
    aspects_str = "; ".join(aspects_list) if aspects_list else "keine"

    label_a = (person_a_name or "Person A").strip()
    label_a = label_a[0].upper() + label_a[1:] if label_a else "Person A"
    label_b = (person_b_name or "Person B").strip()
    label_b = label_b[0].upper() + label_b[1:] if label_b else "Person B"

    summary_prompt = f"""Huber Astrologische Psychologie — Partnerhoroskop (Synastrie).

Interpretiere die Beziehung zwischen zwei Personen: {mode_label}.

{label_a} — Geburtsdatum: {birth_a}
Planeten: {planets_a_str}

{label_b} — Geburtsdatum: {birth_b}
Planeten: {planets_b_str}

Interplanetare Aspekte (Beziehungsaspekte): {aspects_str}

Erstelle eine detaillierte Partnerhoroskop-Interpretation als Bullet-Liste:
1. Die wichtigsten Beziehungsaspekte zwischen beiden Personen — welche Planetenkontakte prägen die Beziehung?
2. Die Häuserüberlagerungen — in welchen Lebensbereichen beeinflussen sich die Partner gegenseitig?
3. Harmonie und Herausforderungen in der Partnerschaft — Stärken und Entwicklungsfelder
4. Psychologische Dynamik der Beziehung aus Sicht der Huber-Astrologie — Entwicklungspotential

Erstelle eine Liste der wichtigsten Beziehungsthemen.
(Keine Meta Information, nur die Interpretation. Verwende eine klare und verständliche Sprache)

{get_general_anweisung()}"""

    summary_prompt = append_additional_question(summary_prompt, additional_question)

    return {
        'chart_a': chart_a,
        'chart_b': chart_b,
        'planet_entries_a': planet_entries_a,
        'planet_entries_b': planet_entries_b,
        'cross_aspects': cross_aspects,
        'summary_prompt': summary_prompt,
        'comparison_mode': comparison_mode,
    }


@router.post("/synastry/stream")
async def get_synastry_stream(payload: SynastryRequest, request: Request):
    """Stream synastry (Partnerhoroskop) comparison with AI interpretation via SSE.

    Looks up birth data from user_persons table by ID, calculates charts,
    computes inter-chart aspects, and streams the AI interpretation incrementally.

    Args:
        payload: SynastryRequest with person_a_id, person_b_id, and comparison_mode.
        request: FastAPI Request with user authentication context.

    Returns:
        StreamingResponse with SSE events: "meta", "done", "summary_delta",
        "saved", and "error".

    Raises:
        HTTPException: If not authenticated, rate limited, or calculation fails.
    """
    user = _get_user_from_request(request)
    user_id = user['id'] if user else None
    try:
        db = get_session()
        try:
            birth_data_a = _lookup_person_birth_data(db, payload.person_a_id, user_id)
            birth_data_b = _lookup_person_birth_data(db, payload.person_b_id, user_id)
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error looking up person birth data")
        raise HTTPException(status_code=400, detail=f"Error looking up person data: {str(e)}")

    try:
        response_data = _calculate_synastry_response(
            birth_data_a,
            birth_data_b,
            payload.comparison_mode,
            getattr(payload, 'additional_question', None),
            getattr(payload, 'person_a_name', None),
            getattr(payload, 'person_b_name', None),
        )
    except Exception as e:
        logger.exception("Error calculating synastry")
        raise HTTPException(status_code=400, detail=f"Error calculating synastry: {str(e)}")

    role_name = "Laie"
    if user_id:
        role_name = auth_service.get_role_name_for_subject(user_id, payload.person_a_id)

    provider = None
    cached_summary = None
    try:
        if response_data['summary_prompt']:
            provider = get_chat_provider(role_type=role_name)
            cached_summary = provider.get_cached(
                response_data['summary_prompt'],
                SYNASTRY_SYSTEM_PROMPT,
            )
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(request, user_id=user_id, scope='ai:synastry')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(request),
                        user_agent=request.headers.get('user-agent'),
                        detail='Synastry stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error preparing /synastry/stream")
        raise HTTPException(status_code=400, detail=f"Error calculating synastry: {str(e)}")

    async def event_stream():
        if not response_data['summary_prompt']:
            meta_payload = {
                'comparison_mode': response_data['comparison_mode'],
                'planet_entries_a': response_data['planet_entries_a'],
                'planet_entries_b': response_data['planet_entries_b'],
                'cross_aspects': response_data['cross_aspects'],
            }
            yield f"event: meta\ndata: {__import__('json').dumps(meta_payload, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {__import__('json').dumps({'summary': ''}, ensure_ascii=False)}\n\n"
            return

        meta_payload = {
            'comparison_mode': response_data['comparison_mode'],
            'planet_entries_a': response_data['planet_entries_a'],
            'planet_entries_b': response_data['planet_entries_b'],
            'cross_aspects': response_data['cross_aspects'],
        }

        yield f"event: meta\ndata: {__import__('json').dumps(meta_payload, ensure_ascii=False)}\n\n"

        if cached_summary is not None:
            yield f"event: done\ndata: {__import__('json').dumps({'summary': cached_summary}, ensure_ascii=False)}\n\n"
            if user:
                try:
                    db = get_session()
                    try:
                        _interp_id = _istore.save_or_append_stream_result(
                            db,
                            user_id=user_id,
                            interpretation_id=getattr(payload, 'interpretation_id', None),
                            user_question=getattr(payload, 'additional_question', None) or "",
                            query_content=response_data['summary_prompt'] or "",
                            assistant_content=cached_summary,
                            user_persons_id=payload.person_a_id,
                            user_person_id_2=payload.person_b_id,
                            context_type="synastry",
                            comparison_mode=payload.comparison_mode,
                            model=provider.model_name,
                            interp_year=birth_data_a['year'],
                            interp_month=birth_data_a['month'],
                            interp_day=birth_data_a['day'],
                            interp_hour=birth_data_a['hour'],
                            interp_minute=birth_data_a['minute'],
                            location_latitude=birth_data_a['latitude'],
                            location_longitude=birth_data_a['longitude'],
                        )
                        yield f"event: saved\ndata: {__import__('json').dumps({'interpretation_id': _interp_id}, ensure_ascii=False)}\n\n"
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save cached interpretation for synastry")
            return

        summary_parts = []
        try:
            async for chunk in provider.stream_completion(
                summary=response_data['summary_prompt'],
                system_prompt=SYNASTRY_SYSTEM_PROMPT,
            ):
                summary_parts.append(chunk)
                yield f"event: summary_delta\ndata: {__import__('json').dumps({'content': chunk}, ensure_ascii=False)}\n\n"

            if not summary_parts:
                try:
                    logger.debug("No streamed chunks received, invoking synchronous fallback for synastry")
                    text = await asyncio.to_thread(
                        provider.chat_completion,
                        response_data['summary_prompt'],
                        SYNASTRY_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                    logger.debug("Fallback returned length=%d", len(text))
                except Exception:
                    logger.exception("Synchronous fallback to chat_completion failed for synastry")

            full_summary = "".join(summary_parts)
            logger.debug("Assembled full synastry summary, length=%d", len(full_summary))
            try:
                provider.cache_result(response_data['summary_prompt'], SYNASTRY_SYSTEM_PROMPT, full_summary)
                logger.debug("Wrote full synastry summary to cache")
            except Exception:
                logger.exception("Failed to set cache for synastry")

            yield f"event: done\ndata: {__import__('json').dumps({'summary': full_summary}, ensure_ascii=False)}\n\n"

            if user:
                try:
                    db = get_session()
                    try:
                        _interp_id = _istore.save_or_append_stream_result(
                            db,
                            user_id=user_id,
                            interpretation_id=getattr(payload, 'interpretation_id', None),
                            user_question=getattr(payload, 'additional_question', None) or "",
                            query_content=response_data['summary_prompt'] or "",
                            assistant_content=full_summary,
                            user_persons_id=payload.person_a_id,
                            user_person_id_2=payload.person_b_id,
                            context_type="synastry",
                            comparison_mode=payload.comparison_mode,
                            model=provider.model_name,
                            interp_year=birth_data_a['year'],
                            interp_month=birth_data_a['month'],
                            interp_day=birth_data_a['day'],
                            interp_hour=birth_data_a['hour'],
                            interp_minute=birth_data_a['minute'],
                            location_latitude=birth_data_a['latitude'],
                            location_longitude=birth_data_a['longitude'],
                        )
                        yield f"event: saved\ndata: {__import__('json').dumps({'interpretation_id': _interp_id}, ensure_ascii=False)}\n\n"
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save interpretation after synastry stream")

        except Exception as exc:
            logger.exception("Error streaming /synastry/stream")
            yield f"event: error\ndata: {__import__('json').dumps({'detail': str(exc)}, ensure_ascii=False)}\n\n"

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
    "/synastry/graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def get_synastry_graphic(
    payload: SynastryRequest,
    request: Request,
    width: int = Query(750, ge=200, le=2048, description="Image width in pixels"),
    height: int = Query(750, ge=200, le=2048, description="Image height in pixels"),
):
    """Render the synastry comparison chart as a PNG graphic.

    Uses click_hh (House-House comparison) or click_rr (Radix-Radix comparison)
    based on the comparison_mode field in the payload.
    """
    user = _get_user_from_request(request)
    user_id = user['id'] if user else None
    try:
        db = get_session()
        try:
            birth_data_a = _lookup_person_birth_data(db, payload.person_a_id, user_id)
            birth_data_b = _lookup_person_birth_data(db, payload.person_b_id, user_id)
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error looking up person data: {exc}")

    try:
        chart_a = _build_chart_from_birth_data(birth_data_a)
        chart_b = _build_chart_from_birth_data(birth_data_b)
        operation = 'click_hh' if payload.comparison_mode == 'hh' else 'click_rr'
        png_bytes = draw_chart_png(request.app, chart_a, width, height, operation=operation, second_chart=chart_b)
        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Ungültige Zeitzone oder Datum: {exc}")
    except Exception as exc:
        logger.exception("Error rendering synastry graphic")
        raise HTTPException(status_code=500, detail=f"Error rendering synastry graphic: {exc}")
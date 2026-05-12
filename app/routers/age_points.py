from datetime import datetime
import asyncio
import json
import logging
import math
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from typing import List, Optional
from pathlib import Path
import app.config as app_config
from app.schemas.age_points import *
from app.services.ephemeris import julday, houses, calc
from astronex.chart import Chart
from pytz import timezone as pytz_timezone
from app.static.texte import get_general_anweisung
from app.routers.transits import TransitRequest, DateObject, Location, transits
from app.services.perplexity import PerplexityClient, _make_cache_key, _cache_set, append_additional_question
from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.services.auth_security import build_ai_rate_limit_error_detail, check_ai_rate_limit, get_client_ip, log_auth_event
from app.db.session import get_session
from app.services import interpretation_store as _istore
from app.schemas.interpretations import InterpretationCreate, MessageCreate as InterpMessageCreate

# Protected router (requires authentication for most age-points endpoints)
router = APIRouter(tags=["age-points"], dependencies=[Depends(require_authenticated_user)])
# Public router for endpoints that must not require authentication (static graphics, etc.)
public_router = APIRouter()

logger = logging.getLogger(__name__)

AGE_POINTS_SYSTEM_PROMPT = "age_points"


def _resolve_role_name_for_age_points(request: Request, payload: AgePointsRequest) -> str:
    user = _get_user_from_request(request)
    if not user:
        return "Laie"
    return auth_service.get_role_name_for_subject(user['id'], getattr(payload, 'person_id', None))

AGE_POINT_PREFIX_TRANSLATIONS = {
    "Cc ": "Bewusstseinszentrum / Haus: ",
    "CC ": "Bewusstseinszentrum / Haus: ",
    "Pi ": "Persoenlichkeitsintegration / Haus: ",
    "PI ": "Persoenlichkeitsintegration / Haus: ",
    "Pr ": "Projektion / Haus: ",
    "PR ": "Projektion / Haus: ",
}

AGE_POINT_TERM_TRANSLATIONS = {
    "cuad": "Quadrat",
    "opos": "Opposition",
    "conj": "Konjunktion",
    "trig": "Trigon",
    "sext": "Sextil",
    "cc": "Bewusstseinszentrum",
    "pi": "Persoenlichkeitsintegration",
    "pr": "Projektion",
}

AGE_POINT_PLANET_TRANSLATIONS = {
    "north node": "Mondknoten",
    "south node": "Suedknoten",
    "node": "Mondknoten",
    "sun": "Sonne",
    "moon": "Mond",
    "mercury": "Merkur",
    "venus": "Venus",
    "mars": "Mars",
    "jupiter": "Jupiter",
    "saturn": "Saturn",
    "uranus": "Uranus",
    "neptune": "Neptun",
    "pluto": "Pluto",
    "lilith": "Lilith",
    "chiron": "Chiron",
}


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _translate_age_point_text(value: Optional[str]) -> str:
    if not value:
        return ""

    translated = str(value)
    for short, full in AGE_POINT_PREFIX_TRANSLATIONS.items():
        translated = translated.replace(short, full)

    for short, full in AGE_POINT_TERM_TRANSLATIONS.items():
        translated = re.sub(rf"\b{re.escape(short)}\b", full, translated, flags=re.IGNORECASE)

    for short, full in AGE_POINT_PLANET_TRANSLATIONS.items():
        translated = re.sub(rf"\b{re.escape(short)}\b", full, translated, flags=re.IGNORECASE)

    translated = re.sub(r"\s{2,}", " ", translated).strip()
    return translated


def _normalize_age_point(point):
    if isinstance(point, dict):
        normalized = dict(point)
    else:
        normalized = {
            "day": getattr(point, "day", None),
            "mon": getattr(point, "mon", None),
            "year": getattr(point, "year", None),
            "lab": getattr(point, "lab", ""),
            "cl": getattr(point, "cl", ""),
        }

    normalized["lab"] = _translate_age_point_text(normalized.get("lab"))
    normalized["cl"] = _translate_age_point_text(normalized.get("cl"))
    return normalized


def _normalize_age_points(age_points):
    return [_normalize_age_point(point) for point in age_points or []]


def _build_plan_from_planets(planets_list):
    plan = []
    for ix, deg in enumerate(planets_list):
        plan.append({"degree": deg % 360.0, "ix": ix})
    plan = sorted(plan, key=lambda p: p["degree"])
    return plan


def _compute_decimal_hour(request: AgePointsRequest) -> float:
    decimal_hour = request.hour + request.minute / 60.0 + request.second / 3600.0
    if getattr(request, 'timezone', None):
        try:
            local_dt = pytz_timezone(request.timezone).localize(
                datetime(
                    request.year, request.month, request.day,
                    request.hour, request.minute, request.second
                ), is_dst=True
            )
            ut = local_dt.astimezone(pytz_timezone('UTC'))
            decimal_hour = ut.hour + ut.minute / 60.0 + ut.second / 3600.0
        except Exception as e:
            logger.warning(f"Failed to parse timezone: {e}")
    else:
        print("No timezone provided, using given hour as UT")
    return decimal_hour


def _compute_age_points_planets(jd: float):
    from app import config as app_config

    # API/Chart order: Sun..Pluto, Node, Lilith, Chiron
    # Keep canonical API order so labels in age-point lists are not swapped.
    ephe_map = {
        0: 0,
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5,
        6: 6,
        7: 7,
        8: 8,
        9: 9,
        10: 10,
        11: 13,
        12: 15,
    }
    result = []
    for idx in range(13):
        ephe_id = ephe_map.get(idx, idx)
        s, lon_val, err = calc(jd, ephe_id, 4)
        if s < 0 and ephe_id == 15:
            try:
                app_config.init_swisseph_path()
                s, lon_val, err = calc(jd, ephe_id, 4)
            except Exception:
                pass
        if s < 0 and idx in (11, 12) and ephe_id != idx:
            try:
                s, lon_val, err = calc(jd, idx, 4)
            except Exception:
                pass
        if s < 0:
            raise HTTPException(status_code=500, detail=f"Fehler beim Berechnen von Planet {idx}: {err}")
        result.append(lon_val)
    return result


def _prepare_age_points_chart(request: AgePointsRequest) -> Chart:
    decimal_hour = _compute_decimal_hour(request)
    jd = julday(request.year, request.month, request.day, decimal_hour)
    pls = _compute_age_points_planets(jd)
    if not pls or len(pls) < 13:
        raise HTTPException(status_code=500, detail="Fehler beim Berechnen der Planeten")
    houses_list = houses(jd, request.latitude, request.longitude) or [None] * 12
    chart = Chart()
    chart.planets = pls[:]
    chart.houses = houses_list[:]
    chart.date = f"{request.year:04d}-{request.month:02d}-{request.day:02d}T{request.hour:02d}:{request.minute:02d}"
    chart.latitud = request.latitude
    chart.longitud = request.longitude
    chart.zone = getattr(request, 'timezone', '')
    return chart


def _calculate_age_points(chart: Chart, request: AgePointsRequest):
    if request.kind == "radix":
        plan = _build_plan_from_planets(chart.planets)
        return chart.calc_agep(plan, local=False)
    if request.kind == "local":
        plan = _build_plan_from_planets(chart.planets)
        return chart.calc_agep(plan, local=True)
    if request.kind == "soul":
        splan = chart.soulplan()
        plan = _build_plan_from_planets(splan)
        return chart.calc_agep(plan, local=False)
    if request.kind == "nodal":
        uplan = chart.urnodplan()
        plan = _build_plan_from_planets(uplan)
        return chart.calc_nodal_agep(plan)
    raise HTTPException(status_code=400, detail=f"Unbekannter kind: {request.kind}")


def _calculate_age_points_for_request(request: AgePointsRequest):
    chart = _prepare_age_points_chart(request)
    try:
        return _calculate_age_points(chart, request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Berechnen der Alterspunkte: {e}")


def _filter_age_points(age_points, target_year: Optional[int], target_month: Optional[int], target_day: Optional[int]):
    if target_year is None:
        return age_points

    try:
        year_value = int(target_year)
    except Exception:
        return age_points

    filtered = [ap for ap in age_points if int(ap.get('year', -1)) == year_value]

    if target_month is None or target_day is None:
        return filtered

    try:
        month_value = int(target_month)
        day_value = int(target_day)
    except Exception:
        return filtered

    exact_matches = [
        ap for ap in filtered
        if int(ap.get('mon', -1)) == month_value and int(ap.get('day', -1)) == day_value
    ]
    return exact_matches


def _build_transit_sections_for_summary(age_points, req: AgePointsRequest, http_request: Request):
    if not age_points:
        return []

    def _point_value(point, key):
        if isinstance(point, dict):
            return point.get(key)
        try:
            return getattr(point, key)
        except Exception:
            return None

    sections = []
    birth_date = DateObject(
        year=req.year,
        month=req.month,
        day=req.day,
        hour=req.hour,
        minute=req.minute,
        second=req.second,
        timezone=req.timezone,
    )
    birth_location = Location(latitude=req.latitude, longitude=req.longitude)
    transit_location = Location(latitude=req.latitude, longitude=req.longitude)

    for age_point in age_points:
        try:
            transit_year = int(_point_value(age_point, "year"))
            transit_month = int(_point_value(age_point, "mon"))
            transit_day = int(_point_value(age_point, "day"))
        except Exception:
            continue

        transit_date = DateObject(
            year=transit_year,
            month=transit_month,
            day=transit_day,
            hour=12,
            minute=0,
            second=0,
            timezone=req.timezone,
        )
        transit_request = TransitRequest(
            birthday=birth_date,
            birth_location=birth_location,
            transitdate=transit_date,
            transit_location=transit_location,
        )

        aspects = []
        try:
            transit_response = transits(transit_request, http_request)
            aspects = transit_response.aspects or []
        except Exception:
            aspects = []

        date_label = f"{transit_day:02d}.{transit_month:02d}.{transit_year}"
        if not aspects:
            sections.append(f"Transite für {date_label}: Keine Aspekte verfügbar.")
            continue

        lines = []
        for idx, aspect in enumerate(aspects, start=1):
            left = aspect.get("transit_name") or aspect.get("p1_name") or "-"
            right = aspect.get("natal_name") or aspect.get("p2_name") or "-"
            asp = aspect.get("aspect") or "Aspect"
            orb_value = aspect.get("orb")
            try:
                orb = f"{float(orb_value):.2f}"
            except Exception:
                orb = "-"
            lines.append(f"{idx}. {asp}: {left} → {right} (Orb: {orb})")

        sections.append(f"Transite für {date_label}:\n" + "\n".join(lines))

    return sections


def _build_target_year_summary(age_points, target_year: Optional[int], transit_sections: Optional[List[str]] = None):
    if not age_points:
        return None
    parts = []
    for a in age_points:
        day = a.get("day")
        mon = a.get("mon")
        year = a.get("year")
        lab = _translate_age_point_text(a.get("lab") or a.get("label") or "")
        try:
            parts.append(f"{int(day):02d}.{int(mon):02d}.{int(year)}: {lab}")
        except Exception:
            parts.append(f"{day}.{mon}.{year}: {lab}")
    if target_year:
        header = (
            f"Huber Astrologische Psychologie.\n\nErstelle eine Interpretation für folgende Alterspunkte im Jahr {target_year}:\n\n"
        )
    else:
        header = "Huber Astrologische Psychologie.\n\nErstelle eine Interpretation für folgenden Alterspunkt:\n\n"

    transit_block = ""
    if transit_sections:
        transit_block = "\n\nTransite:\n\n" + "\n\n".join(transit_sections)

    return header + "\n".join(parts) + transit_block + "\n\n" + get_general_anweisung()


def _build_age_points_response(req: AgePointsRequest, http_request: Request) -> AgePointsResponse:
    age_points = _calculate_age_points_for_request(req)
    filtered_points = _normalize_age_points(
        _filter_age_points(age_points, req.target_year, req.target_month, req.target_day)
    )

    transit_sections = None
    if filtered_points:
        transit_sections = _build_transit_sections_for_summary(filtered_points, req, http_request)

    summary_prompt = _build_target_year_summary(filtered_points, req.target_year, transit_sections)
    return AgePointsResponse(
        kind=req.kind,
        target_year=req.target_year,
        age_points=filtered_points,
        summary=append_additional_question(summary_prompt, getattr(req, 'additional_question', None)),
    )


@router.post("/age-points", response_model=AgePointsResponse)
def get_age_points(req: AgePointsRequest, http_request: Request):
    """Berechnet Alterspunkte mittels `Chart.calc_agep` für das gegebene Radix.

    Der Endpoint baut ein `Chart`-Objekt, füllt `planets` und `houses` mit
    ephemeriden-berechneten Werten zum Geburts-JD, setzt `chart.date` und ruft
    anschließend `calc_agep` auf. Aktuell wird nur `kind=="radix"` vollständig
    unterstützt.
    """

    result = _build_age_points_response(req, http_request)
    if result.summary:
        try:
            user = _get_user_from_request(http_request)
            role_name = _resolve_role_name_for_age_points(http_request, req)
            perplexity_client = PerplexityClient(role_type=role_name)
            cached_summary = perplexity_client.get_cached_summary(result.summary, AGE_POINTS_SYSTEM_PROMPT)
            if cached_summary is not None:
                result.summary = cached_summary
            else:
                rate_limit = check_ai_rate_limit(http_request, user_id=user['id'] if user else None, scope='ai:age-points')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(http_request),
                        user_agent=http_request.headers.get('user-agent'),
                        detail='Age-points interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
                result.summary = perplexity_client.send_summary_text(result.summary, AGE_POINTS_SYSTEM_PROMPT)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Error getting AI summary for /age-points")
            raise HTTPException(status_code=502, detail=f"Fehler beim Abrufen der KI-Antwort: {exc}")
    return result


@router.post("/age-points/stream")
async def get_age_points_stream(req: AgePointsRequest, http_request: Request):
    cached_summary = None
    perplexity_client = None
    try:
        result = _build_age_points_response(req, http_request)
        response_data = result.model_dump()
        summary_prompt = response_data.pop("summary")
        if summary_prompt:
            user = _get_user_from_request(http_request)
            role_name = _resolve_role_name_for_age_points(http_request, req)
            perplexity_client = PerplexityClient(role_type=role_name)
            cached_summary = perplexity_client.get_cached_summary(summary_prompt, AGE_POINTS_SYSTEM_PROMPT)
            if cached_summary is None:
                rate_limit = check_ai_rate_limit(http_request, user_id=user['id'] if user else None, scope='ai:age-points')
                if not rate_limit.allowed:
                    log_auth_event(
                        event_type='ai_rate_limited',
                        success=False,
                        username=user.get('username') if user else None,
                        user_id=user.get('id') if user else None,
                        ip_address=get_client_ip(http_request),
                        user_agent=http_request.headers.get('user-agent'),
                        detail='Age-points stream interpretation rate limit exceeded',
                    )
                    raise HTTPException(
                        status_code=429,
                        detail=build_ai_rate_limit_error_detail(rate_limit),
                        headers={'Retry-After': str(rate_limit.retry_after_seconds)},
                    )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error preparing /age-points/stream")
        raise HTTPException(status_code=400, detail=f"Fehler beim Berechnen der Alterspunkte: {exc}")

    async def event_stream():
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
                            context_type="age_points",
                            model=perplexity_client.model,
                            interp_year=getattr(req, 'target_year', None),
                            interp_month=getattr(req, 'target_month', None),
                            interp_day=getattr(req, 'target_day', None),
                            interp_hour=None,
                            interp_minute=None,
                            location_latitude=getattr(req, 'latitude', None),
                            location_longitude=getattr(req, 'longitude', None),
                        )
                        yield _sse_event("saved", {"interpretation_id": _interp_id})
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save cached interpretation for age-points")
            return

        try:
            if summary_prompt:
                async for chunk in perplexity_client.send_summary_stream(
                    summary=summary_prompt,
                    system_prompt=AGE_POINTS_SYSTEM_PROMPT,
                ):
                    summary_parts.append(chunk)
                    yield _sse_event("summary_delta", {"content": chunk})

            if summary_prompt and not summary_parts:
                try:
                    text = await asyncio.to_thread(
                        perplexity_client.send_summary_text,
                        summary_prompt,
                        AGE_POINTS_SYSTEM_PROMPT,
                    )
                    summary_parts = [text]
                except Exception:
                    logger.exception("Synchronous fallback to send_summary_text failed for age-points")

            full_summary = "".join(summary_parts)
            if summary_prompt and full_summary:
                try:
                    resolved_prompt = perplexity_client._resolve_system_prompt(AGE_POINTS_SYSTEM_PROMPT)
                    key = _make_cache_key(summary_prompt, resolved_prompt, perplexity_client.model)
                    _cache_set(key, full_summary)
                except Exception:
                    logger.exception("Failed to set Perplexity cache for age-points")

            yield _sse_event("done", {"summary": full_summary})
            logger.info("AGE-POINTS SAVE CHECK: summary_prompt=%s full_summary_len=%d user=%s",
                        bool(summary_prompt), len(full_summary), user)
            if summary_prompt and full_summary and user:
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
                            context_type="age_points",
                            model=perplexity_client.model,
                            interp_year=getattr(req, 'target_year', None),
                            interp_month=getattr(req, 'target_month', None),
                            interp_day=getattr(req, 'target_day', None),
                            interp_hour=None,
                            interp_minute=None,
                            location_latitude=getattr(req, 'latitude', None),
                            location_longitude=getattr(req, 'longitude', None),
                        )
                        yield _sse_event("saved", {"interpretation_id": _interp_id})
                    finally:
                        db.close()
                except Exception:
                    logger.exception("Failed to save interpretation after age-points stream")
        except Exception as exc:
            logger.exception("Error streaming /age-points/stream")
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


@router.post("/age-points/full", response_model=List[AgePoint])
def get_full_age_points(request: AgePointsRequest):
    """Erstellt die vollständige Alterspunkte-Kette (ca. 72 Jahre) für das Radix."""

    return _normalize_age_points(_calculate_age_points_for_request(request))


@public_router.get(
    "/age-points/ap-graphic",
    responses={200: {"content": {"image/png": {}}}},
)
def get_age_point_graphic():
    resource_path = Path(__file__).resolve().parents[2] / "astronex" / "resources" / "ap.png"
    if not resource_path.exists():
        raise HTTPException(status_code=404, detail="ap.png wurde nicht gefunden")
    return FileResponse(str(resource_path), media_type="image/png")


@router.post("/age-points/ap-marker", response_model=AgePointMarkerResponse)
def get_age_point_marker(request: AgePointMarkerRequest):
    birth_request = AgePointsRequest(
        year=request.year,
        month=request.month,
        day=request.day,
        hour=request.hour,
        minute=request.minute,
        second=request.second,
        latitude=request.latitude,
        longitude=request.longitude,
        timezone=request.timezone,
        kind=request.kind,
    )
    chart = _prepare_age_points_chart(birth_request)
    transit_dt = datetime(
        request.transit_year,
        request.transit_month,
        request.transit_day,
        request.transit_hour,
        request.transit_minute,
        request.transit_second,
    )
    cycles = chart.get_cycles(transit_dt)
    pe = chart.which_degree_today(transit_dt, cycles, request.kind)
    if request.kind == 'nodal':
        pedraw = pe + 180 - chart.planets[10]
    else:
        pedraw = 180 + chart.houses[0] - pe
    pedraw = pedraw % 360.0
    rad = math.radians(pedraw)
    # Align marker radial position with planet ring in transit charts
    planet_ring_percent = 27.0
    x_percent = 50.0 + planet_ring_percent * math.cos(rad)
    y_percent = 50.0 + planet_ring_percent * math.sin(rad)
    return AgePointMarkerResponse(
        pe_degree=round(float(pe), 6),
        draw_degree=round(float(pedraw), 6),
        x_percent=round(float(x_percent), 6),
        y_percent=round(float(y_percent), 6),
    )
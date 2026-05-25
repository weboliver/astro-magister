"""Public ascendant endpoint — computes ascendant sign via Swiss Ephemeris."""
from fastapi import APIRouter, HTTPException, Query
from app.services.ephemeris import julday, houses
from app.static.zodiac_names import get_zodiac_name
from pytz import timezone as pytz_timezone

router = APIRouter(tags=["ascendant"])


@router.get("/ascendant")
def get_ascendant(
    birth_year: int = Query(...),
    birth_month: int = Query(...),
    birth_day: int = Query(...),
    birth_hour: float = Query(12.0),
    birth_minute: float = Query(0),
    birth_second: int = Query(0),
    birth_timezone: str = Query("UTC"),
    birth_latitude: float = Query(0.0),
    birth_longitude: float = Query(0.0),
):
    """Public — compute ascendant sign from birth data via Swiss Ephemeris."""
    from datetime import datetime

    naive_dt = datetime(birth_year, birth_month, birth_day, int(birth_hour), int(birth_minute), birth_second)
    try:
        local_tz = pytz_timezone(birth_timezone)
    except Exception:
        local_tz = pytz_timezone("UTC")
    try:
        local_dt = local_tz.localize(naive_dt, is_dst=True)
    except Exception:
        local_dt = pytz_timezone("UTC").localize(naive_dt)
    utc_dt = local_dt.astimezone(pytz_timezone("UTC"))
    decimal_hour = utc_dt.hour + utc_dt.minute / 60.0 + utc_dt.second / 3600.0

    jd = julday(birth_year, birth_month, birth_day, decimal_hour)
    h = houses(jd, birth_latitude, birth_longitude)
    if not h or len(h) < 1:
        raise HTTPException(status_code=400, detail="Could not compute houses")
    asc_sign_idx = int(h[0] / 30) % 12
    return {"ascendant_sign_index": asc_sign_idx, "ascendant_sign": get_zodiac_name(asc_sign_idx)}

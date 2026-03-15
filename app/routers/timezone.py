from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import datetime, timezone
from app.routers.auth import require_authenticated_user

router = APIRouter(dependencies=[Depends(require_authenticated_user)])

@router.get('/tzfromcoords')
async def tz_from_coords(lat: float = Query(...), lon: float = Query(...), timestamp: Optional[str] = Query(None)):
    """Return IANA timezone and UTC offset for given coordinates.
    Optional `timestamp` can be an ISO datetime or unix seconds; if omitted current UTC time is used for offset.
    """
    try:
        from timezonefinder import TimezoneFinder
    except Exception:
        return {"tz": None, "error": "timezonefinder not installed"}
    tf = TimezoneFinder()
    tzname = tf.timezone_at(lat=lat, lng=lon)
    if not tzname:
        tzname = tf.closest_timezone_at(lat=lat, lng=lon)
    # compute offset in hours for given timestamp
    offset_seconds = None
    if tzname:
        try:
            # parse timestamp
            if timestamp is None:
                dt = datetime.now(timezone.utc)
            else:
                try:
                    # try integer unix seconds
                    ts = int(timestamp)
                    dt = datetime.fromtimestamp(ts, timezone.utc)
                except Exception:
                    # try ISO format
                    try:
                        dt = datetime.fromisoformat(timestamp)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        else:
                            dt = dt.astimezone(timezone.utc)
                    except Exception:
                        dt = datetime.now(timezone.utc)
            # zoneinfo for offset
            try:
                from zoneinfo import ZoneInfo
                z = ZoneInfo(tzname)
                offset = dt.astimezone(z).utcoffset()
                if offset is not None:
                    offset_seconds = int(offset.total_seconds())
            except Exception:
                offset_seconds = None
        except Exception:
            offset_seconds = None
    return {"tz": tzname, "offset_seconds": offset_seconds}

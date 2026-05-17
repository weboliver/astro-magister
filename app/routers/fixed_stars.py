from fastapi import APIRouter, Depends, HTTPException, Query
from pathlib import Path
from app.services.ephemeris import julday, fixstar, setpath
from app.schemas.datetime_models import DateTimeRequest, FixstarResponse
from app import config as app_config
from app.routers.auth import require_authenticated_user

router = APIRouter(tags=["fixed-stars"], dependencies=[Depends(require_authenticated_user)])

@router.post("/fixstar", response_model=FixstarResponse)
def get_fixstar(
    request: DateTimeRequest,
    star_name: str = Query(..., description="Fixed star name (e.g., 'Sirius')"),
):
    """Calculate fixed star position using Swiss Ephemeris.

    Args:
        request: DateTimeRequest with year, month, day, hour, minute, second.
        star_name: Fixed star name (e.g., 'Sirius', 'Polaris', 'Aldebaran').

    Returns:
        FixstarResponse with star position, coordinates, and speeds.

    Raises:
        HTTPException: On calculation error or star not found.
    """
    try:
        decimal_hour = request.hour + request.minute / 60.0 + request.second / 3600.0
        jd = julday(request.year, request.month, request.day, decimal_hour)
        try:
            if app_config.EPHE_PATH:
                setpath(app_config.EPHE_PATH)
        except Exception:
            pass
        result = fixstar(star_name, jd)
        if len(result) != 4:
            raise HTTPException(status_code=400, detail=f"Invalid response from fixstar calculation")
        flags, star_normalized, coords, error = result
        if error:
            raise HTTPException(status_code=400, detail=f"Star calculation error: {error}")
        if flags < 0:
            raise HTTPException(status_code=400, detail=f"Star not found: {star_name}")
        lon, lat, dist, speed_lon, speed_lat, speed_dist = coords
        return FixstarResponse(
            star_name=star_name,
            year=request.year,
            month=request.month,
            day=request.day,
            hour=decimal_hour,
            julian_day=jd,
            longitude=lon,
            latitude=lat,
            speed_lon=speed_lon,
            speed_lat=speed_lat,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating fixed star position: {str(e)}")

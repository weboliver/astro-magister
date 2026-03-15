from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import require_authenticated_user
from app.schemas.datetime_models import (
    DateResponse,
    DateTimeRequest,
    JuldayRequest,
    JuldayResponse,
    RevjulRequest,
    SidtimeResponse,
)
from app.services.ephemeris import julday, revjul, sidtime

router = APIRouter(tags=["date-time"], dependencies=[Depends(require_authenticated_user)])


def split_decimal_hour(decimal_hour):
    """Split a decimal hour into (hour, minute, second) ints."""
    try:
        hour_int = int(decimal_hour)
        rem_min = (decimal_hour - hour_int) * 60.0
        minute_int = int(rem_min)
        sec = (rem_min - minute_int) * 60.0
        second_int = int(round(sec))
        if second_int >= 60:
            second_int -= 60
            minute_int += 1
        if minute_int >= 60:
            minute_int -= 60
            hour_int += 1
        return hour_int, minute_int, second_int
    except Exception:
        try:
            return int(decimal_hour), 0, 0
        except Exception:
            return 0, 0, 0


@router.post("/julday", response_model=JuldayResponse)
def get_julday(request: JuldayRequest):
    try:
        decimal_hour = request.hour + request.minute / 60.0 + request.second / 3600.0
        jd = julday(request.year, request.month, request.day, decimal_hour)
        return JuldayResponse(julian_day=jd)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating Julian Day: {str(e)}")


@router.post("/revjul", response_model=DateResponse)
def get_revjul(request: RevjulRequest):
    try:
        gregflag = 1 if request.gregorian_calendar else 0
        y, m, d, h = revjul(request.julian_day, gregflag)
        hour_int, minute_int, second_int = split_decimal_hour(h)
        return DateResponse(
            year=int(y),
            month=int(m),
            day=int(d),
            hour=hour_int,
            minute=minute_int,
            second=second_int,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error converting Julian Day: {str(e)}")


@router.post("/sidtime", response_model=SidtimeResponse)
def get_sidtime(request: DateTimeRequest):
    try:
        decimal_hour = request.hour + request.minute / 60.0 + request.second / 3600.0
        jd = julday(request.year, request.month, request.day, decimal_hour)
        st = sidtime(jd)
        hour_int, minute_int, second_int = split_decimal_hour(decimal_hour)
        return SidtimeResponse(
            year=request.year,
            month=request.month,
            day=request.day,
            hour=hour_int,
            minute=minute_int,
            second=second_int,
            julian_day=jd,
            sidereal_time=st,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error calculating sidereal time: {str(e)}")
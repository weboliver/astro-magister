

from typing import Optional

from pydantic import BaseModel


class ProfileOut(BaseModel):
    id: Optional[int] = None
    username: Optional[str] = None
    role_id: Optional[int] = 1
    birth_year: Optional[int] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_hour: Optional[int] = None
    birth_minute: Optional[int] = None
    birth_second: Optional[int] = None
    birth_latitude: Optional[float] = None
    birth_longitude: Optional[float] = None
    birth_place: Optional[str] = None
    birth_country: Optional[str] = None
    birth_region: Optional[str] = None
    birth_city: Optional[str] = None
    birth_timezone: Optional[str] = None
    residence_latitude: Optional[float] = None
    residence_longitude: Optional[float] = None
    residence_place: Optional[str] = None
    residence_country: Optional[str] = None
    residence_region: Optional[str] = None
    residence_city: Optional[str] = None
    residence_timezone: Optional[str] = None
    isadmin: Optional[bool] = None
    is_poweruser: Optional[bool] = None


class ProfileIn(BaseModel):
    role_id: Optional[int] = 1
    birth_year: Optional[int] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_hour: Optional[int] = None
    birth_minute: Optional[int] = None
    birth_second: Optional[int] = None
    birth_latitude: Optional[float] = None
    birth_longitude: Optional[float] = None
    birth_place: Optional[str] = None
    birth_country: Optional[str] = None
    birth_region: Optional[str] = None
    birth_city: Optional[str] = None
    birth_timezone: Optional[str] = None
    residence_latitude: Optional[float] = None
    residence_longitude: Optional[float] = None
    residence_place: Optional[str] = None
    residence_country: Optional[str] = None
    residence_region: Optional[str] = None
    residence_city: Optional[str] = None
    residence_timezone: Optional[str] = None
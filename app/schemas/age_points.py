from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AgePointsRequest(BaseModel):
    person_id: Optional[int] = Field(None, description="Optional ID of the selected saved person")
    year: int = Field(..., ge=1, le=3000, description="Jahreszahl des Radix")
    month: int = Field(..., ge=1, le=12, description="Monat des Radix")
    day: int = Field(..., ge=1, le=31, description="Tag des Radix")
    hour: int = Field(default=12, ge=0, le=23, description="Stunde (0-23)")
    minute: int = Field(default=0, ge=0, le=59, description="Minute (0-59)")
    second: int = Field(default=0, ge=0, le=59, description="Sekunde (0-59)")
    latitude: float = Field(default=0.0, ge=-90, le=90, description="Geografische Breite für Häuser")
    longitude: float = Field(default=0.0, ge=-180, le=180, description="Geografische Länge für Häuser")
    timezone: Optional[str] = Field(None, description="IANA Zeitzone (z.B. Europe/Berlin). Wenn angegeben wird lokale Zeit nach UTC konvertiert")
    kind: Literal["radix", "local", "soul", "nodal"] = Field("radix", description="Progressionsart")
    target_year: Optional[int] = Field(None, description="If set, only return age points in this year")
    target_month: Optional[int] = Field(None, ge=1, le=12, description="If set with target_year/day, return only this exact age point month")
    target_day: Optional[int] = Field(None, ge=1, le=31, description="If set with target_year/month, return only this exact age point day")

class AgePoint(BaseModel):
    day: str
    mon: str
    year: int
    lab: str
    cl: str

class AgePointsResponse(BaseModel):
    kind: str
    target_year: Optional[int] = None
    age_points: List[AgePoint]
    summary: Optional[str] = None


class AgePointMarkerRequest(BaseModel):
    person_id: Optional[int] = Field(None, description="Optional ID of the selected saved person")
    year: int = Field(..., ge=1, le=3000)
    month: int = Field(..., ge=1, le=12)
    day: int = Field(..., ge=1, le=31)
    hour: int = Field(default=12, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    second: int = Field(default=0, ge=0, le=59)
    latitude: float = Field(default=0.0, ge=-90, le=90)
    longitude: float = Field(default=0.0, ge=-180, le=180)
    timezone: Optional[str] = Field(None)
    kind: Literal["radix", "local", "soul", "nodal"] = Field("radix")
    transit_year: int = Field(..., ge=1, le=3000)
    transit_month: int = Field(..., ge=1, le=12)
    transit_day: int = Field(..., ge=1, le=31)
    transit_hour: int = Field(default=12, ge=0, le=23)
    transit_minute: int = Field(default=0, ge=0, le=59)
    transit_second: int = Field(default=0, ge=0, le=59)


class AgePointMarkerResponse(BaseModel):
    pe_degree: float
    draw_degree: float
    x_percent: float
    y_percent: float

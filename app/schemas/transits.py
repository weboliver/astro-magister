from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Location(BaseModel):
    latitude: float = Field(default=0.0, ge=-90, le=90, description="Geografische Breite für Häuser")
    longitude: float = Field(default=0.0, ge=-180, le=180, description="Geografische Länge für Häuser")

class DateObject(BaseModel):
    year: int
    month: int
    day: int
    hour: int = 12
    minute: int = 0
    second: int = 0
    timezone: Optional[str] = None


class TransitRequest(BaseModel):
    person_id: Optional[int] = Field(default=None, description="Optional ID of the selected saved person")
    birthday: DateObject
    birth_location: Location
    transitdate: DateObject
    transit_location: Location
    groupby: Optional[str] = Field(default="aspect", description="Group aspects by 'aspect' or 'planet'")
    filterplanets: Optional[List[str]] = Field(default=None, description="Optional list of transit planet names or ids to evaluate")


class PlanetOut(BaseModel):
    planet_id: int
    planet_name: str
    longitude: float
    sign_index: int
    sign: Optional[str]
    sign_degree: Optional[str]
    house_index: Optional[int]
    house: Optional[int]
    house_degree: Optional[str]
    # house placements relative to the other chart
    house_at_transit_index: Optional[int] = None
    house_at_transit: Optional[int] = None
    house_at_transit_degree: Optional[str] = None
    house_at_natal_index: Optional[int] = None
    house_at_natal: Optional[int] = None
    house_at_natal_degree: Optional[str] = None


class TransitResponse(BaseModel):
    aspects: Optional[List[dict]] = None
    grouped_aspects: Optional[Dict[str, List[dict]]] = None
    summary: Optional[str] = None


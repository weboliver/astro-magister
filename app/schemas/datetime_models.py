from pydantic import BaseModel, Field
from typing import Optional, List, Literal

class JuldayRequest(BaseModel):
    """Request to convert datetime to Julian Day."""

    year: int = Field(..., description="Year")
    month: int = Field(..., ge=1, le=12, description="Month (1-12)")
    day: int = Field(..., ge=1, le=31, description="Day (1-31)")
    hour: int = Field(default=12, ge=0, le=23, description="Hour (0-23)")
    minute: int = Field(default=0, ge=0, le=59, description="Minute (0-59)")
    second: int = Field(default=0, ge=0, le=59, description="Second (0-59)")


class JuldayResponse(BaseModel):
    """Response with Julian Day number."""

    julian_day: float = Field(..., description="Julian Day Number")


class RevjulRequest(BaseModel):
    """Request to convert Julian Day to calendar date."""

    julian_day: float = Field(..., description="Julian Day Number")
    gregorian_calendar: bool = Field(default=True, description="Use Gregorian calendar")


class DateResponse(BaseModel):
    """Calendar date components."""

    year: int
    month: int
    day: int
    hour: int
    minute: int
    second: int


class DateTimeRequest(BaseModel):
    """Full datetime request with location for astrological calculations."""

    person_id: Optional[int] = Field(None, description="Optional ID of the selected saved person whose role should be used for interpretation")
    interpretation_id: Optional[int] = Field(None, description="ID einer bestehenden Interpretations-Session; wenn gesetzt wird die Frage daran angehängt statt eine neue Session anzulegen")
    additional_question: Optional[str] = Field(None, max_length=255, description="Optional follow-up question that should be considered in the AI interpretation")
    year: int = Field(..., description="Year", json_schema_extra={"example": 2000})
    month: int = Field(..., ge=1, le=12, description="Month (1-12)", json_schema_extra={"example": 1})
    day: int = Field(..., ge=1, le=31, description="Day (1-31)", json_schema_extra={"example": 1})
    hour: int = Field(default=12, ge=0, le=23, description="Hour (0-23)", json_schema_extra={"example": 12})
    minute: int = Field(default=0, ge=0, le=59, description="Minute (0-59)", json_schema_extra={"example": 0})
    second: int = Field(default=0, ge=0, le=59, description="Second (0-59)", json_schema_extra={"example": 0})
    timezone: Optional[str] = Field(None, description="IANA timezone name for the given datetime (e.g. 'Europe/Berlin')")
    latitude: float = Field(default=0.0, ge=-90, le=90, description="Geographic latitude for relevant calculations", json_schema_extra={"example": 48.8566})
    longitude: float = Field(default=0.0, ge=-180, le=180, description="Geographic longitude for relevant calculations", json_schema_extra={"example": 2.3522})


class SidtimeResponse(BaseModel):
    """Sidereal time response."""

    year: int
    month: int
    day: int
    hour: float
    minute: int
    second: int
    julian_day: float
    sidereal_time: float = Field(..., description="Sidereal time in hours")


class PlanetPosition(BaseModel):
    """Position of a single planet with sign and house information."""

    planet_id: int = Field(..., description="Planet ID (0=Sun, 1=Moon, etc)")
    planet_name: str = Field(..., description="Planet name")
    longitude: float = Field(..., description="Ecliptic longitude in degrees")
    house_index: Optional[int] = Field(None, description="0-based house index for planet")
    house: Optional[int] = Field(None, description="1-based house number for planet (1-12)")
    sign_index: Optional[int] = Field(None, description="0-based zodiac sign index (0=Aries..11=Pisces)")
    sign: Optional[str] = Field(None, description="Zodiac sign name in which the planet is located")
    sign_degree: Optional[str] = Field(None, description="Formatted degree within the sign, e.g. '05°23′'")
    house_degree: Optional[str] = Field(None, description="Formatted degree within the house, e.g. '05°23′'")


class Aspect(BaseModel):
    """Aspect between two planets."""

    p1: int = Field(..., description="Index of first planet")
    p2: int = Field(..., description="Index of second planet")
    p1_name: Optional[str] = Field(None, description="Name of first planet")
    p2_name: Optional[str] = Field(None, description="Name of second planet")
    a: int = Field(..., description="Aspect type index")
    f1: Optional[float] = Field(None, description="Aspect strength factor for p1")
    f2: Optional[float] = Field(None, description="Aspect strength factor for p2")
    gw: Optional[bool] = Field(False, description="Grauwert / weak aspect flag")
    label: str = Field(..., description="Aspect label (e.g. trig, opos, sext)")
    separation: Optional[float] = Field(None, description="Angular separation in degrees")


class CalcResponse(BaseModel):
    """Planetary calculation response with positions and aspects."""

    year: int
    month: int
    day: int
    hour: float
    julian_day: float
    planets: List[PlanetPosition]
    status: int = Field(..., description="Calculation status (0=OK, <0=error)")
    summary: Optional[str] = Field(None, description="Concise summary for the calculation (single-planet calc)")


class HousesResponse(BaseModel):
    """House cusps response with sign and degree information."""

    year: int
    month: int
    day: int
    hour: float
    julian_day: float
    latitude: float
    longitude: float

    class HouseEntry(BaseModel):
        """Single house cusp entry."""

        house: int = Field(..., description="House number (1-12)")
        longitude: float = Field(..., description="Absolute ecliptic longitude of the house cusp in degrees")
        sign_index: int = Field(..., description="0-based zodiac sign index (0=Aries..11=Pisces)")
        sign: str = Field(..., description="Zodiac sign name for the cusp (English)")
        sign_degree: str = Field(..., description="Formatted degree within the sign, e.g. '05°23′'")

    houses: List[HouseEntry] = Field(..., description="12 house cusps with sign and degree within sign")
    summary: Optional[str] = Field(None, description="Concise houses summary, e.g. 'Houses: AC - Pisces (12°09′); ...')")


class FixstarResponse(BaseModel):
    """Fixed star position response."""

    star_name: str
    year: int
    month: int
    day: int
    hour: float
    julian_day: float
    longitude: float
    latitude: float
    speed_lon: float = Field(..., description="Speed in longitude")
    speed_lat: float = Field(..., description="Speed in latitude")


class SolarReturnRequest(BaseModel):
    """Request for solar return calculation."""

    person_id: Optional[int] = Field(None, description="Optional ID of the selected saved person whose role should be used for interpretation")
    interpretation_id: Optional[int] = Field(None, description="ID einer bestehenden Interpretations-Session; wenn gesetzt wird die Frage daran angehängt")
    additional_question: Optional[str] = Field(None, max_length=255, description="Optional follow-up question that should be considered in the AI interpretation")
    birth_year: int = Field(..., description="Birth year", json_schema_extra={"example": 1990})
    birth_month: int = Field(..., ge=1, le=12, description="Birth month", json_schema_extra={"example": 6})
    birth_day: int = Field(..., ge=1, le=31, description="Birth day", json_schema_extra={"example": 15})
    birth_hour: int = Field(default=12, ge=0, le=23, description="Birth hour (0-23)", json_schema_extra={"example": 10})
    birth_minute: int = Field(default=0, ge=0, le=59, description="Birth minute (0-59)", json_schema_extra={"example": 30})
    birth_second: int = Field(default=0, ge=0, le=59, description="Birth second (0-59)", json_schema_extra={"example": 0})
    target_year: Optional[int] = Field(None, description="Year of the solar return (defaults to birth_year + 1)", json_schema_extra={"example": 2026})
    timezone: Optional[str] = Field(None, description="IANA timezone name for birth location (e.g. 'Europe/Berlin')")
    latitude: float = Field(default=0.0, ge=-90, le=90, description="Geographic latitude for house calculation", json_schema_extra={"example": 48.8566})
    longitude: float = Field(default=0.0, ge=-180, le=180, description="Geographic longitude for house calculation", json_schema_extra={"example": 2.3522})


class SolarReturnResponse(BaseModel):
    """Solar return calculation response."""

    target_year: int = Field(..., description="Year used for the solar return")
    return_year: int = Field(..., description="Calendar year of the solar return instant")
    return_month: int = Field(..., description="Calendar month of the solar return instant")
    return_day: int = Field(..., description="Calendar day of the solar return instant")
    return_hour: float = Field(..., description="Hour (UTC) of the solar return instant")
    julian_day: float = Field(..., description="Julian Day of the solar return")
    natal_sun_longitude: float = Field(..., description="Sun longitude at birth (deg)")
    solar_return_longitude: float = Field(..., description="Sun longitude at return (deg)")
    longitude_difference: float = Field(..., description="Residual difference birth vs. return (deg)")
    iterations: int = Field(..., description="Iterations used to converge")
    planets: list[PlanetPosition] = Field(..., description="Planetenpositionen zum Solar-Return-Zeitpunkt")
    houses: list[float] = Field(..., description="12 Häuser zum Solar-Return-Zeitpunkt (Placidus)")
    aspects: List[Aspect] = Field(..., description="Aspekte zwischen Planeten zum Solar-Return-Zeitpunkt")
    summary: str = Field(..., description="Kurztext-Zusammenfassung des Solarhoroskops für KI-Input")


class LocationQuery(BaseModel):
    """Location query for geocoding."""

    country: str = Field(..., description="Country code or table name (e.g. 'DE' or 'US')")
    city: str = Field(..., description="City name")
    bezirk: str = Field(..., description="Region/district code (AC) for the city)")


class PositionResponse(BaseModel):
    """Geocoded position response."""

    country_code: Optional[str] = Field(None, description="Country code from DB")
    country: Optional[str] = Field(None, description="Country name")
    region_code: Optional[str] = Field(None, description="Region/district code (AC)")
    region: Optional[str] = Field(None, description="Region name")
    city: Optional[str] = Field(None, description="City name")
    latitude: Optional[float] = Field(None, description="Latitude in decimal degrees")
    longitude: Optional[float] = Field(None, description="Longitude in decimal degrees")


class SynastryRequest(BaseModel):
    """Request schema for synastry (two-person comparison) interpretation and chart rendering.

    Sends person IDs only — backend fetches birth data from user_persons table by ID.
    comparison_mode controls which chart drawing operation is used (click_hh = House-House, click_rr = Radix-Radix).
    """
    person_a_id: Optional[int] = Field(None, description="Person A's user_persons.id (None = logged-in user's own profile)")
    person_b_id: Optional[int] = Field(None, description="Person B's user_persons.id (None = logged-in user's own profile)")
    comparison_mode: Literal["hh", "rr"] = Field(
        default="hh",
        description="Comparison chart type: 'hh' = Häuservergleich (House-House), 'rr' = Radixvergleich (Radix-Radix)"
    )
    interpretation_id: Optional[int] = Field(None, description="ID of existing interpretation session for follow-up")
    additional_question: Optional[str] = Field(None, max_length=255, description="Optional follow-up question")
    person_a_name: Optional[str] = Field(None, max_length=200, description="Display name of Person A")
    person_b_name: Optional[str] = Field(None, max_length=200, description="Display name of Person B")

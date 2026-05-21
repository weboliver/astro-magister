from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    """Message creation schema."""

    role: Literal["user", "query", "assistant"]
    content: str
    position: int


class InterpretationCreate(BaseModel):
    """Interpretation session creation schema."""

    user_persons_id: Optional[int] = None
    user_person_id_2: Optional[int] = None
    context_type: Optional[str] = Field(None, max_length=64)
    comparison_mode: Optional[str] = Field(None, max_length=8)
    model: Optional[str] = Field(None, max_length=64)
    interp_year: Optional[int] = None
    interp_month: Optional[int] = None
    interp_day: Optional[int] = None
    interp_hour: Optional[int] = None
    interp_minute: Optional[int] = None
    location_country: Optional[str] = None
    location_region: Optional[str] = None
    location_city: Optional[str] = None
    location_longitude: Optional[float] = None
    location_latitude: Optional[float] = None
    transit_location_latitude: Optional[float] = None
    transit_location_longitude: Optional[float] = None
    messages: List[MessageCreate] = []


class FollowupMessageCreate(BaseModel):
    """Followup message for existing interpretation session."""

    content: str = Field(..., min_length=1, max_length=4096)


class MessageOut(BaseModel):
    """Message output schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
    role: str
    content: str
    created: datetime


class InterpretationOut(BaseModel):
    """Interpretation session output with all details."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_persons_id: Optional[int] = None
    user_person_id_2: Optional[int] = None
    context_type: Optional[str] = None
    comparison_mode: Optional[str] = None
    model: Optional[str] = None
    interp_year: Optional[int] = None
    interp_month: Optional[int] = None
    interp_day: Optional[int] = None
    interp_hour: Optional[int] = None
    interp_minute: Optional[int] = None
    location_country: Optional[str] = None
    location_region: Optional[str] = None
    location_city: Optional[str] = None
    location_longitude: Optional[float] = None
    location_latitude: Optional[float] = None
    transit_location_latitude: Optional[float] = None
    transit_location_longitude: Optional[float] = None
    created: datetime
    messages: List[MessageOut] = []


class InterpretationListItem(BaseModel):
    """Interpretation list item for summaries."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    context_type: Optional[str] = None
    created: datetime
    interp_year: Optional[int] = None
    interp_month: Optional[int] = None
    interp_day: Optional[int] = None
    location_city: Optional[str] = None
    user_persons_id: Optional[int] = None
    user_person_id_2: Optional[int] = None
    comparison_mode: Optional[str] = None
    first_question: Optional[str] = None
    user_person_name: Optional[str] = None
    user_person_2_name: Optional[str] = None


class InterpretationCreatedOut(BaseModel):
    """Response after creating interpretation."""

    id: int

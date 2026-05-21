from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import auth as auth_service
from app.routers.auth import _get_user_from_request

router = APIRouter()


class PersonBase(BaseModel):
    role_id: Optional[int] = 1
    name: str
    residence_country: Optional[str] = None
    residence_region: Optional[str] = None
    residence_city: Optional[str] = None
    residence_latitude: Optional[float] = None
    residence_longitude: Optional[float] = None
    residence_timezone: Optional[str] = None
    birth_year: Optional[int] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_hour: Optional[int] = None
    birth_minute: Optional[int] = None
    birth_second: Optional[int] = None
    birth_country: Optional[str] = None
    birth_region: Optional[str] = None
    birth_city: Optional[str] = None
    birth_latitude: Optional[float] = None
    birth_longitude: Optional[float] = None
    birth_timezone: Optional[str] = None


class PersonIn(PersonBase):
    pass


class PersonOut(PersonBase):
    id: int


@router.get('/auth/persons', response_model=List[PersonOut])
def list_persons(request: Request):
    """List all persons for the authenticated user.

    Args:
        request: FastAPI Request.

    Returns:
        List of PersonOut objects.

    Raises:
        HTTPException: If not authenticated.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail='Unauthorized')
    persons = auth_service.list_persons(user['id'])
    return persons


@router.post('/auth/persons', response_model=PersonOut, status_code=201)
def create_person(payload: PersonIn, request: Request):
    """Create a new person profile (powerusers only).

    Args:
        payload: PersonIn with person data.
        request: FastAPI Request.

    Returns:
        Created PersonOut object.

    Raises:
        HTTPException: If not authenticated or not a poweruser.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail='Unauthorized')
    if not auth_service.is_poweruser(user['id']):
        raise HTTPException(
            status_code=403,
            detail='Personen anlegen ist Mitgliedern mit Spenderstatus vorbehalten. Bitte unterstützen Sie uns über Buy me a coffee: https://buymeacoffee.com/shinengakic',
        )
    person_id = auth_service.create_person(user['id'], payload.model_dump())
    if not person_id:
        raise HTTPException(status_code=500, detail='Could not save person')
    person = auth_service.get_person(user['id'], person_id)
    if not person:
        raise HTTPException(status_code=500, detail='Could not read person data after creation')
    return person


@router.get('/auth/persons/{person_id}', response_model=PersonOut)
def get_person(person_id: int, request: Request):
    """Get a specific person by ID.

    Args:
        person_id: ID of person to retrieve.
        request: FastAPI Request.

    Returns:
        PersonOut object.

    Raises:
        HTTPException: If not authenticated or person not found.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail='Unauthorized')
    person = auth_service.get_person(user['id'], person_id)
    if not person:
        raise HTTPException(status_code=404, detail='Person not found')
    return person


@router.put('/auth/persons/{person_id}', response_model=PersonOut)
def update_person(person_id: int, payload: PersonIn, request: Request):
    """Update a person's data.

    Args:
        person_id: ID of person to update.
        payload: PersonIn with updated data.
        request: FastAPI Request.

    Returns:
        Updated PersonOut object.

    Raises:
        HTTPException: If not authenticated or person not found.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail='Unauthorized')
    success = auth_service.update_person(user['id'], person_id, payload.model_dump())
    if not success:
        raise HTTPException(status_code=404, detail='Person not found')
    person = auth_service.get_person(user['id'], person_id)
    if not person:
        raise HTTPException(status_code=404, detail='Person not found after update')
    return person


@router.delete('/auth/persons/{person_id}')
def delete_person(person_id: int, request: Request):
    """Delete a person profile.

    Args:
        person_id: ID of person to delete.
        request: FastAPI Request.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If not authenticated or person not found.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail='Unauthorized')
    deleted = auth_service.delete_person(user['id'], person_id)
    if not deleted:
        raise HTTPException(status_code=404, detail='Person not found')
    return {'status': 'ok'}
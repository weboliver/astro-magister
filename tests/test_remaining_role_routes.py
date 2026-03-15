from fastapi.testclient import TestClient

import app.config as app_config
from app.main import app
from app.routers import houses as houses_router
from app.routers import transits as transits_router
from app.routers import solar as solar_router
from app.routers import age_points as age_points_router
from app.schemas.datetime_models import HousesResponse, SolarReturnResponse
from tests.support import build_authenticated_client, grant_poweruser


class _DummyPerplexityClient:
    created_role_types = []

    def __init__(self, *args, role_type="Laie", **kwargs):
        self.role_type = role_type
        self.model = "dummy-model"
        _DummyPerplexityClient.created_role_types.append(role_type)

    def send_summary_text(self, summary, system_prompt=None):
        return f"role={self.role_type}"

    async def send_summary_stream(self, summary, system_prompt=None):
        yield f"role={self.role_type}"

    def _resolve_system_prompt(self, system_prompt):
        return system_prompt


def _houses_payload(person_id=None):
    return {
        'person_id': person_id,
        'year': 1990,
        'month': 6,
        'day': 15,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 48.8,
        'longitude': 2.3,
        'timezone': 'Europe/Paris',
    }


def _transits_payload(person_id=None):
    return {
        'person_id': person_id,
        'birthday': {
            'year': 1990,
            'month': 6,
            'day': 15,
            'hour': 12,
            'minute': 0,
            'second': 0,
            'timezone': 'Europe/Paris',
        },
        'birth_location': {'latitude': 48.8, 'longitude': 2.3},
        'transitdate': {
            'year': 2024,
            'month': 7,
            'day': 1,
            'hour': 18,
            'minute': 30,
            'second': 0,
            'timezone': 'Europe/Berlin',
        },
        'transit_location': {'latitude': 51.5, 'longitude': -0.1},
    }


def _solar_payload(person_id=None):
    return {
        'person_id': person_id,
        'birth_year': 1990,
        'birth_month': 6,
        'birth_day': 15,
        'birth_hour': 12,
        'birth_minute': 0,
        'birth_second': 0,
        'target_year': 2026,
        'latitude': 48.8,
        'longitude': 2.3,
        'timezone': 'Europe/Berlin',
    }


def _age_points_payload(person_id=None):
    return {
        'person_id': person_id,
        'year': 1990,
        'month': 6,
        'day': 15,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 48.8,
        'longitude': 2.3,
        'timezone': 'Europe/Paris',
        'kind': 'radix',
    }


def test_houses_stream_uses_profile_role(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(houses_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(
        houses_router,
        '_build_houses_response',
        lambda payload: HousesResponse(
            year=payload.year,
            month=payload.month,
            day=payload.day,
            hour=12.0,
            julian_day=2448058.0,
            latitude=payload.latitude,
            longitude=payload.longitude,
            houses=[],
            summary='dummy summary',
        ),
    )

    profile_resp = client.put('/auth/profile', json={'role_id': 3})
    assert profile_resp.status_code == 200

    response = client.post('/houses/stream', json=_houses_payload())

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Experte'


def test_transits_stream_uses_selected_person_role(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(transits_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(
        transits_router,
        '_build_transits_response',
        lambda req, request: transits_router.TransitResponse(aspects=[], grouped_aspects={}, summary='dummy summary'),
    )

    person_resp = client.post('/auth/persons', json={'name': 'Transit Person', 'role_id': 2})
    assert person_resp.status_code == 201
    person_id = person_resp.json()['id']

    response = client.post('/transits/stream', json=_transits_payload(person_id=person_id))

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Fortgeschritten'


def test_solar_return_stream_uses_selected_person_role(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(solar_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(
        solar_router,
        '_build_solar_return_response',
        lambda payload: SolarReturnResponse(
            target_year=payload.target_year or payload.birth_year + 1,
            return_year=payload.target_year or payload.birth_year + 1,
            return_month=payload.birth_month,
            return_day=payload.birth_day,
            return_hour=12.0,
            julian_day=2448058.0,
            natal_sun_longitude=10.0,
            solar_return_longitude=10.0,
            longitude_difference=0.0,
            iterations=0,
            planets=[],
            houses=[0.0] * 12,
            aspects=[],
            summary='dummy summary',
        ),
    )

    person_resp = client.post('/auth/persons', json={'name': 'Solar Person', 'role_id': 2})
    assert person_resp.status_code == 201
    person_id = person_resp.json()['id']

    response = client.post('/solar-return/stream', json=_solar_payload(person_id=person_id))

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Fortgeschritten'


def test_age_points_uses_profile_role(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(age_points_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(
        age_points_router,
        '_build_age_points_response',
        lambda req, http_request: age_points_router.AgePointsResponse(kind=req.kind, target_year=req.target_year, age_points=[], summary='dummy summary'),
    )

    profile_resp = client.put('/auth/profile', json={'role_id': 3})
    assert profile_resp.status_code == 200

    response = client.post('/age-points', json=_age_points_payload())

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Experte'
    assert response.json()['summary'] == 'role=Experte'
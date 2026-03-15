from fastapi.testclient import TestClient

import app.config as app_config
from app.main import app
from app.routers import horoscope as horoscope_router
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


def _dummy_horoscope_data(_payload):
    return {
        'target_year': 1990,
        'return_year': 1990,
        'return_month': 6,
        'return_day': 15,
        'return_hour': 12.0,
        'julian_day': 2448058.0,
        'natal_sun_longitude': 10.0,
        'solar_return_longitude': 10.0,
        'longitude_difference': 0.0,
        'iterations': 0,
        'planets': [],
        'houses': [0.0] * 12,
        'aspects': [],
        'summary_prompt': 'dummy summary',
    }


def _payload(person_id=None):
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


def test_horoscope_uses_profile_role_for_perplexity(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(horoscope_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(horoscope_router, '_build_horoscope_response_data', _dummy_horoscope_data)

    profile_resp = client.put('/auth/profile', json={'role_id': 3})
    assert profile_resp.status_code == 200

    response = client.post('/horoscope', json=_payload())

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Experte'
    assert response.json()['summary'] == 'role=Experte'


def test_horoscope_uses_selected_person_role_for_perplexity(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(horoscope_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(horoscope_router, '_build_horoscope_response_data', _dummy_horoscope_data)

    person_resp = client.post('/auth/persons', json={'name': 'Testperson', 'role_id': 2})
    assert person_resp.status_code == 201
    person_id = person_resp.json()['id']

    response = client.post('/horoscope', json=_payload(person_id=person_id))

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Fortgeschritten'
    assert response.json()['summary'] == 'role=Fortgeschritten'
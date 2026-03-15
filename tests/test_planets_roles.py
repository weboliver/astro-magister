from fastapi.testclient import TestClient

import app.config as app_config
from app.main import app
from app.routers import positions as positions_router
from tests.support import build_authenticated_client, grant_poweruser


class _DummyPerplexityClient:
    created_role_types = []

    def __init__(self, *args, role_type="Laie", **kwargs):
        self.role_type = role_type
        self.model = "dummy-model"
        _DummyPerplexityClient.created_role_types.append(role_type)

    async def send_summary_stream(self, summary, system_prompt=None):
        yield f"role={self.role_type}"

    def send_summary_text(self, summary, system_prompt=None):
        return f"role={self.role_type}"

    def _resolve_system_prompt(self, system_prompt):
        return system_prompt


class _DummyResult:
    def __init__(self):
        self.planets = []
        self.summary = 'dummy summary'


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


def test_planets_stream_uses_profile_role_for_perplexity(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(positions_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(positions_router, 'get_planets', lambda payload: _DummyResult())

    profile_resp = client.put('/auth/profile', json={'role_id': 3})
    assert profile_resp.status_code == 200

    response = client.post('/planets/stream', json=_payload())

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Experte'


def test_planets_stream_uses_selected_person_role_for_perplexity(monkeypatch):
    app_config.TEST = True
    client = build_authenticated_client(TestClient(app))
    grant_poweruser()
    _DummyPerplexityClient.created_role_types.clear()

    monkeypatch.setattr(positions_router, 'PerplexityClient', _DummyPerplexityClient)
    monkeypatch.setattr(positions_router, 'get_planets', lambda payload: _DummyResult())

    person_resp = client.post('/auth/persons', json={'name': 'Planets Person', 'role_id': 2})
    assert person_resp.status_code == 201
    person_id = person_resp.json()['id']

    response = client.post('/planets/stream', json=_payload(person_id=person_id))

    assert response.status_code == 200
    assert _DummyPerplexityClient.created_role_types[-1] == 'Fortgeschritten'
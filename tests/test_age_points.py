import pytest
from tests.support import build_lazy_authenticated_client
from app.routers import age_points as age_points_router
from app.schemas.age_points import AgePointsResponse


client = build_lazy_authenticated_client()


@pytest.fixture(autouse=True)
def mock_age_points_response(monkeypatch):
    monkeypatch.setattr(
        age_points_router,
        '_build_age_points_response',
        lambda req, http_request: AgePointsResponse(
            kind=req.kind,
            target_year=req.target_year,
            age_points=[{"day": "03", "mon": "04", "year": 1963, "lab": "Quadrat", "cl": "Merkur"}],
            summary="Transite: mocked summary mit Orb 0.61",
        ),
    )
    monkeypatch.setattr(
        age_points_router.PerplexityClient,
        'send_summary_text',
        lambda self, summary, system_prompt=None: "Transite: mocked summary mit Orb: 5°",
    )


def test_age_points_endpoint_returns_data():
    payload = {
        "year": 1969,
        "month": 4,
        "day": 1,
        "hour": 16,
        "minute": 50,
        "second": 0,
        "latitude": 50.38,
        "longitude": 8.05,
        "timezone": "Europe/Berlin",
        "kind": "radix",
        "target_year": 2026
    }
    resp = client.post("/age-points", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("kind") == "radix"
    assert isinstance(data.get("age_points"), list)
    age_points = data.get("age_points")
    assert len(age_points) > 0
    assert all(isinstance(pt.get("day"), (str,)) for pt in age_points)
    assert all(isinstance(pt.get("year"), int) for pt in age_points)
    summary = data.get("summary")
    assert isinstance(summary, str)
    assert "Transite" in summary
    assert "Orb" in summary


def test_age_points_full_endpoint_returns_all_points():
    payload = {
        "year": 1975,
        "month": 12,
        "day": 12,
        "hour": 10,
        "minute": 15,
        "second": 0,
        "latitude": 52.52,
        "longitude": 13.4050,
        "timezone": "Europe/Berlin",
        "kind": "radix"
    }
    resp = client.post("/age-points/full", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    sample = data[0]
    assert set(sample.keys()) >= {"day", "mon", "year", "lab", "cl"}
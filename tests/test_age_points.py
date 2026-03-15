from tests.support import build_lazy_authenticated_client


client = build_lazy_authenticated_client()


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
    # Basic contract checks
    assert data.get("kind") == "radix"
    assert isinstance(data.get("age_points"), list)
    age_points = data.get("age_points")
    assert len(age_points) > 0
    assert all(isinstance(pt.get("day"), (str,)) for pt in age_points)
    assert all(isinstance(pt.get("year"), int) for pt in age_points)
    summary = data.get("summary")
    assert isinstance(summary, str)
    assert "Transite:" in summary
    assert "Orb:" in summary


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

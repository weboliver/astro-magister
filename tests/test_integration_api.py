import pytest
from tests.support import build_lazy_authenticated_client

client = build_lazy_authenticated_client()


def test_horoscope_endpoint():
    payload = {
        "year": 2026,
        "month": 1,
        "day": 26,
        "hour": 12,
        "minute": 0,
        "second": 0,
        "latitude": 48.0,
        "longitude": 11.0
    }
    r = client.post("/horoscope", json=payload)
    assert r.status_code == 200
    data = r.json()
    # basic shape checks
    assert "planets" in data
    assert "aspects" in data
    assert isinstance(data["planets"], list)


def test_solar_return_endpoint():
    payload = {
        "birth_year": 1990,
        "birth_month": 6,
        "birth_day": 15,
        "birth_hour": 10,
        "birth_minute": 30,
        "birth_second": 0,
        "target_year": 2026,
        "latitude": 48.0,
        "longitude": 11.0
    }
    r = client.post("/solar-return", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "planets" in data
    assert "aspects" in data
    assert isinstance(data["planets"], list)


def test_transits_endpoint():
    payload = {
        "birthday": {"year":1990,"month":6,"day":15,"hour":10,"minute":30,"second":0},
        "birth_location": {"latitude":48.0,"longitude":11.0},
        "transitdate": {"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0},
        "transit_location": {"latitude":48.0,"longitude":11.0},
        "groupby": "aspect",
        "filterplanets": None
    }
    r = client.post("/transits", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "aspects" in data
    # grouped_aspects should exist (may be empty)
    assert "grouped_aspects" in data
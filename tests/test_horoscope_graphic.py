import shutil
from pathlib import Path
from struct import unpack

import pytest
from fastapi.testclient import TestClient

import app.config as app_config

from app.main import app
from app.schemas.datetime_models import DateTimeRequest
from app.services.ephemeris import calc, julday
from app.services.horoscope_graphics import build_chart_from_request
from app.services.planet_positions import calculate_api_planet_entries
from tests.support import build_authenticated_client


@pytest.fixture
def astro_client(tmp_path, monkeypatch):
    home_dir = tmp_path / "astronex_home"
    home_dir.mkdir()
    resources_dir = Path(__file__).resolve().parent.parent / "astronex" / "resources"
    for file_name in ("cfg.ini", "charts.db"):
        shutil.copy(resources_dir / file_name, home_dir / file_name)
    prev_home = getattr(app, "home_dir", None)
    monkeypatch.setattr(app, "home_dir", str(home_dir))
    client = TestClient(app)
    client = build_authenticated_client(client)
    yield client
    if prev_home is not None:
        monkeypatch.setattr(app, "home_dir", prev_home)


def test_horoscope_graphic_returns_png(astro_client):
    payload = {
        "year": 1990,
        "month": 6,
        "day": 15,
        "hour": 12,
        "minute": 0,
        "second": 0,
        "latitude": 48.8,
        "longitude": 2.3,
        "timezone": "Europe/Paris",
    }

    width = 750
    height = 750
    response = astro_client.post(
        "/horoscope/graphic",
        params={"width": width, "height": height},
        json=payload,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert len(response.content) > 2000
    png_width, png_height = _parse_png_dimensions(response.content)
    assert png_width == width
    assert png_height == height


def test_houses_graphic_returns_png(astro_client):
    payload = {
        "year": 1990,
        "month": 6,
        "day": 15,
        "hour": 12,
        "minute": 0,
        "second": 0,
        "latitude": 48.8,
        "longitude": 2.3,
        "timezone": "Europe/Paris",
    }

    width = 600
    height = 600
    response = astro_client.post(
        "/houses/graphic",
        params={"width": width, "height": height},
        json=payload,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert len(response.content) > 2000
    png_width, png_height = _parse_png_dimensions(response.content)
    assert png_width == width
    assert png_height == height


def test_solar_return_graphic_returns_png(astro_client):
    payload = {
        "birth_year": 1990,
        "birth_month": 6,
        "birth_day": 15,
        "birth_hour": 12,
        "birth_minute": 0,
        "birth_second": 0,
        "target_year": 2026,
        "latitude": 48.8,
        "longitude": 2.3,
        "timezone": "Europe/Berlin",
    }

    width = 640
    height = 640
    response = astro_client.post(
        "/solar-return/graphic",
        params={"width": width, "height": height},
        json=payload,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert len(response.content) > 2000
    png_width, png_height = _parse_png_dimensions(response.content)
    assert png_width == width
    assert png_height == height


def test_transits_graphic_returns_png(astro_client):
    payload = {
        "birthday": {
            "year": 1990,
            "month": 6,
            "day": 15,
            "hour": 12,
            "minute": 0,
            "second": 0,
            "timezone": "Europe/Paris",
        },
        "birth_location": {"latitude": 48.8, "longitude": 2.3},
        "transitdate": {
            "year": 2024,
            "month": 7,
            "day": 1,
            "hour": 18,
            "minute": 30,
            "second": 0,
            "timezone": "Europe/Berlin",
        },
        "transit_location": {"latitude": 51.5, "longitude": -0.1},
    }

    width = 700
    height = 700
    response = astro_client.post(
        "/transits/graphic",
        params={"width": width, "height": height},
        json=payload,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert len(response.content) > 2000
    png_width, png_height = _parse_png_dimensions(response.content)
    assert png_width == width
    assert png_height == height


def test_planet_position_helper_keeps_lilith_and_chiron():
    jd = julday(1990, 6, 15, 12.0)

    entries = calculate_api_planet_entries(jd, calc, epheflag=4)

    assert len(entries) == 13
    assert [entry["planet_id"] for entry in entries] == list(range(13))
    assert entries[11]["planet_name"] == "Lilith"
    assert entries[12]["planet_name"] == "Chiron"
    assert all(isinstance(entry["longitude"], float) for entry in entries)


def test_build_chart_from_request_keeps_13_planets_for_graphics():
    payload = DateTimeRequest(
        year=1990,
        month=6,
        day=15,
        hour=12,
        minute=0,
        second=0,
        latitude=48.8,
        longitude=2.3,
        timezone="Europe/Paris",
    )

    chart = build_chart_from_request(payload)

    assert len(chart.planets) == 13
    assert all(isinstance(longitude, float) for longitude in chart.planets)


def _parse_png_dimensions(blob: bytes) -> tuple[int, int]:
    if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Not a PNG")
    ihdr_pos = blob.find(b"IHDR")
    if ihdr_pos == -1:
        raise ValueError("Missing IHDR chunk")
    start = ihdr_pos + 4
    width = unpack("!I", blob[start:start+4])[0]
    height = unpack("!I", blob[start+4:start+8])[0]
    return width, height

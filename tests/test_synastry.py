"""Tests for synastry (Partnerhoroskop) router endpoints and system prompt registration."""
import shutil
from pathlib import Path
from struct import unpack

import pytest
from fastapi.testclient import TestClient

import app.config as app_config
from app.main import app
from app.schemas.datetime_models import SynastryRequest
from tests.support import build_authenticated_client


@pytest.fixture
def astro_client(tmp_path, monkeypatch):
    """Create an authenticated TestClient with temporary home directory."""
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


# ---------------------------------------------------------------------------
# Test 6: Router importability and tags
# ---------------------------------------------------------------------------
def test_router_is_importable_and_has_correct_tags():
    """The synastry router module must be importable with tags=["synastry"]."""
    from app.routers.synastry import router, SYNASTRY_SYSTEM_PROMPT
    assert router.tags == ["synastry"], f"Expected tags=['synastry'], got {router.tags}"
    assert SYNASTRY_SYSTEM_PROMPT == "synastrie", (
        f"Expected SYNASTRY_SYSTEM_PROMPT='synastrie', got '{SYNASTRY_SYSTEM_PROMPT}'"
    )


def test_router_has_both_endpoints():
    """Both /synastry/stream and /synastry/graphic routes must be defined."""
    from app.routers.synastry import router
    paths = [r.path for r in router.routes]
    assert "/synastry/stream" in paths, f"Missing /synastry/stream in {paths}"
    assert "/synastry/graphic" in paths, f"Missing /synastry/graphic in {paths}"


# ---------------------------------------------------------------------------
# Test 1: POST /synastry/graphic returns 200 + image/png
# ---------------------------------------------------------------------------
def test_synastry_graphic_returns_png(astro_client):
    """Valid SynastryRequest returns 200 with image/png content."""
    payload = _synastry_payload()
    width, height = 600, 600
    response = astro_client.post(
        "/synastry/graphic",
        params={"width": width, "height": height},
        json=payload,
    )
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text[:200]}"
    )
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert len(response.content) > 1000
    png_width, png_height = _parse_png_dimensions(response.content)
    assert png_width == width
    assert png_height == height


# ---------------------------------------------------------------------------
# Test 2: POST /synastry/stream returns SSE with meta event
# ---------------------------------------------------------------------------
def test_synastry_stream_returns_sse_with_meta(astro_client):
    """SSE stream endpoint returns event-stream with meta event as first chunk."""
    payload = _synastry_payload()
    with astro_client.stream("POST", "/synastry/stream", json=payload) as resp:
        assert resp.status_code == 200, (
            f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        )
        assert "text/event-stream" in resp.headers.get("content-type", ""), (
            f"Expected text/event-stream, got {resp.headers.get('content-type')}"
        )
        # The first SSE event should be "meta"
        first_event = _read_first_sse_event(resp)
        assert first_event is not None, "No SSE event received"
        assert first_event["event"] == "meta", (
            f"First event should be 'meta', got '{first_event['event']}'"
        )
        assert "comparison_mode" in first_event["data"], (
            f"Meta data should contain 'comparison_mode': {first_event['data']}"
        )


# ---------------------------------------------------------------------------
# Test 3: Missing auth returns 403
# ---------------------------------------------------------------------------
def test_synastry_stream_requires_auth():
    """Unauthenticated request must receive 403."""
    client = TestClient(app)
    payload = _synastry_payload()
    response = client.post("/synastry/stream", json=payload)
    assert response.status_code in (401, 403), (
        f"Expected 401/403, got {response.status_code}: {response.text[:200]}"
    )


def test_synastry_graphic_requires_auth():
    """Unauthenticated graphic request must receive 403."""
    client = TestClient(app)
    payload = _synastry_payload()
    response = client.post("/synastry/graphic", json=payload)
    assert response.status_code in (401, 403), (
        f"Expected 401/403, got {response.status_code}: {response.text[:200]}"
    )


# ---------------------------------------------------------------------------
# Test 4: comparison_mode='rr' sets operation='click_rr'
# ---------------------------------------------------------------------------
def test_synastry_graphic_rr_mode_returns_png(astro_client):
    """comparison_mode='rr' should produce a valid PNG graphic."""
    payload = _synastry_payload(comparison_mode="rr")
    response = astro_client.post(
        "/synastry/graphic",
        params={"width": 500, "height": 500},
        json=payload,
    )
    assert response.status_code == 200, f"rr mode failed: {response.status_code}"
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


# ---------------------------------------------------------------------------
# Test 5: comparison_mode='hh' sets operation='click_hh'
# ---------------------------------------------------------------------------
def test_synastry_graphic_hh_mode_returns_png(astro_client):
    """comparison_mode='hh' should produce a valid PNG graphic."""
    payload = _synastry_payload(comparison_mode="hh")
    response = astro_client.post(
        "/synastry/graphic",
        params={"width": 500, "height": 500},
        json=payload,
    )
    assert response.status_code == 200, f"hh mode failed: {response.status_code}"
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


# ---------------------------------------------------------------------------
# Integration: verify system prompt is registered
# ---------------------------------------------------------------------------
def test_synastry_system_prompt_registered():
    """Synastry system prompt 'synastrie' must be in PerplexityClient prompts."""
    from app.services.perplexity import PerplexityClient
    pc = PerplexityClient(role_type="Laie")
    assert "synastrie" in pc.system_prompt, (
        f"Expected 'synastrie' in system prompts, got: {list(pc.system_prompt.keys())}"
    )
    prompt = pc.system_prompt["synastrie"]
    assert "Partnerhoroskop" in prompt, "Prompt should mention Partnerhoroskop"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _synastry_payload(comparison_mode="hh"):
    """Default valid SynastryRequest payload for testing."""
    return {
        "person_a_year": 1990,
        "person_a_month": 6,
        "person_a_day": 15,
        "person_a_hour": 12,
        "person_a_minute": 0,
        "person_a_second": 0,
        "person_a_timezone": "Europe/Berlin",
        "person_a_latitude": 48.8,
        "person_a_longitude": 2.3,
        "person_b_year": 1992,
        "person_b_month": 3,
        "person_b_day": 10,
        "person_b_hour": 8,
        "person_b_minute": 30,
        "person_b_second": 0,
        "person_b_timezone": "Europe/Berlin",
        "person_b_latitude": 51.5,
        "person_b_longitude": -0.1,
        "comparison_mode": comparison_mode,
    }


def _read_first_sse_event(resp) -> dict | None:
    """Read the first SSE event from a streaming response iterator."""
    import json
    try:
        for chunk in resp.iter_bytes():
            text = chunk.decode("utf-8", errors="replace")
            lines = text.split("\n")
            event = None
            data = None
            for line in lines:
                if line.startswith("event: "):
                    event = line[7:].strip()
                elif line.startswith("data: "):
                    data_str = line[6:].strip()
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        data = data_str
                if event and data is not None:
                    return {"event": event, "data": data}
            if event and data is not None:
                return {"event": event, "data": data}
    except Exception:
        pass
    return None


def _parse_png_dimensions(blob: bytes) -> tuple[int, int]:
    """Extract width and height from a PNG binary blob."""
    from struct import unpack
    if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Not a PNG")
    ihdr_pos = blob.find(b"IHDR")
    if ihdr_pos == -1:
        raise ValueError("Missing IHDR chunk")
    start = ihdr_pos + 4
    width = unpack("!I", blob[start:start + 4])[0]
    height = unpack("!I", blob[start + 4:start + 8])[0]
    return width, height

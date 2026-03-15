from tests.support import build_lazy_authenticated_client

client = build_lazy_authenticated_client()


def test_getposition_hadamar():
    params = {
        "country": "GM",
        "city": "Hadamar",
        "district": "Hessen",
    }
    resp = client.get("/getPosition", params=params)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # basic sanity checks
    assert data.get("city") and "Hadamar".lower() in data.get("city").lower()
    assert "latitude" in data and "longitude" in data
    lat = data["latitude"]
    lon = data["longitude"]
    # expected approximately 50.45, 8.05
    assert abs(lat - 50.45) < 0.1, f"lat unexpected: {lat}"
    assert abs(lon - 8.05) < 0.1, f"lon unexpected: {lon}"

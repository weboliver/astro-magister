from tests.support import build_lazy_authenticated_client


client = build_lazy_authenticated_client()


def test_debug_endpoints_respond():
    response = client.post(
        "/calc",
        params={"planet_id": 0},
        json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 12,
            "minute": 0,
            "second": 0,
        },
    )
    assert response.status_code == 200

    response2 = client.post(
        "/planets",
        json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 12,
            "minute": 0,
            "second": 0,
        },
    )
    assert response2.status_code == 200

    response3 = client.post(
        "/fixstar",
        params={"star_name": "sirius"},
        json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 12,
            "minute": 0,
            "second": 0,
        },
    )
    assert response3.status_code in {200, 404}

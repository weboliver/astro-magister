import pytest
import uuid
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from types import SimpleNamespace
import app.services.auth_security as auth_security
from app.services.auth_security import RateLimitResult
import app.routers.horoscope as horoscope_router
import app.routers.age_points as age_points_router
from app.services import auth as auth_service
from app.db.models.users import AuthAuditLog, User, UserProfile
from app.db.session import get_session
from tests.support import PASSWORD, build_authenticated_client, build_lazy_authenticated_client, grant_admin, grant_poweruser
from app.main import app

client = build_lazy_authenticated_client()


FREE_USER_LIMIT_MESSAGE = 'Das Kontingent von 5 Abfragen am Tag ist verbraucht, kommen Sie bitte morgen wieder Ein Upgrade auf 50 Abfragen am Tag ist Nutzern mit Spenderstatus aktiv vorbehalten (Buy me a coffee).'


def test_public_auth_endpoints_remain_accessible_without_bearer_token():
    unauth_client = TestClient(app)
    username = f"public_auth_user_{uuid.uuid4().hex[:8]}"
    register = unauth_client.post('/auth/register', json={'username': username, 'password': 'Secret123!'})
    assert register.status_code == 201

    login = unauth_client.post('/auth/login', json={'username': username, 'password': 'Secret123!'})
    assert login.status_code == 200
    assert login.json().get('access_token')

    logout_refresh = unauth_client.post('/auth/logout-refresh', json={'refresh_token': login.json()['refresh_token']})
    assert logout_refresh.status_code == 200


def test_domain_endpoint_requires_bearer_auth():
    unauth_client = TestClient(app)
    response = unauth_client.post('/julday', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
    })
    assert response.status_code == 401
    assert response.headers.get('www-authenticate') == 'Bearer'


def test_openapi_exposes_bearer_auth_scheme_for_protected_routes():
    unauth_client = TestClient(app)
    response = unauth_client.get('/openapi.json')
    if response.status_code == 404:
        return
    assert response.status_code == 200
    schema = response.json()

    security_schemes = schema.get('components', {}).get('securitySchemes', {})
    assert 'BearerAuth' in security_schemes
    assert security_schemes['BearerAuth']['type'] == 'http'
    assert security_schemes['BearerAuth']['scheme'] == 'bearer'

    julday = schema.get('paths', {}).get('/julday', {}).get('post', {})
    assert {'BearerAuth': []} in julday.get('security', [])

    profile = schema.get('paths', {}).get('/auth/profile', {}).get('get', {})
    assert {'BearerAuth': []} in profile.get('security', [])

    logout = schema.get('paths', {}).get('/auth/logout', {}).get('post', {})
    assert {'BearerAuth': []} in logout.get('security', [])

    logout_refresh = schema.get('paths', {}).get('/auth/logout-refresh', {}).get('post', {})
    assert logout_refresh.get('security') in (None, [])


def test_logout_refresh_revokes_refresh_token():
    unauth_client = TestClient(app)
    username = f"logout_refresh_user_{uuid.uuid4().hex[:8]}"
    register = unauth_client.post('/auth/register', json={'username': username, 'password': 'Secret123!'})
    assert register.status_code == 201

    login = unauth_client.post('/auth/login', json={'username': username, 'password': 'Secret123!'})
    assert login.status_code == 200
    refresh_token = login.json()['refresh_token']

    logout_refresh = unauth_client.post('/auth/logout-refresh', json={'refresh_token': refresh_token})
    assert logout_refresh.status_code == 200

    refresh = unauth_client.post('/auth/refresh', json={'refresh_token': refresh_token})
    assert refresh.status_code == 401


def test_register_rejects_weak_password():
    unauth_client = TestClient(app)
    username = f"weak_password_user_{uuid.uuid4().hex[:8]}"
    response = unauth_client.post('/auth/register', json={'username': username, 'password': 'secret'})
    assert response.status_code == 400
    assert 'Passwort' in response.json()['detail']


def test_login_locks_account_after_five_failures():
    unauth_client = TestClient(app)
    username = f"locked_user_{uuid.uuid4().hex[:8]}"
    register = unauth_client.post('/auth/register', json={'username': username, 'password': 'Secret123!'})
    assert register.status_code == 201

    for _ in range(4):
        response = unauth_client.post('/auth/login', json={'username': username, 'password': 'Wrong123!'})
        assert response.status_code == 401

    fifth_attempt = unauth_client.post('/auth/login', json={'username': username, 'password': 'Wrong123!'})
    assert fifth_attempt.status_code == 423
    assert 'gesperrt' in fifth_attempt.json()['detail']

    blocked_login = unauth_client.post('/auth/login', json={'username': username, 'password': 'Secret123!'})
    assert blocked_login.status_code == 423


def test_login_sets_auth_cookies():
    unauth_client = TestClient(app)
    username = f"cookie_user_{uuid.uuid4().hex[:8]}"
    register = unauth_client.post('/auth/register', json={'username': username, 'password': 'Secret123!'})
    assert register.status_code == 201

    login = unauth_client.post('/auth/login', json={'username': username, 'password': 'Secret123!'})
    assert login.status_code == 200
    set_cookie = login.headers.get('set-cookie', '')
    assert 'astronex_access_token=' in set_cookie
    assert 'HttpOnly' in set_cookie


def test_admin_audit_log_endpoint_returns_auth_events():
    unauth_client = TestClient(app)
    username = f"audit_user_{uuid.uuid4().hex[:8]}"

    admin_user = auth_service.authenticate_user('test_user', PASSWORD)
    assert admin_user is not None
    assert auth_service.admin_update_user(admin_user['id'], {'isadmin': True})

    register = unauth_client.post('/auth/register', json={'username': username, 'password': 'Secret123!'})
    assert register.status_code == 201

    failed_login = unauth_client.post('/auth/login', json={'username': username, 'password': 'Wrong123!'})
    assert failed_login.status_code == 401

    response = client.get('/auth/audit-log', params={'query': username, 'limit': 10})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(entry.get('username') == username and entry.get('event_type') == 'login_failed' for entry in data)


def test_admin_audit_log_delete_removes_entries_older_than_three_months():
    session = get_session()
    old_entry = AuthAuditLog(
        event_type='login_failed',
        success=False,
        username=f'old_audit_{uuid.uuid4().hex[:8]}',
        detail='old entry',
        created=datetime.now(timezone.utc) - timedelta(days=120),
    )
    recent_entry = AuthAuditLog(
        event_type='login_success',
        success=True,
        username=f'recent_audit_{uuid.uuid4().hex[:8]}',
        detail='recent entry',
        created=datetime.now(timezone.utc) - timedelta(days=20),
    )
    session.add(old_entry)
    session.add(recent_entry)
    session.commit()
    old_id = old_entry.id
    recent_id = recent_entry.id
    session.close()

    response = client.delete('/auth/audit-log', params={'older_than_months': 3})
    assert response.status_code == 200
    data = response.json()
    assert data['older_than_months'] == 3
    assert data['deleted_count'] >= 1

    session = get_session()
    try:
        assert session.query(AuthAuditLog).filter(AuthAuditLog.id == old_id).first() is None
        assert session.query(AuthAuditLog).filter(AuthAuditLog.id == recent_id).first() is not None
    finally:
        session.query(AuthAuditLog).filter(AuthAuditLog.id == recent_id).delete()
        session.commit()
        session.close()


def test_admin_user_cleanup_deletes_old_users_with_empty_profiles():
    session = get_session()
    old_empty_user = User(
        username=f'old_empty_{uuid.uuid4().hex[:8]}',
        password_hash='hash',
        created=datetime.now(timezone.utc) - timedelta(days=45),
    )
    old_complete_user = User(
        username=f'old_complete_{uuid.uuid4().hex[:8]}',
        password_hash='hash',
        created=datetime.now(timezone.utc) - timedelta(days=45),
    )
    recent_empty_user = User(
        username=f'recent_empty_{uuid.uuid4().hex[:8]}',
        password_hash='hash',
        created=datetime.now(timezone.utc) - timedelta(days=10),
    )
    session.add_all([old_empty_user, old_complete_user, recent_empty_user])
    session.flush()
    session.add_all([
        UserProfile(user_id=old_empty_user.id, birth_year=None),
        UserProfile(user_id=old_complete_user.id, birth_year=1984),
        UserProfile(user_id=recent_empty_user.id, birth_year=None),
    ])
    session.commit()
    old_empty_id = old_empty_user.id
    old_complete_id = old_complete_user.id
    recent_empty_id = recent_empty_user.id
    session.close()

    response = client.delete('/auth/users/cleanup-empty-profile', params={'older_than_months': 1})
    assert response.status_code == 200
    data = response.json()
    assert data['older_than_months'] == 1
    assert data['deleted_count'] >= 1

    session = get_session()
    try:
        assert session.query(User).filter(User.id == old_empty_id).first() is None
        assert session.query(UserProfile).filter(UserProfile.user_id == old_empty_id).first() is None
        assert session.query(User).filter(User.id == old_complete_id).first() is not None
        assert session.query(User).filter(User.id == recent_empty_id).first() is not None
    finally:
        session.query(UserProfile).filter(UserProfile.user_id.in_([old_complete_id, recent_empty_id])).delete(synchronize_session=False)
        session.query(User).filter(User.id.in_([old_complete_id, recent_empty_id])).delete(synchronize_session=False)
        session.commit()
        session.close()


def test_horoscope_interpretation_rate_limit_returns_429(monkeypatch):
    class _DummyPerplexityClient:
        def __init__(self, role_type=None):
            self.role_type = role_type

        def get_cached_summary(self, summary, system_prompt=None):
            return None

    monkeypatch.setattr(
        horoscope_router,
        '_build_horoscope_response_data',
        lambda payload: {
            'target_year': payload.year,
            'return_year': payload.year,
            'return_month': payload.month,
            'return_day': payload.day,
            'return_hour': float(payload.hour),
            'julian_day': 0.0,
            'natal_sun_longitude': 0.0,
            'solar_return_longitude': 0.0,
            'longitude_difference': 0.0,
            'iterations': 0,
            'planets': [],
            'houses': [0.0] * 12,
            'aspects': [],
            'summary_prompt': 'blocked',
        },
    )
    monkeypatch.setattr(
        horoscope_router,
        'check_ai_rate_limit',
        lambda request, user_id=None, scope='ai': RateLimitResult(False, 7, 123, 0),
    )
    monkeypatch.setattr(horoscope_router, 'PerplexityClient', _DummyPerplexityClient)

    response = client.post('/horoscope', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 53.55,
        'longitude': 10.0,
    })

    assert response.status_code == 429
    assert response.json()['detail'] == FREE_USER_LIMIT_MESSAGE
    assert response.headers.get('retry-after') == '123'


def test_horoscope_interpretation_rate_limit_returns_poweruser_message(monkeypatch):
    class _DummyPerplexityClient:
        def __init__(self, role_type=None):
            self.role_type = role_type

        def get_cached_summary(self, summary, system_prompt=None):
            return None

    monkeypatch.setattr(
        horoscope_router,
        '_build_horoscope_response_data',
        lambda payload: {
            'target_year': payload.year,
            'return_year': payload.year,
            'return_month': payload.month,
            'return_day': payload.day,
            'return_hour': float(payload.hour),
            'julian_day': 0.0,
            'natal_sun_longitude': 0.0,
            'solar_return_longitude': 0.0,
            'longitude_difference': 0.0,
            'iterations': 0,
            'planets': [],
            'houses': [0.0] * 12,
            'aspects': [],
            'summary_prompt': 'blocked',
        },
    )
    monkeypatch.setattr(
        horoscope_router,
        'check_ai_rate_limit',
        lambda request, user_id=None, scope='ai': RateLimitResult(False, 51, 123, 0, limit=50, is_poweruser=True),
    )
    monkeypatch.setattr(horoscope_router, 'PerplexityClient', _DummyPerplexityClient)

    response = client.post('/horoscope', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 53.55,
        'longitude': 10.0,
    })

    assert response.status_code == 429
    assert response.json()['detail'] == 'Das Kontingent von 50 Abfragen am Tag ist verbraucht, kommen Sie bitte morgen wieder'
    assert response.headers.get('retry-after') == '123'


def test_age_points_rate_limit_returns_429_instead_of_502(monkeypatch):
    class _DummyPerplexityClient:
        def __init__(self, role_type=None):
            self.role_type = role_type

        def get_cached_summary(self, summary, system_prompt=None):
            return None

    monkeypatch.setattr(
        age_points_router,
        '_build_age_points_response',
        lambda req, http_request: age_points_router.AgePointsResponse(
            kind=req.kind,
            target_year=req.target_year,
            age_points=[],
            summary='blocked',
        ),
    )
    monkeypatch.setattr(
        age_points_router,
        'check_ai_rate_limit',
        lambda request, user_id=None, scope='ai': RateLimitResult(False, 6, 123, 0, limit=5),
    )
    monkeypatch.setattr(age_points_router, 'PerplexityClient', _DummyPerplexityClient)

    response = client.post('/age-points', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 53.55,
        'longitude': 10.0,
        'timezone': 'Europe/Berlin',
        'kind': 'radix',
        'target_year': 2026,
    })

    assert response.status_code == 429
    assert response.json()['detail'] == FREE_USER_LIMIT_MESSAGE
    assert response.headers.get('retry-after') == '123'


def test_horoscope_cached_summary_bypasses_rate_limit(monkeypatch):
    class _DummyPerplexityClient:
        def __init__(self, role_type=None):
            self.role_type = role_type

        def get_cached_summary(self, summary, system_prompt=None):
            return 'Antwort aus Cache'

        def send_summary_text(self, summary, system_prompt=None):
            raise AssertionError('send_summary_text darf bei Cache-Treffer nicht aufgerufen werden')

    monkeypatch.setattr(
        horoscope_router,
        '_build_horoscope_response_data',
        lambda payload: {
            'target_year': payload.year,
            'return_year': payload.year,
            'return_month': payload.month,
            'return_day': payload.day,
            'return_hour': float(payload.hour),
            'julian_day': 0.0,
            'natal_sun_longitude': 0.0,
            'solar_return_longitude': 0.0,
            'longitude_difference': 0.0,
            'iterations': 0,
            'planets': [],
            'houses': [float(index) for index in range(12)],
            'aspects': [],
            'summary_prompt': 'cached prompt',
        },
    )
    monkeypatch.setattr(
        horoscope_router,
        'check_ai_rate_limit',
        lambda request, user_id=None, scope='ai': (_ for _ in ()).throw(AssertionError('Rate-Limit darf bei Cache-Treffer nicht geprüft werden')),
    )
    monkeypatch.setattr(horoscope_router, 'PerplexityClient', _DummyPerplexityClient)

    response = client.post('/horoscope', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 53.55,
        'longitude': 10.0,
    })

    assert response.status_code == 200
    assert response.json()['summary'] == 'Antwort aus Cache'


def test_age_points_stream_cached_summary_bypasses_rate_limit(monkeypatch):
    class _DummyPerplexityClient:
        def __init__(self, role_type=None):
            self.role_type = role_type

        def get_cached_summary(self, summary, system_prompt=None):
            return 'Antwort aus Cache'

        async def send_summary_stream(self, summary, system_prompt=None):
            raise AssertionError('send_summary_stream darf bei Cache-Treffer nicht aufgerufen werden')

    monkeypatch.setattr(
        age_points_router,
        '_build_age_points_response',
        lambda req, http_request: age_points_router.AgePointsResponse(
            kind=req.kind,
            target_year=req.target_year,
            age_points=[],
            summary='cached prompt',
        ),
    )
    monkeypatch.setattr(
        age_points_router,
        'check_ai_rate_limit',
        lambda request, user_id=None, scope='ai': (_ for _ in ()).throw(AssertionError('Rate-Limit darf bei Cache-Treffer nicht geprüft werden')),
    )
    monkeypatch.setattr(age_points_router, 'PerplexityClient', _DummyPerplexityClient)

    response = client.post('/age-points/stream', json={
        'year': 2000,
        'month': 1,
        'day': 1,
        'hour': 12,
        'minute': 0,
        'second': 0,
        'latitude': 53.55,
        'longitude': 10.0,
        'timezone': 'Europe/Berlin',
        'kind': 'radix',
        'target_year': 2026,
    })

    assert response.status_code == 200
    assert 'event: done' in response.text
    assert 'Antwort aus Cache' in response.text


def test_check_ai_rate_limit_enforces_free_user_daily_limit(monkeypatch):
    username = f'ai_limit_free_{uuid.uuid4().hex[:8]}'
    build_authenticated_client(username=username)
    user = auth_service.authenticate_user(username, PASSWORD)
    assert user is not None

    monkeypatch.setattr(auth_security, '_store', auth_security._LocalStore(), raising=False)

    request = SimpleNamespace(headers={}, client=SimpleNamespace(host='127.0.0.1'))
    scope = f'ai:test-free:{uuid.uuid4().hex}'

    for _ in range(5):
        result = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
        assert result.allowed is True
        assert result.limit == 5
        assert result.is_poweruser is False
        assert result.is_admin is False

    blocked = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
    assert blocked.allowed is False
    assert blocked.limit == 5
    assert blocked.retry_after_seconds > 0


def test_check_ai_rate_limit_is_global_across_ai_endpoints(monkeypatch):
        username = f'ai_limit_global_{uuid.uuid4().hex[:8]}'
        build_authenticated_client(username=username)
        user = auth_service.authenticate_user(username, PASSWORD)
        assert user is not None

        monkeypatch.setattr(auth_security, '_store', auth_security._LocalStore(), raising=False)

        request = SimpleNamespace(headers={}, client=SimpleNamespace(host='127.0.0.1'))
        scopes = ['ai:age-points', 'ai:horoscope', 'ai:planets', 'ai:houses', 'ai:transits']

        for scope in scopes:
            result = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
            assert result.allowed is True
            assert result.limit == 5

        blocked = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope='ai:solar-return')
        assert blocked.allowed is False
        assert blocked.limit == 5
        assert blocked.retry_after_seconds > 0


def test_check_ai_rate_limit_enforces_poweruser_daily_limit(monkeypatch):
    username = f'ai_limit_power_{uuid.uuid4().hex[:8]}'
    build_authenticated_client(username=username)
    grant_poweruser(username)
    user = auth_service.authenticate_user(username, PASSWORD)
    assert user is not None

    monkeypatch.setattr(auth_security, '_store', auth_security._LocalStore(), raising=False)

    request = SimpleNamespace(headers={}, client=SimpleNamespace(host='127.0.0.1'))
    scope = f'ai:test-power:{uuid.uuid4().hex}'

    for _ in range(50):
        result = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
        assert result.allowed is True
        assert result.limit == 50
        assert result.is_poweruser is True
        assert result.is_admin is False

    blocked = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
    assert blocked.allowed is False
    assert blocked.limit == 50
    assert blocked.retry_after_seconds > 0


def test_check_ai_rate_limit_bypasses_admin(monkeypatch):
    username = f'ai_limit_admin_{uuid.uuid4().hex[:8]}'
    build_authenticated_client(username=username)
    grant_admin(username)
    user = auth_service.authenticate_user(username, PASSWORD)
    assert user is not None

    monkeypatch.setattr(auth_security, '_store', auth_security._LocalStore(), raising=False)

    request = SimpleNamespace(headers={}, client=SimpleNamespace(host='127.0.0.1'))
    scope = f'ai:test-admin:{uuid.uuid4().hex}'

    for _ in range(60):
        result = auth_security.check_ai_rate_limit(request, user_id=user['id'], scope=scope)
        assert result.allowed is True
        assert result.is_admin is True
        assert result.limit == 0
        assert result.retry_after_seconds == 0


def test_logout_requires_bearer_auth():
    unauth_client = TestClient(app)
    response = unauth_client.post('/auth/logout')
    assert response.status_code == 401
    assert response.headers.get('www-authenticate') == 'Bearer'


def test_redis_cache_endpoint_requires_bearer_auth():
    unauth_client = TestClient(app)
    response = unauth_client.get('/auth/cache/redis')
    assert response.status_code == 401
    assert response.headers.get('www-authenticate') == 'Bearer'


def test_redis_cache_endpoint_returns_cache_metadata():
    response = client.get('/auth/cache/redis', params={'include_values': False})
    assert response.status_code == 200
    data = response.json()
    assert 'backend' in data
    assert 'configured_backend' in data
    assert 'entries' in data
    assert isinstance(data['entries'], list)


def test_redis_cache_delete_endpoint_requires_bearer_auth():
    unauth_client = TestClient(app)
    response = unauth_client.delete('/auth/cache/redis')
    assert response.status_code == 401
    assert response.headers.get('www-authenticate') == 'Bearer'


def test_redis_cache_delete_endpoint_returns_delete_summary():
    response = client.delete('/auth/cache/redis')
    assert response.status_code == 200
    data = response.json()
    assert data['scope'] == 'all'
    assert 'deleted_count' in data


def test_redis_cache_delete_single_endpoint_returns_delete_summary():
    response = client.delete('/auth/cache/redis', params={'key': 'missing-key'})
    assert response.status_code == 200
    data = response.json()
    assert data['scope'] == 'single'
    assert data['key'] == 'missing-key'
    assert 'deleted_count' in data

class TestAgePoints:
    """Test für den Alterspunkte-Endpunkt /age-points."""

    def test_age_points_radix(self):
        response = client.post("/age-points", json={
            "year": 1990,
            "month": 6,
            "day": 15,
            "hour": 10,
            "minute": 30,
            "latitude": 48.8566,   # Beispiel: Paris
            "longitude": 2.3522,
            "kind": "radix"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["kind"] == "radix"
        assert "age_points" in data
        assert isinstance(data["age_points"], list)
        # Die Implementierung liefert eine vollständige Liste mit 191 Einträgen.
        assert len(data["age_points"]) == 217
        # Es sollten genau 12 Cusp-Center-Einträge vorhanden sein, in Reihenfolge
        cc_entries = [
            pt for pt in data["age_points"]
            if pt.get("cl") == "txt_cp" and str(pt.get("lab", "")).startswith("Bewusstseinszentrum / Haus: ")
        ]
        assert len(cc_entries) == 12
        for i, pt in enumerate(cc_entries):
            assert pt["lab"] == f"Bewusstseinszentrum / Haus: {i+1}"
            assert pt["day"] == "15"
            assert pt["mon"] == "06"
            # Cc for house i begins in birth year + i*6
            assert pt["year"] == 1990 + i*6

    @pytest.mark.skip(reason="calls real Perplexity API — no cache mock")
    def test_age_points_target_year_filter(self):
        """Integration test: request only age points for target_year 2028."""
        response = client.post("/age-points", json={
            "year": 1966,
            "month": 3,
            "day": 10,
            "hour": 6,
            "minute": 30,
            "second": 0,
            "timezone": "Europe/Berlin",
            "latitude": 53.46,
            "longitude": 9.98,
            "kind": "radix",
            "target_year": 2028
        })
        assert response.status_code == 200
        data = response.json()
        assert data["kind"] == "radix"
        assert data.get("target_year") == 2028
        assert "age_points" in data and isinstance(data["age_points"], list)
        # all returned points must be in 2028
        assert all(ap.get("year") == 2028 for ap in data["age_points"])
        # ensure we got at least one age point in 2028
        assert len(data["age_points"]) > 0


class TestLocationEndpoints:
    """Tests für die Locations-API."""

    def test_countries_endpoint_returns_full_names(self):
        response = client.get("/locations/countries")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert all(isinstance(entry.get("name"), str) for entry in data)
        assert all(entry.get("code") for entry in data)
        # ensure we return descriptive names, not single letters
        assert all(len(entry["name"]) > 1 for entry in data if entry["name"].strip())
        assert all(len(entry["code"]) == 2 for entry in data)
        # repeated request should keep delivering the same data shape
        second = client.get("/locations/countries")
        assert second.status_code == 200
        assert second.json() == data
"""Tests for Astronex FastAPI endpoints.

Run with: pytest test_api.py -v
"""



class TestRootEndpoint:
    """Test root and health endpoints."""
    
    def test_root_endpoint(self):
        """Test API root returns metadata."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Astro-Magister API"
        assert data["version"] == "1.0.0"
        assert "description" in data
    
    def test_health_check(self):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data


class TestDateTimeConversion:
    """Test Julian Day and calendar date conversion."""
    
    def test_julday_conversion(self):
        """Test calendar date to Julian Day conversion."""
        response = client.post("/julday", json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 12.0
        })
        assert response.status_code == 200
        data = response.json()
        assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
    
    def test_revjul_conversion(self):
        """Test Julian Day to calendar date conversion."""
        response = client.post("/revjul", json={
            "julian_day": 2451545.0,
            "gregorian_calendar": True
        })
        assert response.status_code == 200
        data = response.json()
        assert data["year"] == 2000
        assert data["month"] == 1
        assert data["day"] == 1
        assert data["hour"] == pytest.approx(12.0, rel=1e-6)
    
    def test_julday_invalid_date(self):
        """Test Julian Day conversion with invalid date."""
        response = client.post("/julday", json={
            "year": 2000,
            "month": 13,  # Invalid month
            "day": 1,
            "hour": 12.0
        })
        assert response.status_code == 422  # Validation error


class TestSiderealTime:
    """Test sidereal time calculations."""
    
    def test_sidtime_calculation(self):
        """Test sidereal time for J2000.0."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 12,
            "minute": 0,
            "second": 0
        })
        assert response.status_code == 200
        data = response.json()
        assert "sidereal_time" in data
        assert "julian_day" in data
        assert data["year"] == 2000
        assert data["month"] == 1
        assert data["day"] == 1
        assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
        # Sidereal time at J2000.0 should be around 18.697 hours
        assert data["sidereal_time"] == pytest.approx(18.697, rel=0.01)


class TestPlanetPositions:
    """Test planet position calculations."""
    
    def test_calc_sun_position(self):
        """Test Sun position calculation."""
        response = client.post("/calc", 
            params={"planet_id": 0, "speed": False},
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12,
                "minute": 0,
                "second": 0
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == 0
        assert len(data["planets"]) == 1
        planet = data["planets"][0]
        assert planet["planet_id"] == 0
        assert planet["planet_name"] == "Sun"
        # Sun should be around 280° at J2000.0
        assert planet["longitude"] == pytest.approx(280.37, rel=0.1)
        # `speed` field removed from API responses
        assert data["year"] == 2000
        assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
    
    def test_calc_with_speed(self):
        """Test planet calculation with speed."""
        response = client.post("/calc",
            params={"planet_id": 1, "speed": True},  # Moon
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12
            }
        )
        assert response.status_code == 200
        data = response.json()
        planet = data["planets"][0]
        assert planet["planet_id"] == 1
        assert planet["planet_name"] == "Moon"
        # `speed` field removed from API responses
    
    def test_calc_invalid_planet(self):
        """Test calculation with invalid planet ID."""
        response = client.post("/calc",
            params={"planet_id": 99, "speed": False},
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12
            }
        )
        # Should fail validation or return error
        assert response.status_code in [400, 422]
    
    def test_planets_all(self):
        """Test calculation of all planets."""
        response = client.post("/planets",
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12,
                "minute": 0,
                "second": 0
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == 0
        # Should have Sun, Moon, and 8 planets + Chiron = 11 bodies
        assert len(data["planets"]) >= 10
        assert data["year"] == 2000
        assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
        
            # `speed` field removed from API responses
        for planet in data["planets"]:
            assert "planet_id" in planet
            assert "planet_name" in planet
            assert "longitude" in planet
            assert 0 <= planet["longitude"] < 360


class TestHouseCalculations:
    """Test house cusp calculations."""
    
    def test_houses_calculation(self):
        """Test house calculation for Paris."""
        response = client.post("/houses",
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12,
                "minute": 0,
                "second": 0,
                "latitude": 48.8566,
                "longitude": 2.3522,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["latitude"] == pytest.approx(48.8566)
        assert data["longitude"] == pytest.approx(2.3522)
        assert len(data["houses"]) == 12
        # Each house entry should contain house number, sign and sign_degree
        for i, h in enumerate(data["houses"]):
            assert h["house"] == i + 1
            assert "sign" in h and isinstance(h["sign"], str)
            assert "sign_degree" in h and isinstance(h["sign_degree"], str)
            # absolute longitude still present and within 0..360
            assert 0 <= h["longitude"] < 360
        assert data["year"] == 2000
        assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
    
    def test_houses_different_location(self):
        """Test houses for New York."""
        response = client.post("/houses",
            json={
                "year": 2000,
                "month": 6,
                "day": 15,
                "hour": 18,
                "latitude": 40.7128,
                "longitude": -74.0060,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["houses"]) == 12
    
    def test_houses_extreme_latitude(self):
        """Test houses near pole (may fail)."""
        # This might fail for extreme latitudes
        response = client.post("/houses",
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12,
                "latitude": 85.0,
                "longitude": 0.0,
            }
        )
        # Either succeeds or returns 400 error
        assert response.status_code in [200, 400]


class TestFixedStars:
    """Test fixed star position calculations."""
    
    def test_fixstar_sirius(self):
        """Test Sirius position calculation."""
        response = client.post("/fixstar",
            params={"star_name": "Sirius"},
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12,
                "minute": 0,
                "second": 0
            }
        )
        # Fixstar requires sefstars.txt file which may not be available
        # If available, should return 200, otherwise 400 with error message
        assert response.status_code in [200, 400]
        
        if response.status_code == 200:
            data = response.json()
            assert data["star_name"] == "Sirius"
            assert 0 <= data["longitude"] < 360
            assert -90 <= data["latitude"] <= 90
            assert "speed_lon" in data
            assert "speed_lat" in data
            assert data["year"] == 2000
            assert data["julian_day"] == pytest.approx(2451545.0, rel=1e-6)
        else:
            # If file is missing, error should mention it
            data = response.json()
            assert "detail" in data
    
    def test_fixstar_invalid_name(self):
        """Test with invalid star name."""
        response = client.post("/fixstar",
            params={"star_name": "InvalidStarName123"},
            json={
                "year": 2000,
                "month": 1,
                "day": 1,
                "hour": 12
            }
        )
        assert response.status_code == 400


class TestDateTimeInputValidation:
    """Test date/time input validation."""
    
    def test_missing_required_fields(self):
        """Test request with missing year."""
        response = client.post("/sidtime", json={
            "month": 1,
            "day": 1,
            "hour": 12
        })
        assert response.status_code == 422
    
    def test_invalid_month(self):
        """Test with invalid month value."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 0,  # Must be 1-12
            "day": 1,
            "hour": 12
        })
        assert response.status_code == 422
    
    def test_invalid_day(self):
        """Test with invalid day value."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 32,  # Must be 1-31
            "hour": 12
        })
        assert response.status_code == 422
    
    def test_invalid_hour(self):
        """Test with invalid hour value."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 25  # Must be 0-23
        })
        assert response.status_code == 422
    
    def test_default_time_values(self):
        """Test that time defaults work correctly."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 1
            # hour, minute, second should default
        })
        assert response.status_code == 200
        data = response.json()
        # Default hour should be 12


class TestTransitsEndpoint:
    """Tests for the /transits endpoint."""

    def test_transits_basic(self):
        """Post a natal + transit pair and verify aspects are returned."""
        payload = {
            "birthday": {
                "year": 1980,
                "month": 4,
                "day": 12,
                "hour": 6,
                "minute": 30
            },
            "birth_location": {"latitude": 48.8566, "longitude": 2.3522},
            "transitdate": {
                "year": 2023,
                "month": 7,
                "day": 1,
                "hour": 12
            },
            "transit_location": {"latitude": 48.8566, "longitude": 2.3522}
        }
        response = client.post("/transits", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "aspects" in data
        assert isinstance(data["aspects"], list)
        assert "grouped_aspects" in data
        assert isinstance(data["grouped_aspects"], dict)
        # summary should be present (may be empty string or None if no aspects)
        assert "summary" in data
        if data["aspects"]:
            # if aspects found, grouped_aspects must also be non-empty and summary set
            assert len(data["grouped_aspects"]) > 0
            assert isinstance(data["summary"], str) and len(data["summary"]) > 0


class TestEdgeCases:
    """Test edge cases and boundary conditions."""
    
    def test_leap_year_date(self):
        """Test calculation for leap year date."""
        response = client.post("/planets",
            json={
                "year": 2000,
                "month": 2,
                "day": 29,  # Leap day
                "hour": 12
            }
        )
        assert response.status_code == 200
    
    def test_midnight(self):
        """Test calculation at midnight."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 0,
            "minute": 0,
            "second": 0
        })
        assert response.status_code == 200
        data = response.json()
        assert data["hour"] == 0.0
    
    def test_end_of_day(self):
        """Test calculation at end of day."""
        response = client.post("/sidtime", json={
            "year": 2000,
            "month": 1,
            "day": 1,
            "hour": 23,
            "minute": 59,
            "second": 59
        })
        assert response.status_code == 200
        data = response.json()
        # Should be close to 23:59:59 = 23.9997 hours
        assert data["hour"] == 23
        assert data["minute"] == 59
        assert data["second"] == 59
    
    def test_old_date(self):
        """Test calculation for historical date."""
        response = client.post("/planets",
            json={
                "year": 1900,
                "month": 1,
                "day": 1,
                "hour": 12
            }
        )
        assert response.status_code == 200
    
    def test_future_date(self):
        """Test calculation for future date."""
        response = client.post("/planets",
            json={
                "year": 2050,
                "month": 12,
                "day": 31,
                "hour": 23
            }
        )
        assert response.status_code == 200


class TestSolarReturn:
    """Test solar return calculations."""

    def test_solar_return_2026(self):
        """Solar return for birth 1990-06-15 10:30 UTC, target year 2026."""
        response = client.post("/solar-return", json={
            "birth_year": 1990,
            "birth_month": 6,
            "birth_day": 15,
            "birth_hour": 10,
            "birth_minute": 30,
            "target_year": 2026,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["target_year"] == 2026
        assert data["return_year"] == 2026
        assert data["return_month"] == 6
        assert data["return_day"] == 15
        assert data["return_hour"] == pytest.approx(3.3995, rel=1e-4)
        assert data["julian_day"] == pytest.approx(2461206.6416, rel=1e-6)

        # Planeten: 12+ Stück (inkl. Node, Lilith, Chiron), Sonne exakt auf Return-Position
        assert "planets" in data
        assert len(data["planets"]) == 13
        sun = data["planets"][0]
        assert sun["planet_id"] == 0
        assert abs(sun["longitude"] - data["solar_return_longitude"]) < 1e-6

        # Häuser: 12 Werte
        assert "houses" in data
        assert len(data["houses"]) == 12

    def test_solar_return_invalid_year(self):
        """target_year earlier than birth_year should fail."""
        response = client.post("/solar-return", json={
            "birth_year": 2000,
            "birth_month": 1,
            "birth_day": 1,
            "target_year": 1999,
        })
        assert response.status_code == 400


class TestPersonEndpoints:
    """CRUD coverage for the /auth/persons endpoints."""

    def test_person_crud_flow(self):
        grant_poweruser()
        payload = {
            "name": "Test Partner",
            "residence_country": "DE",
            "residence_region": "BY",
            "residence_city": "München",
            "residence_latitude": 48.137,
            "residence_longitude": 11.575,
            "birth_year": 1984,
            "birth_month": 7,
            "birth_day": 23,
            "birth_hour": 5,
            "birth_minute": 30,
            "birth_second": 0,
            "birth_country": "DE",
            "birth_region": "BY",
            "birth_city": "Nürnberg",
            "birth_latitude": 49.452,
            "birth_longitude": 11.076,
        }
        create_response = client.post("/auth/persons", json=payload)
        assert create_response.status_code == 201
        person = create_response.json()
        assert person["name"] == payload["name"]

        list_response = client.get("/auth/persons")
        assert list_response.status_code == 200
        persons = list_response.json()
        assert any(p["id"] == person["id"] for p in persons)

        detail_response = client.get(f"/auth/persons/{person['id']}")
        assert detail_response.status_code == 200
        assert detail_response.json()["birth_city"] == payload["birth_city"]

        updated_payload = payload.copy()
        updated_payload["name"] = "Partner Updated"
        updated_payload["birth_city"] = "Berlin"
        updated_payload["birth_region"] = "BE"
        updated_payload["birth_latitude"] = 52.52
        updated_payload["birth_longitude"] = 13.405
        update_response = client.put(f"/auth/persons/{person['id']}", json=updated_payload)
        assert update_response.status_code == 200
        updated_person = update_response.json()
        assert updated_person["name"] == updated_payload["name"]
        assert updated_person["birth_city"] == "Berlin"

        delete_response = client.delete(f"/auth/persons/{person['id']}")
        assert delete_response.status_code == 200

        missing_response = client.get(f"/auth/persons/{person['id']}")
        assert missing_response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

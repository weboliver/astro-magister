from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import time
from typing import Optional
import logging
import re

import httpx

import app.config as app_config
from app.db.models.users import AuthAuditLog
from app.db.session import get_session


logger = logging.getLogger(__name__)


def _get_int_setting(name: str, default: int, test_default: Optional[int] = None) -> int:
    if getattr(app_config, 'TEST', False) and test_default is not None:
        return test_default
    raw_value = app_config.get_env_setting(name)
    if raw_value:
        return int(raw_value)
    return default

LOGIN_RATE_LIMIT_ATTEMPTS = _get_int_setting('LOGIN_RATE_LIMIT_ATTEMPTS', 5, test_default=1000)
LOGIN_RATE_LIMIT_WINDOW_SECONDS = _get_int_setting('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900)
REGISTER_RATE_LIMIT_ATTEMPTS = _get_int_setting('REGISTER_RATE_LIMIT_ATTEMPTS', 5, test_default=1000)
REGISTER_RATE_LIMIT_WINDOW_SECONDS = _get_int_setting('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600)
REFRESH_RATE_LIMIT_ATTEMPTS = _get_int_setting('REFRESH_RATE_LIMIT_ATTEMPTS', 30, test_default=1000)
REFRESH_RATE_LIMIT_WINDOW_SECONDS = _get_int_setting('REFRESH_RATE_LIMIT_WINDOW_SECONDS', 300)
FAILED_LOGIN_LOCKOUT_THRESHOLD = _get_int_setting('FAILED_LOGIN_LOCKOUT_THRESHOLD', 5)
FAILED_LOGIN_LOCKOUT_SECONDS = _get_int_setting('FAILED_LOGIN_LOCKOUT_SECONDS', 3600)
AI_RATE_LIMIT_ATTEMPTS = _get_int_setting('AI_RATE_LIMIT_ATTEMPTS', 6, test_default=1000)
AI_RATE_LIMIT_WINDOW_SECONDS = _get_int_setting('AI_RATE_LIMIT_WINDOW_SECONDS', 1800)
TURNSTILE_SECRET_KEY = (app_config.get_env_setting('TURNSTILE_SECRET_KEY') or '').strip()
TURNSTILE_VERIFY_URL = (app_config.get_env_setting('TURNSTILE_VERIFY_URL') or 'https://challenges.cloudflare.com/turnstile/v0/siteverify').strip()
REDIS_URL = (app_config.get_env_setting('REDIS_URL') or '').strip()


def _is_placeholder_secret(value: str) -> bool:
    normalized = (value or '').strip().lower()
    return not normalized or normalized.startswith('replace-with-your-turnstile') or normalized in {'changeme', 'your-turnstile-secret-key'}


@dataclass
class RateLimitResult:
    allowed: bool
    count: int
    retry_after_seconds: int
    remaining: int


class _LocalStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: dict[str, tuple[int, float]] = {}
        self._values: dict[str, tuple[str, float]] = {}

    def _cleanup_counter(self, key: str, now: float) -> None:
        entry = self._counters.get(key)
        if entry and entry[1] <= now:
            self._counters.pop(key, None)

    def _cleanup_value(self, key: str, now: float) -> None:
        entry = self._values.get(key)
        if entry and entry[1] <= now:
            self._values.pop(key, None)

    def incr(self, key: str, ttl_seconds: int) -> tuple[int, int]:
        now = time()
        with self._lock:
            self._cleanup_counter(key, now)
            count, expires_at = self._counters.get(key, (0, now + ttl_seconds))
            if expires_at <= now:
                count, expires_at = 0, now + ttl_seconds
            count += 1
            self._counters[key] = (count, expires_at)
            return count, max(0, int(expires_at - now))

    def set_value(self, key: str, value: str, ttl_seconds: int) -> None:
        with self._lock:
            self._values[key] = (value, time() + ttl_seconds)

    def get_value(self, key: str) -> tuple[Optional[str], int]:
        now = time()
        with self._lock:
            self._cleanup_value(key, now)
            value = self._values.get(key)
            if not value:
                return None, 0
            return value[0], max(0, int(value[1] - now))

    def delete(self, key: str) -> None:
        with self._lock:
            self._counters.pop(key, None)
            self._values.pop(key, None)


class _RedisStore:
    def __init__(self, redis_url: str) -> None:
        import redis

        self._client = redis.Redis.from_url(redis_url, decode_responses=True)
        self._client.ping()

    def incr(self, key: str, ttl_seconds: int) -> tuple[int, int]:
        pipeline = self._client.pipeline()
        pipeline.incr(key)
        pipeline.ttl(key)
        count, current_ttl = pipeline.execute()
        if current_ttl in (-1, -2):
            self._client.expire(key, ttl_seconds)
            current_ttl = ttl_seconds
        return int(count), max(0, int(current_ttl))

    def set_value(self, key: str, value: str, ttl_seconds: int) -> None:
        self._client.set(key, value, ex=ttl_seconds)

    def get_value(self, key: str) -> tuple[Optional[str], int]:
        pipeline = self._client.pipeline()
        pipeline.get(key)
        pipeline.ttl(key)
        value, ttl_seconds = pipeline.execute()
        return value, max(0, int(ttl_seconds if ttl_seconds not in (-1, -2) else 0))

    def delete(self, key: str) -> None:
        self._client.delete(key)


_local_store = _LocalStore()


def _get_store():
    global _store
    try:
        return _store
    except NameError:
        pass

    if REDIS_URL:
        try:
            _store = _RedisStore(REDIS_URL)
            return _store
        except Exception:
            logger.warning('Redis auth security store unavailable, using local fallback')
    _store = _local_store
    return _store


def get_client_ip(request) -> str:
    forwarded_for = request.headers.get('x-forwarded-for', '').split(',')[0].strip()
    if forwarded_for:
        return forwarded_for
    client = getattr(request, 'client', None)
    return getattr(client, 'host', '') or 'unknown'


def normalize_username(username: Optional[str]) -> str:
    return (username or '').strip().lower()


def check_rate_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> RateLimitResult:
    key = f'auth:rate:{scope}:{identifier}'
    count, retry_after_seconds = _get_store().incr(key, window_seconds)
    allowed = count <= limit
    remaining = max(0, limit - count)
    return RateLimitResult(allowed=allowed, count=count, retry_after_seconds=retry_after_seconds, remaining=remaining)


def build_rate_limit_identifier(request, user_id: Optional[int] = None) -> str:
    if user_id is not None:
        return f'user:{user_id}'
    return f'ip:{get_client_ip(request)}'


def check_ai_rate_limit(request, user_id: Optional[int] = None, scope: str = 'ai') -> RateLimitResult:
    identifier = build_rate_limit_identifier(request, user_id=user_id)
    return check_rate_limit(scope, identifier, AI_RATE_LIMIT_ATTEMPTS, AI_RATE_LIMIT_WINDOW_SECONDS)


def get_login_lock(username: str) -> int:
    normalized = normalize_username(username)
    if not normalized:
        return 0
    _, retry_after_seconds = _get_store().get_value(f'auth:lock:{normalized}')
    return retry_after_seconds


def record_failed_login(username: str) -> int:
    normalized = normalize_username(username)
    if not normalized:
        return 0

    count, _ = _get_store().incr(f'auth:fail:{normalized}', FAILED_LOGIN_LOCKOUT_SECONDS)
    if count >= FAILED_LOGIN_LOCKOUT_THRESHOLD:
        _get_store().set_value(f'auth:lock:{normalized}', '1', FAILED_LOGIN_LOCKOUT_SECONDS)
        _get_store().delete(f'auth:fail:{normalized}')
        return FAILED_LOGIN_LOCKOUT_SECONDS
    return 0


def clear_failed_logins(username: str) -> None:
    normalized = normalize_username(username)
    if not normalized:
        return
    _get_store().delete(f'auth:fail:{normalized}')
    _get_store().delete(f'auth:lock:{normalized}')


def validate_password_strength(password: str) -> Optional[str]:
    if len(password or '') < 8:
        return 'Passwort muss mindestens 8 Zeichen lang sein'
    if not re.search(r'[A-Z]', password):
        return 'Passwort muss mindestens einen Großbuchstaben enthalten'
    if not re.search(r'\d', password):
        return 'Passwort muss mindestens eine Zahl enthalten'
    if not re.search(r'[^A-Za-z0-9]', password):
        return 'Passwort muss mindestens ein Sonderzeichen enthalten'
    return None


async def verify_turnstile_token(token: Optional[str], remote_ip: str) -> bool:
    if getattr(app_config, 'TEST', False):
        return True
    if _is_placeholder_secret(TURNSTILE_SECRET_KEY):
        return True
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                TURNSTILE_VERIFY_URL,
                data={
                    'secret': TURNSTILE_SECRET_KEY,
                    'response': token,
                    'remoteip': remote_ip,
                },
            )
        if not response.is_success:
            return False
        payload = response.json()
        return bool(payload.get('success'))
    except Exception:
        logger.exception('Turnstile verification failed')
        return False


def log_auth_event(
    *,
    event_type: str,
    success: bool,
    username: Optional[str] = None,
    user_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    session = get_session()
    try:
        row = AuthAuditLog(
            event_type=event_type,
            success=success,
            username=username,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            detail=detail,
        )
        session.add(row)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception('Could not write auth audit log')
    finally:
        session.close()
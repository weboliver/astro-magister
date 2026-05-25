from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time as datetime_time, timedelta, timezone
from threading import Lock
from time import time
from typing import Optional
import logging
import re

import httpx

import app.config as app_config
from app.db.models.users import AuthAuditLog, UserProfile
from app.db.session import get_session


logger = logging.getLogger(__name__)


def _get_int_setting(name: str, default: int, test_default: Optional[int] = None) -> int:
    """Get an integer setting from environment variables.

    Args:
        name: Environment variable name.
        default: Default value if not set.
        test_default: Optional test default value.

    Returns:
        Integer setting value.
    """
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
AI_DAILY_LIMIT_DEFAULT = _get_int_setting('AI_DAILY_LIMIT_DEFAULT', 5, test_default=5)
AI_DAILY_LIMIT_POWERUSER = _get_int_setting('AI_DAILY_LIMIT_POWERUSER', 50, test_default=50)
TURNSTILE_SECRET_KEY = (app_config.get_env_setting('TURNSTILE_SECRET_KEY') or '').strip()
TURNSTILE_VERIFY_URL = (app_config.get_env_setting('TURNSTILE_VERIFY_URL') or 'https://challenges.cloudflare.com/turnstile/v0/siteverify').strip()
REDIS_URL = (app_config.get_env_setting('REDIS_URL') or '').strip()

# Comma-separated list of trusted reverse-proxy IPs.
# X-Forwarded-For is only trusted when the direct client is one of these.
# Default: nginx container IP in the docker-compose internal network.
_raw_trusted = app_config.get_env_setting('TRUSTED_PROXIES') or '172.28.0.15'
TRUSTED_PROXIES: frozenset[str] = frozenset(ip.strip() for ip in _raw_trusted.split(',') if ip.strip())


def _is_placeholder_secret(value: str) -> bool:
    """Check if a secret value is a placeholder/invalid.

    Args:
        value: Secret string to check.

    Returns:
        True if placeholder, False otherwise.
    """
    normalized = (value or '').strip().lower()
    return not normalized or normalized.startswith('replace-with-your-turnstile') or normalized in {'changeme', 'your-turnstile-secret-key'}


@dataclass
class RateLimitResult:
    allowed: bool
    count: int
    retry_after_seconds: int
    remaining: int
    limit: int = 0
    is_poweruser: bool = False
    is_admin: bool = False


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
    """Get the configured rate limit store (Redis or local fallback).

    Returns:
        _RedisStore or _LocalStore instance.
    """
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
    """Extract client IP address from request.

    X-Forwarded-For is only trusted when the direct connecting client
    is a known reverse proxy (TRUSTED_PROXIES). Otherwise the direct
    client IP is used, preventing header-spoofing attacks.

    Args:
        request: FastAPI Request object.

    Returns:
        Client IP address string.
    """
    client = getattr(request, 'client', None)
    direct_ip = getattr(client, 'host', '') or ''
    if direct_ip in TRUSTED_PROXIES:
        forwarded_for = request.headers.get('x-forwarded-for', '').split(',')[0].strip()
        if forwarded_for:
            return forwarded_for
    return direct_ip or 'unknown'


def normalize_username(username: Optional[str]) -> str:
    """Normalize username for consistent storage/lookup.

    Args:
        username: Raw username string.

    Returns:
        Lowercase, stripped username.
    """
    return (username or '').strip().lower()


def check_rate_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> RateLimitResult:
    """Check if an action is within rate limit.

    Args:
        scope: Rate limit scope (e.g., 'login', 'register').
        identifier: Unique identifier (e.g., IP or user ID).
        limit: Maximum number of attempts allowed.
        window_seconds: Time window in seconds.

    Returns:
        RateLimitResult with allowed status and details.
    """
    key = f'auth:rate:{scope}:{identifier}'
    count, retry_after_seconds = _get_store().incr(key, window_seconds)
    allowed = count <= limit
    remaining = max(0, limit - count)
    return RateLimitResult(
        allowed=allowed,
        count=count,
        retry_after_seconds=retry_after_seconds,
        remaining=remaining,
        limit=limit,
    )


def build_rate_limit_identifier(request, user_id: Optional[int] = None) -> str:
    """Build rate limit identifier from request and optional user ID.

    Args:
        request: FastAPI Request object.
        user_id: Optional user ID.

    Returns:
        Rate limit identifier string (e.g., 'user:123' or 'ip:1.2.3.4').
    """
    if user_id is not None:
        return f'user:{user_id}'
    return f'ip:{get_client_ip(request)}'


def _seconds_until_next_utc_midnight(now: Optional[datetime] = None) -> int:
    """Calculate seconds until next UTC midnight.

    Args:
        now: Optional datetime (defaults to now).

    Returns:
        Seconds until next UTC midnight.
    """
    current_time = now or datetime.now(timezone.utc)
    next_midnight = datetime.combine(current_time.date() + timedelta(days=1), datetime_time.min, tzinfo=timezone.utc)
    return max(1, int((next_midnight - current_time).total_seconds()))


def _get_ai_limit_flags(user_id: Optional[int]) -> tuple[bool, bool]:
    """Get AI rate limit flags for a user.

    Args:
        user_id: Optional user ID.

    Returns:
        Tuple of (is_admin, is_poweruser).
    """
    if user_id is None:
        return False, False

    session = get_session()
    try:
        profile = session.query(UserProfile).filter(UserProfile.user_id == int(user_id)).first()
    finally:
        session.close()

    if not profile:
        return False, False
    return bool(getattr(profile, 'isadmin', False)), bool(getattr(profile, 'is_poweruser', False))


def check_ai_rate_limit(request, user_id: Optional[int] = None, scope: str = 'ai') -> RateLimitResult:
    """Check AI interpretation rate limit for a user.

    Args:
        request: FastAPI Request object.
        user_id: Optional user ID.
        scope: Rate limit scope (default 'ai').

    Returns:
        RateLimitResult with allowed status and daily limit info.
    """
    is_admin, is_poweruser = _get_ai_limit_flags(user_id)
    if is_admin:
        return RateLimitResult(
            allowed=True,
            count=0,
            retry_after_seconds=0,
            remaining=0,
            limit=0,
            is_poweruser=is_poweruser,
            is_admin=True,
        )

    daily_limit = AI_DAILY_LIMIT_POWERUSER if is_poweruser else AI_DAILY_LIMIT_DEFAULT
    current_time = datetime.now(timezone.utc)
    daily_scope = f'ai:{current_time.strftime("%Y%m%d")}'
    identifier = build_rate_limit_identifier(request, user_id=user_id)
    result = check_rate_limit(daily_scope, identifier, daily_limit, _seconds_until_next_utc_midnight(current_time))
    result.limit = daily_limit
    result.is_poweruser = is_poweruser
    return result


def build_ai_rate_limit_error_detail(rate_limit: RateLimitResult) -> str:
    """Build error message for AI rate limit exceeded.

    Args:
        rate_limit: RateLimitResult from rate limit check.

    Returns:
        Localized error message in German.
    """
    daily_limit = rate_limit.limit or (AI_DAILY_LIMIT_POWERUSER if rate_limit.is_poweruser else AI_DAILY_LIMIT_DEFAULT)
    detail = f'Das Kontingent von {daily_limit} Abfragen am Tag ist verbraucht, kommen Sie bitte morgen wieder'
    if not rate_limit.is_poweruser and not rate_limit.is_admin:
        detail += ' Ein Upgrade auf 50 Abfragen am Tag ist Nutzern mit Spenderstatus aktiv vorbehalten (Buy me a coffee).'
    return detail


def get_login_lock(username: str) -> int:
    """Get remaining lockout time for a username.

    Args:
        username: Username to check.

    Returns:
        Seconds remaining in lockout, or 0 if not locked.
    """
    normalized = normalize_username(username)
    if not normalized:
        return 0
    _, retry_after_seconds = _get_store().get_value(f'auth:lock:{normalized}')
    return retry_after_seconds


def record_failed_login(username: str) -> int:
    """Record a failed login attempt and potentially lock the account.

    Args:
        username: Username that failed to login.

    Returns:
        Lockout duration in seconds if locked, 0 otherwise.
    """
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
    """Clear failed login attempts and lockout for a username.

    Args:
        username: Username to clear.
    """
    normalized = normalize_username(username)
    if not normalized:
        return
    _get_store().delete(f'auth:fail:{normalized}')
    _get_store().delete(f'auth:lock:{normalized}')


def validate_password_strength(password: str) -> Optional[str]:
    """Validate password meets minimum strength requirements.

    Args:
        password: Password to validate.

    Returns:
        Error message if invalid, None if valid.
    """
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
    """Verify Cloudflare Turnstile token.

    Args:
        token: Turnstile token from client.
        remote_ip: Client IP address.

    Returns:
        True if token is valid, False otherwise.
    """
    from app.config import BYPASS_CAPTCHA

    if BYPASS_CAPTCHA:
        logger.info("Turnstile bypassed — BYPASS_CAPTCHA is enabled")
        return True

    if _is_placeholder_secret(TURNSTILE_SECRET_KEY):
        logger.warning("Turnstile validation bypass attempted - placeholder secret in use")
        return False
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
    """Log an authentication event to the audit log.

    Args:
        event_type: Type of event (e.g., 'login', 'logout', 'register').
        success: Whether the event was successful.
        username: Optional username involved.
        user_id: Optional user ID.
        ip_address: Optional IP address.
        user_agent: Optional user agent string.
        detail: Optional detail message.
    """
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
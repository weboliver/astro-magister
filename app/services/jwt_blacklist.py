"""
JWT Token Blacklist for key rotation and logout invalidation.

Provides mechanism to invalidate JWT tokens before their expiration.
Uses Redis when REDIS_URL is configured, falls back to in-memory store.
"""
import logging
import time
from threading import Lock

import app.config as app_config

logger = logging.getLogger(__name__)

_BLACKLIST_KEY_PREFIX = "jwt:blacklist:"


class _LocalBlacklist:
    """In-memory fallback blacklist (single-process only)."""

    def __init__(self) -> None:
        self._blacklist: dict[str, float] = {}
        self._lock = Lock()

    def add(self, token_jti: str, expires_in_seconds: int) -> None:
        with self._lock:
            self._blacklist[token_jti] = time.time() + expires_in_seconds
            logger.debug(f"Token {token_jti} added to local blacklist")

    def is_blacklisted(self, token_jti: str) -> bool:
        with self._lock:
            expires_at = self._blacklist.get(token_jti)
            if expires_at is None:
                return False
            if time.time() > expires_at:
                del self._blacklist[token_jti]
                return False
            return True

    def cleanup(self) -> None:
        current_time = time.time()
        with self._lock:
            expired = [jti for jti, exp in self._blacklist.items() if current_time > exp]
            for jti in expired:
                del self._blacklist[jti]


class _RedisBlacklist:
    """Redis-backed blacklist — survives process restarts."""

    def __init__(self, redis_url: str) -> None:
        import redis
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)
        self._client.ping()

    def add(self, token_jti: str, expires_in_seconds: int) -> None:
        key = f"{_BLACKLIST_KEY_PREFIX}{token_jti}"
        self._client.set(key, "1", ex=expires_in_seconds)
        logger.debug(f"Token {token_jti} added to Redis blacklist (ttl={expires_in_seconds}s)")

    def is_blacklisted(self, token_jti: str) -> bool:
        return bool(self._client.exists(f"{_BLACKLIST_KEY_PREFIX}{token_jti}"))

    def cleanup(self) -> None:
        pass  # Redis TTL handles expiry automatically


_local_blacklist = _LocalBlacklist()
_store: _LocalBlacklist | _RedisBlacklist | None = None


def _get_store() -> _LocalBlacklist | _RedisBlacklist:
    global _store
    if _store is not None:
        return _store
    redis_url = (app_config.get_env_setting("REDIS_URL") or "").strip()
    if redis_url:
        try:
            _store = _RedisBlacklist(redis_url)
            logger.info("JWT blacklist using Redis backend")
            return _store
        except Exception:
            logger.warning("Redis JWT blacklist unavailable, falling back to in-memory store")
    _store = _local_blacklist
    return _store


def blacklist_token(token_jti: str, expires_in_seconds: int = 3600) -> None:
    """Add a token JTI to the blacklist with the given TTL."""
    _get_store().add(token_jti, expires_in_seconds)


def is_token_blacklisted(token_jti: str) -> bool:
    """Return True if the token JTI is on the blacklist."""
    return _get_store().is_blacklisted(token_jti)


def cleanup_blacklist() -> None:
    """Remove expired entries (no-op for Redis backend)."""
    _get_store().cleanup()
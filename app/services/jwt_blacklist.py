"""
JWT Token Blacklist for key rotation and logout invalidation.

Provides mechanism to invalidate JWT tokens before their expiration.

Drei Modi (Phase 49, D-04): ein leerer ``REDIS_URL`` ist der lokale Modus (in-memory, kein
503); gesetzt und erreichbar ist Redis; gesetzt und nicht erreichbar ist ein Ausfall und
wirft ``AuthStoreUnavailable`` → 503 (fail-closed, D-01). Einen stillen In-Process-Fallback
im konfigurierten Modus gibt es nicht mehr.
"""
import logging
import time
from threading import Lock

import app.services.auth_store as auth_store

logger = logging.getLogger(__name__)

_BLACKLIST_KEY_PREFIX = "jwt:blacklist:"


class _LocalBlacklist:
    """In-memory blacklist for the documented local mode (single-process only, D-04)."""

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
        self._client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=auth_store.REDIS_CONNECT_TIMEOUT_SECONDS,  # 250 ms (D-16)
            socket_timeout=auth_store.REDIS_READ_TIMEOUT_SECONDS,              # 500 ms (D-16)
        )
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
    """Return the blacklist store; the mode decision comes from ``auth_store.REDIS_URL``.

    The ``_store`` priority is binding: the existing tests and the resilience tests install
    their fake here. A constructor failure (``ping``) is not swallowed — the guard in
    ``auth_store`` catches it and opens the breaker.
    """
    global _store
    if _store is not None:
        return _store
    if not auth_store.REDIS_URL:
        _store = _local_blacklist
        return _store
    _store = _RedisBlacklist(auth_store.REDIS_URL)
    logger.info("JWT blacklist using Redis backend")
    return _store


def blacklist_token(token_jti: str, expires_in_seconds: int = 3600) -> None:
    """Add a token JTI to the blacklist with the given TTL.

    Raises:
        AuthStoreUnavailable: Redis konfiguriert und nicht erreichbar -> 503 (D-01).
            Auch ein Ausfall beim Schreiben ist derselbe Ausfall.
    """
    auth_store.call(_get_store, 'add', token_jti, expires_in_seconds)


def is_token_blacklisted(token_jti: str) -> bool:
    """Return True if the token JTI is on the blacklist.

    Raises:
        AuthStoreUnavailable: Redis konfiguriert und nicht erreichbar -> 503 (D-01).
            Der Lesepfad ist die Entwertungsprüfung; er darf nichts durchlassen.
    """
    return bool(auth_store.call(_get_store, 'is_blacklisted', token_jti))


def cleanup_blacklist() -> None:
    """Remove expired entries (no-op for Redis backend)."""
    auth_store.call(_get_store, 'cleanup')

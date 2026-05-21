"""Provider-agnostic caching infrastructure.

Extracted from app/services/perplexity.py and generalized for multi-provider
use. Each provider instance creates its own cache backend via
create_provider_cache() with a unique prefix namespace, preventing
cross-contamination between providers.

Classes:
    CacheBackend         — abstract base
    LocalCacheBackend    — OrderedDict LRU in-process cache
    RedisCacheBackend    — Redis-backed cache
    FallbackCacheBackend — primary (Redis) → fallback (local)

Functions:
    make_cache_key       — SHA256 hash of (summary, system_prompt, model)
    cache_get            — retrieve from backend
    cache_set            — store in backend
    cache_delete         — remove from backend
    create_provider_cache — factory for per-provider cache instances
    get_cache_overview    — inspect cache contents
    delete_cache_entry    — delete single entry
    clear_cache           — purge all entries
"""

from typing import Optional, Dict, Any
import hashlib
import logging
from collections import OrderedDict
from importlib import import_module
from threading import RLock
from time import monotonic

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------
class CacheBackend:
    """Abstract base for cache backends."""

    def get(self, key: str) -> Optional[str]:
        raise NotImplementedError

    def set(self, key: str, text: str) -> None:
        raise NotImplementedError

    def inspect_entries(self, limit: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    def delete(self, key: str) -> int:
        raise NotImplementedError

    def clear(self) -> int:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Local LRU cache
# ---------------------------------------------------------------------------
class LocalCacheBackend(CacheBackend):
    """Thread-safe LRU cache backed by OrderedDict."""

    def __init__(self, max_entries: int, ttl_seconds: int) -> None:
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._lock = RLock()
        self._cache: OrderedDict[str, tuple[float, str]] = OrderedDict()

    def get(self, key: str) -> Optional[str]:
        now = monotonic()
        with self._lock:
            self._prune_expired_locked(now)
            entry = self._cache.get(key)
            if entry is None:
                return None

            expires_at, text = entry
            if expires_at <= now:
                self._cache.pop(key, None)
                return None

            self._cache.move_to_end(key)
            return text

    def set(self, key: str, text: str) -> None:
        now = monotonic()
        with self._lock:
            self._prune_expired_locked(now)
            self._cache[key] = (now + self._ttl_seconds, text)
            self._cache.move_to_end(key)

            while len(self._cache) > self._max_entries:
                self._cache.popitem(last=False)

    def inspect_entries(self, limit: int) -> list[dict[str, Any]]:
        now = monotonic()
        with self._lock:
            self._prune_expired_locked(now)
            entries = list(self._cache.items())[-limit:]

        serialized: list[dict[str, Any]] = []
        for key, (expires_at, text) in reversed(entries):
            serialized.append(
                {
                    "key": key,
                    "value": text,
                    "ttl_seconds": max(0, int(expires_at - now)),
                    "source": "local",
                }
            )
        return serialized

    def delete(self, key: str) -> int:
        with self._lock:
            return 1 if self._cache.pop(key, None) is not None else 0

    def clear(self) -> int:
        with self._lock:
            deleted = len(self._cache)
            self._cache.clear()
            return deleted

    def _prune_expired_locked(self, now: float) -> None:
        expired_keys = [
            cache_key
            for cache_key, (expires_at, _) in self._cache.items()
            if expires_at <= now
        ]
        for expired_key in expired_keys:
            self._cache.pop(expired_key, None)


# ---------------------------------------------------------------------------
# Redis cache
# ---------------------------------------------------------------------------
class RedisCacheBackend(CacheBackend):
    """Redis-backed cache with prefix namespace isolation."""

    def __init__(self, redis_url: str, prefix: str, ttl_seconds: int) -> None:
        redis_module = import_module("redis")
        self._prefix = prefix
        self._ttl_seconds = ttl_seconds
        self._client = redis_module.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )

    def get(self, key: str) -> Optional[str]:
        value = self._client.get(self._redis_key(key))
        return value if value else None

    def set(self, key: str, text: str) -> None:
        self._client.set(self._redis_key(key), text, ex=self._ttl_seconds)

    def inspect_entries(self, limit: int) -> list[dict[str, Any]]:
        pattern = self._redis_key("*")
        keys = list(
            self._client.scan_iter(match=pattern, count=min(max(limit, 10), 1000))
        )
        keys = sorted(keys)[:limit]
        if not keys:
            return []

        values = self._client.mget(keys)
        serialized: list[dict[str, Any]] = []
        for redis_key, value in zip(keys, values):
            serialized.append(
                {
                    "key": redis_key.removeprefix(f"{self._prefix}:"),
                    "value": value,
                    "ttl_seconds": self._client.ttl(redis_key),
                    "source": "redis",
                }
            )
        return serialized

    def delete(self, key: str) -> int:
        return int(self._client.delete(self._redis_key(key)))

    def clear(self) -> int:
        keys = list(
            self._client.scan_iter(match=self._redis_key("*"), count=1000)
        )
        if not keys:
            return 0
        return int(self._client.delete(*keys))

    def ping(self) -> bool:
        return bool(self._client.ping())

    def _redis_key(self, key: str) -> str:
        return f"{self._prefix}:{key}"


# ---------------------------------------------------------------------------
# Fallback (primary → fallback) cache
# ---------------------------------------------------------------------------
class FallbackCacheBackend(CacheBackend):
    """Composite backend: tries primary (e.g. Redis), falls back to local."""

    def __init__(
        self, primary: Optional[CacheBackend], fallback: CacheBackend
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._primary_failed = False

    def get(self, key: str) -> Optional[str]:
        if self._primary is not None:
            try:
                value = self._primary.get(key)
                if value is not None:
                    return value
            except Exception:
                self._log_primary_failure("read")

        return self._fallback.get(key)

    def set(self, key: str, text: str) -> None:
        if self._primary is not None:
            try:
                self._primary.set(key, text)
                return
            except Exception:
                self._log_primary_failure("write")

        self._fallback.set(key, text)

    def inspect_entries(self, limit: int) -> list[dict[str, Any]]:
        if self._primary is not None:
            try:
                entries = self._primary.inspect_entries(limit)
                if entries:
                    return entries
            except Exception:
                self._log_primary_failure("inspect")

        return self._fallback.inspect_entries(limit)

    def delete(self, key: str) -> int:
        deleted = 0
        if self._primary is not None:
            try:
                deleted = max(deleted, self._primary.delete(key))
            except Exception:
                self._log_primary_failure("delete")
        try:
            deleted = max(deleted, self._fallback.delete(key))
        except Exception:
            logger.exception("Fallback cache delete error")
        return deleted

    def clear(self) -> int:
        deleted = 0
        if self._primary is not None:
            try:
                deleted = max(deleted, self._primary.clear())
            except Exception:
                self._log_primary_failure("clear")
        try:
            deleted = max(deleted, self._fallback.clear())
        except Exception:
            logger.exception("Fallback cache clear error")
        return deleted

    def _log_primary_failure(self, operation: str) -> None:
        if self._primary_failed:
            return
        self._primary_failed = True
        logger.warning(
            "Redis-Cache nicht verfügbar, nutze lokalen Fallback-Cache für %s",
            operation,
        )


# ---------------------------------------------------------------------------
# Utility: suffix/prefix overlap (used by ThinkStreamFilter consumers)
# ---------------------------------------------------------------------------
def _suffix_prefix_overlap(text: str, marker: str) -> int:
    """Calculate suffix/prefix overlap between text and marker.

    Args:
        text: Text to check.
        marker: Marker string.

    Returns:
        Maximum overlap length.
    """
    max_overlap = min(len(text), len(marker) - 1)
    for size in range(max_overlap, 0, -1):
        if text.endswith(marker[:size]):
            return size
    return 0


# ---------------------------------------------------------------------------
# Cache key generation
# ---------------------------------------------------------------------------
def make_cache_key(
    summary: str, system_prompt: Optional[str], model: str
) -> str:
    """Create a deterministic cache key from summary, system prompt, and model.

    Args:
        summary: Summary text.
        system_prompt: Optional system prompt.
        model: Model identifier.

    Returns:
        SHA256 hex digest (64 characters).
    """
    hasher = hashlib.sha256()
    hasher.update(summary.encode("utf-8"))
    if system_prompt:
        hasher.update(b"\n--SYSTEM--\n")
        hasher.update(system_prompt.encode("utf-8"))
    hasher.update(b"\n--MODEL--\n")
    hasher.update(model.encode("utf-8"))
    return hasher.hexdigest()


# ---------------------------------------------------------------------------
# Cache CRUD (backend-aware)
# ---------------------------------------------------------------------------
def cache_get(backend: CacheBackend, key: str) -> Optional[str]:
    """Retrieve cached response from the given backend.

    Args:
        backend: Cache backend instance.
        key: Cache key.

    Returns:
        Cached text or None if not found.
    """
    try:
        value = backend.get(key)
        if value is None:
            return None
        return value
    except Exception:
        logger.exception("Cache get error")
        return None


def cache_set(backend: CacheBackend, key: str, text: str) -> None:
    """Store text in the given backend.

    Args:
        backend: Cache backend instance.
        key: Cache key.
        text: Text to cache.
    """
    try:
        backend.set(key, text)
    except Exception:
        logger.exception("Error setting cache entry")


def cache_delete(backend: CacheBackend, key: str) -> None:
    """Delete cached entry from the given backend.

    Args:
        backend: Cache backend instance.
        key: Cache key to delete.
    """
    try:
        backend.delete(key)
    except Exception:
        logger.exception("Error deleting cache entry")


# ---------------------------------------------------------------------------
# Provider-scoped cache factory
# ---------------------------------------------------------------------------
def create_provider_cache(
    prefix: str,
    max_entries: int,
    ttl_seconds: int,
    redis_url: Optional[str] = None,
    cache_backend_type: str = "local",
) -> CacheBackend:
    """Create a cache backend for a specific provider with its own prefix.

    Args:
        prefix: Namespace prefix (e.g. 'perplexity', 'mistral').
        max_entries: Maximum entries in the local LRU cache.
        ttl_seconds: Time-to-live in seconds for cache entries.
        redis_url: Redis connection URL. If provided and cache_backend_type
                   is 'redis', a RedisBackend is attempted.
        cache_backend_type: Backend type — 'local' or 'redis'.

    Returns:
        A CacheBackend instance (LocalCacheBackend or FallbackCacheBackend).
    """
    fallback = LocalCacheBackend(max_entries=max_entries, ttl_seconds=ttl_seconds)

    if cache_backend_type == "redis" and redis_url:
        try:
            import_module("redis")
            primary = RedisCacheBackend(
                redis_url=redis_url, prefix=prefix, ttl_seconds=ttl_seconds
            )
            primary.ping()
            logger.info("Cache '%s': Redis verbunden unter %s", prefix, redis_url)
            return FallbackCacheBackend(primary=primary, fallback=fallback)
        except Exception:
            logger.warning(
                "Cache '%s': Redis-Initialisierung fehlgeschlagen, nutze lokalen Cache",
                prefix,
            )

    logger.info("Cache '%s': verwende lokalen Cache-Backend", prefix)
    return fallback


# ---------------------------------------------------------------------------
# Cache inspection / administration
# ---------------------------------------------------------------------------
def _serialize_cache_entry(
    entry: Dict[str, Any], include_values: bool, value_max_length: int
) -> Dict[str, Any]:
    """Serialize a cache entry for API response.

    Args:
        entry: Raw cache entry.
        include_values: Whether to include value content.
        value_max_length: Maximum length of value to include.

    Returns:
        Serialized entry dictionary.
    """
    value = entry.get("value")
    normalized = {
        "key": entry.get("key"),
        "source": entry.get("source"),
        "ttl_seconds": entry.get("ttl_seconds"),
        "value_length": len(value) if isinstance(value, str) else None,
    }
    if include_values and isinstance(value, str):
        normalized["value"] = value[:value_max_length]
        normalized["value_truncated"] = len(value) > value_max_length
    return normalized


def get_cache_overview(
    backend: CacheBackend,
    limit: int = 100,
    include_values: bool = True,
    value_max_length: int = 2000,
) -> Dict[str, Any]:
    """Get overview of cache contents from the given backend.

    Args:
        backend: Cache backend instance.
        limit: Maximum number of entries to return.
        include_values: Whether to include entry values.
        value_max_length: Maximum length of value to include.

    Returns:
        Dictionary with cache overview and entries.
    """
    try:
        raw_entries = backend.inspect_entries(limit)
    except Exception:
        logger.exception("Cache inspect error")
        raw_entries = []

    entries = [
        _serialize_cache_entry(entry, include_values, value_max_length)
        for entry in raw_entries
    ]
    backend_name = type(backend).__name__.removesuffix("Backend")
    return {
        "backend": backend_name.lower(),
        "entry_count": len(entries),
        "entries": entries,
    }


def delete_cache_entry(backend: CacheBackend, key: str) -> Dict[str, Any]:
    """Delete a single cache entry from the given backend.

    Args:
        backend: Cache backend instance.
        key: Cache key to delete.

    Returns:
        Dictionary with deletion result.
    """
    deleted = backend.delete(key)
    return {
        "scope": "single",
        "key": key,
        "deleted_count": deleted,
    }


def clear_cache(backend: CacheBackend) -> Dict[str, Any]:
    """Clear all cache entries from the given backend.

    Args:
        backend: Cache backend instance.

    Returns:
        Dictionary with clear result.
    """
    deleted = backend.clear()
    return {
        "scope": "all",
        "deleted_count": deleted,
    }

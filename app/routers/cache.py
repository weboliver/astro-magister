from typing import Any, Dict
import os

from fastapi import APIRouter, Depends, Query

from app.routers.auth import require_authenticated_user
from app.services.providers._cache import (
    CacheBackend,
    create_provider_cache,
    clear_cache as _shared_clear_cache,
    delete_cache_entry as _shared_delete_cache_entry,
    get_cache_overview as _shared_get_cache_overview,
    FallbackCacheBackend,
    RedisCacheBackend,
    LocalCacheBackend,
)
from app import config as app_config


def _get_provider_caches():
    """Get all active provider cache backends."""
    backends = {}
    try:
        from app.services.perplexity import _CACHE as perplexity_cache
        backends["perplexity"] = perplexity_cache
    except Exception:
        pass
    try:
        from app.services.providers.mistral_client import _MISTRAL_CACHE as mistral_cache
        backends["mistral"] = mistral_cache
    except Exception:
        pass
    return backends


def _cache_metadata() -> Dict[str, Any]:
    redis_url = (app_config.get_env_setting("REDIS_URL") or "").strip() or None
    backend_type = (app_config.get_env_setting("PERPLEXITY_CACHE_BACKEND") or "local").strip().lower()
    ttl = app_config.get_env_setting("PERPLEXITY_CACHE_TTL")
    if ttl:
        try:
            ttl = int(ttl)
        except ValueError:
            ttl = None

    caches = _get_provider_caches()
    active_backend = backend_type
    for cache in caches.values():
        if isinstance(cache, FallbackCacheBackend):
            if isinstance(cache._primary, RedisCacheBackend):
                active_backend = "redis"
                break
        elif isinstance(cache, RedisCacheBackend):
            active_backend = "redis"
            break

    return {
        "configured_backend": backend_type,
        "redis_url_configured": bool(redis_url),
        "cache_prefix": ", ".join(caches.keys()) if caches else "-",
        "default_ttl_seconds": ttl,
        "active_backend": active_backend,
    }


def _aggregate_entries(limit: int, include_values: bool, value_max_length: int):
    """Collect entries from all provider caches."""
    from app.services.providers._cache import _serialize_cache_entry
    all_entries = []
    seen_keys = set()
    caches = _get_provider_caches()
    for name, cache in caches.items():
        try:
            raw = cache.inspect_entries(limit)
        except Exception:
            continue
        for entry in raw:
            key = entry.get("key", "")
            if key not in seen_keys:
                seen_keys.add(key)
                serialized = _serialize_cache_entry(entry, include_values, value_max_length)
                all_entries.append(serialized)
    all_entries.sort(key=lambda e: e.get("key", ""))
    return all_entries[:limit]


def get_cache_overview(
    limit: int = 100,
    include_values: bool = True,
    value_max_length: int = 2000,
) -> Dict[str, Any]:
    """Get overview of cache contents across all providers."""
    entries = _aggregate_entries(limit, include_values, value_max_length)
    metadata = _cache_metadata()
    return {
        "backend": metadata["active_backend"],
        "configured_backend": metadata["configured_backend"],
        "redis_url_configured": metadata["redis_url_configured"],
        "cache_prefix": metadata["cache_prefix"],
        "default_ttl_seconds": metadata["default_ttl_seconds"],
        "entry_count": len(entries),
        "entries": entries,
    }


def delete_cache_entry(key: str) -> Dict[str, Any]:
    """Delete a single cache entry from all provider caches."""
    deleted = 0
    caches = _get_provider_caches()
    for cache in caches.values():
        try:
            deleted += cache.delete(key)
        except Exception:
            pass
    return {"scope": "single", "key": key, "deleted_count": deleted}


def clear_cache() -> Dict[str, Any]:
    """Clear all provider caches."""
    total = 0
    caches = _get_provider_caches()
    for cache in caches.values():
        try:
            total += _shared_clear_cache(cache).get("deleted_count", 0)
        except Exception:
            pass
    return {"scope": "all", "deleted_count": total}


router = APIRouter(tags=["cache"], dependencies=[Depends(require_authenticated_user)])


@router.get("/auth/cache/redis")
def get_redis_cache(
    limit: int = Query(default=100, ge=1, le=500),
    include_values: bool = Query(default=True),
    value_max_length: int = Query(default=2000, ge=50, le=20000),
):
    """Get cache overview across all providers."""
    return get_cache_overview(
        limit=limit,
        include_values=include_values,
        value_max_length=value_max_length,
    )


@router.delete("/auth/cache/redis")
def delete_redis_cache(
    key: str | None = Query(default=None),
):
    """Delete cache entries from all providers."""
    if key:
        return delete_cache_entry(key)
    return clear_cache()

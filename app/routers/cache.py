from fastapi import APIRouter, Depends, Query

from app.routers.auth import require_authenticated_user
from app.services.perplexity import clear_cache, delete_cache_entry, get_cache_overview


router = APIRouter(tags=["cache"], dependencies=[Depends(require_authenticated_user)])


@router.get("/auth/cache/redis")
def get_redis_cache(
    limit: int = Query(default=100, ge=1, le=500),
    include_values: bool = Query(default=True),
    value_max_length: int = Query(default=2000, ge=50, le=20000),
):
    return get_cache_overview(
        limit=limit,
        include_values=include_values,
        value_max_length=value_max_length,
    )


@router.delete("/auth/cache/redis")
def delete_redis_cache(
    key: str | None = Query(default=None),
):
    if key:
        return delete_cache_entry(key)
    return clear_cache()
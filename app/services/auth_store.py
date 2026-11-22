"""Central guard for the Redis-backed auth stores (Phase 49).

This module holds exactly four things: the outage exception, the fixed body text for a
store error that is *not* an outage, the per-worker circuit breaker and the test reset
hook. Both store modules (``auth_security`` for rate limits and lockouts,
``jwt_blacklist`` for token invalidation) run their operations through ``call()``.

Modi (D-04): an empty ``REDIS_URL`` is the documented local mode (no 503); a configured
but unreachable Redis is an outage and fails closed (D-01).
"""
from __future__ import annotations

import logging
import math
from threading import Lock
from time import monotonic
from typing import Any, Callable

import redis
from fastapi import HTTPException

import app.config as app_config

logger = logging.getLogger(__name__)

# Phase 49 / D-16: 2 s breaker, 250 ms connect timeout, 500 ms read timeout.
BREAKER_SECONDS = 2.0
REDIS_CONNECT_TIMEOUT_SECONDS = 0.25
REDIS_READ_TIMEOUT_SECONDS = 0.5

# Read once at import time, patchable in tests, and the single source of truth for the mode.
REDIS_URL = (app_config.get_env_setting('REDIS_URL') or '').strip()

# Measured on redis-py 8.1.0: TimeoutError is NOT a ConnectionError subclass
# (TimeoutError -> RedisError). Catching only ConnectionError would turn a read timeout
# into a 500 instead of opening the breaker.
STORE_ERRORS = (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError)

# Phase 49 / D-05 / G-49-2: the one body text for a store error that is NOT an outage. It
# names no host, no port and no exception text — the detail stays in the log.
STORE_ERROR_DETAIL = 'Interner Store-Fehler'

_lock = Lock()
_open_until = 0.0


def remaining_seconds() -> int:
    """Remaining breaker time in whole seconds, never below 1 while the breaker is open.

    ``int()`` would truncate 0.4 s to ``0`` and produce an invalid ``Retry-After: 0``
    (Pitfall 7); the callers additionally clamp with ``max(1, ...)``.
    """
    with _lock:
        rest = _open_until - monotonic()
    return max(1, math.ceil(rest)) if rest > 0 else 0


def is_open() -> bool:
    """Return True while the breaker is open (no Redis call may happen)."""
    with _lock:
        return _open_until > monotonic()


def _open(reason: BaseException) -> None:
    """Open the breaker for ``BREAKER_SECONDS``; log only the closed→open transition (D-17).

    ``_open_until`` keeps the last outage recorded even after it expired naturally, so a
    renewed failure of the same outage does not log a second warning; only a successful
    operation (``_close``) or the test hook clears the record.
    """
    global _open_until
    with _lock:
        was_open = _open_until != 0.0
        _open_until = monotonic() + BREAKER_SECONDS
    if not was_open:
        logger.warning('auth_store_unavailable reason=%s error=%s', type(reason).__name__, reason)


def _close() -> None:
    """Close the breaker after a successful operation; log only the open→closed transition.

    The transition is measured against the recorded outage, not against the remaining
    2 s: recovery normally happens *after* the breaker expired (lazy probe, D-15), and
    exactly that first successful call must produce the INFO line.
    """
    global _open_until
    with _lock:
        was_open = _open_until != 0.0
        _open_until = 0.0
    if was_open:
        logger.info('auth_store_recovered')


def reset() -> None:
    """Test hook (D-21): close the breaker without logging a transition.

    The log evidence for D-17 is produced by the natural 2 s expiry, not by this hook —
    ``_close()`` only logs an actual open→closed transition.
    """
    global _open_until
    with _lock:
        _open_until = 0.0


class AuthStoreUnavailable(HTTPException):
    """Redis is configured but unreachable — fail-closed (D-01/D-20).

    The class is also the single 503 translation: status, German message and ``Retry-After``
    live in the constructor, so neither ``app/main.py`` nor any router repeats them.

    It derives from ``fastapi.HTTPException`` on purpose (review 2026-11-19): nine AI stream
    handlers call ``_get_user_from_request`` inside a ``try`` whose blanket handler rewrites
    any foreign exception into ``HTTPException(400, f'…{str(e)}')``. A ``RuntimeError``
    subclass would surface there as a 400 carrying the Redis host/port; every one of those
    blocks re-raises ``HTTPException`` before it, so an ``HTTPException`` subclass passes
    through unchanged.
    """

    def __init__(self, reason: str = '') -> None:
        super().__init__(
            status_code=503,
            detail='Authentifizierung ist vorübergehend nicht verfügbar',
            headers={'Retry-After': str(max(1, remaining_seconds()))},
        )
        self.reason = reason


def call(get_store: Callable[[], Any], operation: str, *args, **kwargs) -> Any:
    """Run ``get_store().<operation>(*args, **kwargs)`` behind the breaker.

    Order is fixed: (a) an open breaker fails immediately without touching Redis,
    (b) ``get_store()`` **and** the operation run inside the same ``try`` so the
    ``ping()`` in the store constructors is covered too, (c) a ``STORE_ERRORS`` failure
    opens the breaker and raises ``AuthStoreUnavailable``, (d) success closes it.

    Two error classes, one translation site (D-20). ``STORE_ERRORS`` — the outage — is
    checked **first** and keeps its 503 + breaker + ``Retry-After``. Everything else that
    is still a ``redis.RedisError`` (e.g. ``ResponseError``/``NOPERM`` after an ACL change)
    is a store *misconfiguration*, not an outage: the breaker stays closed (D-15/D-16) and
    the exception leaves as ``HTTPException(500)`` carrying only ``STORE_ERROR_DETAIL``.
    The exception text goes to the log, never to the body (D-05, T-49-16).

    That single translation is also why the nine AI stream handlers stay untouched: their
    ``except HTTPException: raise`` line re-raises an ``HTTPException`` unchanged, so a
    ``ResponseError`` now surfaces as a clean 500 instead of the blanket handler's
    ``400``/``502`` with ``str(e)``.

    Deliberately **not** ``except Exception``: programming errors (``TypeError``,
    ``KeyError``) must keep escaping to the FastAPI default handler and must not be
    relabelled as store errors.
    """
    if is_open():
        raise AuthStoreUnavailable('circuit open')
    try:
        result = getattr(get_store(), operation)(*args, **kwargs)
    except STORE_ERRORS as exc:
        _open(exc)
        raise AuthStoreUnavailable(str(exc)) from exc
    except redis.RedisError as exc:
        # Not an outage: no _open(), no breaker, no Retry-After (D-15/D-16).
        logger.exception('auth_store_error operation=%s error=%s', operation, type(exc).__name__)
        raise HTTPException(status_code=500, detail=STORE_ERROR_DETAIL) from exc
    _close()
    return result

"""
JWT Token Blacklist for key rotation and logout invalidation.

Provides mechanism to invalidate JWT tokens before their expiration.
"""
import logging
import time
from typing import Optional
from threading import Lock

logger = logging.getLogger(__name__)


class TokenBlacklist:
    """In-memory token blacklist. For production, replace with Redis."""

    def __init__(self):
        self._blacklist: dict[str, float] = {}
        self._lock = Lock()

    def add(self, token_jti: str, expires_at: float) -> None:
        """Add a token to the blacklist."""
        with self._lock:
            self._blacklist[token_jti] = expires_at
            logger.debug(f"Token {token_jti} added to blacklist")

    def is_blacklisted(self, token_jti: str) -> bool:
        """Check if a token is blacklisted."""
        with self._lock:
            if token_jti not in self._blacklist:
                return False
            # Clean up expired entries
            if time.time() > self._blacklist[token_jti]:
                del self._blacklist[token_jti]
                return False
            return True

    def cleanup(self) -> None:
        """Remove all expired tokens from the blacklist."""
        current_time = time.time()
        with self._lock:
            expired = [jti for jti, exp in self._blacklist.items() if current_time > exp]
            for jti in expired:
                del self._blacklist[jti]


token_blacklist = TokenBlacklist()


def blacklist_token(token_jti: str, expires_in_seconds: int = 3600) -> None:
    """Add a token to the blacklist. Default expires after 1 hour."""
    from datetime import datetime, timezone
    expires_at = datetime.now(timezone.utc).timestamp() + expires_in_seconds
    token_blacklist.add(token_jti, expires_at)


def is_token_blacklisted(token_jti: str) -> bool:
    """Check if a token is blacklisted."""
    return token_blacklist.is_blacklisted(token_jti)


def cleanup_blacklist() -> None:
    """Clean up expired entries from blacklist."""
    token_blacklist.cleanup()
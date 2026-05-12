"""
Centralized password utilities for Astronex.

Single source of truth for password hashing configuration.
"""
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a password using the configured algorithm."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> tuple[bool, str | None]:
    """Verify a password against a hash. Returns (valid, updated_hash)."""
    return pwd_context.verify_and_update(plain_password, hashed_password)


def verify_password_simple(plain_password: str, hashed_password: str) -> bool:
    """Simple password verification (for backward compatibility)."""
    return pwd_context.verify(plain_password, hashed_password)
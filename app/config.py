from typing import Optional
from pathlib import Path
import os
import logging

logger = logging.getLogger(__name__)

try:
    from dotenv import dotenv_values
except Exception:
    dotenv_values = None

from app.services.ephemeris import setpath

EPHE_PATH: Optional[str] = None

ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

allsettings = {}

repo_root = Path(__file__).resolve().parent.parent
global env_path
env_path = repo_root / ".env"

def _read_env_file() -> dict:
    if dotenv_values:
        return {k: v for k, v in dotenv_values(get_env_path()       ).items() if k}
    if not get_env_path().exists():
        return {}
    data = {}
    for line in get_env_path().read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def get_env_settings(exclude_keys: Optional[set] = None) -> dict:
    exclude = exclude_keys or set()
    raw = _read_env_file()
    if DEBUG:
        sensitive_keys = {'SECRET_KEY', 'API_KEY', 'MISTRAL_API_KEY', 'DB_PASSWORD', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_VERIFY_URL'}
        redacted = {k: '***REDACTED***' if k in sensitive_keys else v for k, v in raw.items()}
        logger.debug(f"Env settings loaded: {redacted}")
    settings = {}
    for key in raw:
        if key in exclude:
            continue
        settings[key] = os.getenv(key, raw.get(key))
    return settings

def get_all_env_settings() -> dict:
    raw = _read_env_file()
    if not allsettings:
        for key in raw:
            allsettings[key] = os.getenv(key, raw.get(key))
    return allsettings


def get_env_setting(key: str) -> Optional[str]:
    """Return a single value from the merged env/table data."""
    settings = get_all_env_settings()
    if key in settings:
        return settings[key]
    return os.getenv(key, "")


def get_env_path() -> Path:
    """Expose the resolved .env file Path used throughout this module."""
    return env_path


def _parse_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


DEBUG = _parse_bool(get_env_setting("DEBUG"), False)
SECRET_KEY = get_env_setting("SECRET_KEY")
API_KEY = get_env_setting("API_KEY")
EPHE_PATH = get_env_setting("EPHEMERIS_PATH")
DISABLE_AI = _parse_bool(get_env_setting("DISABLE_AI"), False)

# Provider selection (per D-04)
CHAT_PROVIDER = get_env_setting("CHAT_PROVIDER") or "perplexity"

# Mistral AI configuration (per D-11) — added alongside existing PERPLEXITY_* vars
MISTRAL_API_KEY = get_env_setting("MISTRAL_API_KEY")
MISTRAL_CACHE_TTL = int(get_env_setting("MISTRAL_CACHE_TTL") or 7 * 24 * 3600)
MISTRAL_CACHE_MAXSIZE = int(get_env_setting("MISTRAL_CACHE_MAXSIZE") or 256)

logger.info(
    "Chat provider configured: %s (set CHAT_PROVIDER env var to change)",
    CHAT_PROVIDER,
)

def init_swisseph_path() -> None:
    """Initialize Swiss Ephemeris search path.

    Tries in order:
    - Environment variable SWISS_EPHE_PATH
    - Project path astronex/resources
    - Project root directory
    Sets module-level EPHE_PATH if successfully configured.
    """
    global EPHE_PATH
    candidates: list[str] = []
    env = os.environ.get("SWISS_EPHE_PATH")
    if env:
        candidates.append(env)
    base = Path(__file__).resolve().parent.parent
    candidates.append(str(base / "astronex" / "resources"))
    # Also consider a top-level `resources` directory in the project root
    candidates.append(str(base / "resources"))
    candidates.append(str(base))

    for p in candidates:
        try:
            p_path = Path(p)
            has_stars = p_path.joinpath("sefstars.txt").exists()
            # Accept the candidate if it explicitly contains sefstars.txt
            # or if the path exists and is a directory (useful for project resources)
            if has_stars or (p_path.exists() and p_path.is_dir()) or p == env:
                setpath(str(p_path))
                EPHE_PATH = str(p_path)
                break
        except Exception:
            continue

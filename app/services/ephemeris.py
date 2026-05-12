from pysw import (
    julday,
    revjul,
    sidtime,
    calc,
    calc_ut,
    calc_ut_with_speed,
    houses,
    planets,
    delta,
    fixstar,
    setpath,
)

__all__ = [
    "julday",
    "revjul",
    "sidtime",
    "calc",
    "calc_ut",
    "calc_ut_with_speed",
    "houses",
    "planets",
    "delta",
    "fixstar",
    "setpath",
]


# Try to set Swiss Ephemeris path to local resources directories if available.
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

try:
    repo_root = Path(__file__).resolve().parents[1].parent
    candidates = [repo_root / "resources", repo_root / "astronex" / "resources"]
    for c in candidates:
        if c.exists() and c.is_dir():
            try:
                setpath(str(c))
                break
            except Exception as e:
                logger.debug(f"Failed to set Swiss Ephemeris path to {c}: {e}")
except Exception as e:
    logger.debug(f"Failed to initialize Swiss Ephemeris paths: {e}")

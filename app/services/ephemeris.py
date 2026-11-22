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
    clear_calc_cache,
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
    "clear_calc_cache",
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
                # G-50-01: the calculation cache is keyed on (jd, planet, epheflag) only —
                # the path is not part of it and failures are cached too. Every path change
                # therefore has to discard the cache, here right after the import-time setpath.
                clear_calc_cache()
                break
            except Exception as e:
                logger.debug(f"Failed to set Swiss Ephemeris path to {c}: {e}")
except Exception as e:
    logger.debug(f"Failed to initialize Swiss Ephemeris paths: {e}")

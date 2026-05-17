"""Planet position calculation service using Swiss Ephemeris."""
from app import config as app_config
from app.services.planet_names import API_PLANET_IDS, API_PLANET_TO_EPHE_ID, get_planet_name


def _run_calc(calc_fn, jd, ephe_id, epheflag):
    """Execute a Swiss Ephemeris calculation function with error handling.

    Args:
        calc_fn: Swiss Ephemeris calculation function.
        jd: Julian day number.
        ephe_id: Ephemeris ID for the celestial body.
        epheflag: Ephemeris flag (e.g., 4 for SEFLG_SWIEPH).

    Returns:
        Tuple of (status, longitude, error).
    """
    try:
        status, lon, error = calc_fn(jd, ephe_id, epheflag)
        return status, lon, error
    except Exception as exc:
        return -1, None, str(exc)


def calculate_api_planet_entries(jd, calc_fn, epheflag=4):
    """Calculate planet positions for all API planet IDs (0-12).

    Args:
        jd: Julian day number.
        calc_fn: Swiss Ephemeris calculation function.
        epheflag: Ephemeris flag (default 4 for SEFLG_SWIEPH).

    Returns:
        List of dicts with planet_id, planet_name, and longitude.
    """
    entries = []
    for planet_id in API_PLANET_IDS:
        ephe_id = API_PLANET_TO_EPHE_ID.get(planet_id, planet_id)
        status, lon, error = _run_calc(calc_fn, jd, ephe_id, epheflag)
        if status < 0 or error:
            try:
                app_config.init_swisseph_path()
                status, lon, error = _run_calc(calc_fn, jd, ephe_id, epheflag)
            except Exception:
                pass
        if status < 0 or error:
            continue
        entries.append({
            "planet_id": planet_id,
            "planet_name": get_planet_name(planet_id),
            "longitude": lon,
        })
    return entries


def calculate_api_planet_longitudes(jd, calc_fn, epheflag=4):
    """Calculate longitudes for all API planets.

    Args:
        jd: Julian day number.
        calc_fn: Swiss Ephemeris calculation function.
        epheflag: Ephemeris flag (default 4 for SEFLG_SWIEPH).

    Returns:
        List of longitude values for planets 0-12.
    """
    return [entry["longitude"] for entry in calculate_api_planet_entries(jd, calc_fn, epheflag=epheflag)]
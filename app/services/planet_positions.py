from app import config as app_config
from app.services.planet_names import API_PLANET_IDS, API_PLANET_TO_EPHE_ID, get_planet_name


def _run_calc(calc_fn, jd, ephe_id, epheflag):
    try:
        status, lon, error = calc_fn(jd, ephe_id, epheflag)
        return status, lon, error
    except Exception as exc:
        return -1, None, str(exc)


def calculate_api_planet_entries(jd, calc_fn, epheflag=4):
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
    return [entry["longitude"] for entry in calculate_api_planet_entries(jd, calc_fn, epheflag=epheflag)]
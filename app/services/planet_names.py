"""Canonical planet name mappings for API usage.

Expose a list `PLANET_NAMES_LIST` (indices 0..12) and helper `get_planet_name`.
"""

PLANET_NAMES_LIST = [
    "Sun",
    "Moon",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Node",
    "Lilith",
    "Chiron",
]

API_PLANET_TO_EPHE_ID = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    11: 13,
    12: 15,
}

API_PLANET_IDS = tuple(range(len(PLANET_NAMES_LIST)))


def get_planet_name(pid):
    """Return a human-readable name for a planet id (0..12). If pid is out of range,
    fall back to a generic label `Obj_<pid>`.
    """
    try:
        i = int(pid)
    except Exception:
        return f"Obj_{pid}"
    if 0 <= i < len(PLANET_NAMES_LIST):
        return PLANET_NAMES_LIST[i]
    return f"Obj_{i}"
"""Daten-only Endpunkt für die Chart-Kästchen (CHART-01, D-11/D-12).

Ein generischer Einstieg `POST /chart-data/{chart_type}` dispatcht über eine **explizite
Mapping-Tabelle** auf die vorhandene Berechnungsfunktion der jeweiligen Auswertungsart und
projiziert deren Ergebnis auf das gemeinsame DTO `{chart_type, groups[]}`. Kein zweiter
Rechenweg, keine KI, kein Rate-Limit: dieses Modul importiert bewusst weder
`get_chat_provider` noch `check_ai_rate_limit` noch `interpretation_store` (D-15).

Der Pfadparameter ist ein `Literal`; unbekannte Chart-Arten weist FastAPI mit 422 ab. Alle
sechs Chart-Arten haben einen Adapter, ein `Literal`-Wert ohne Eintrag in `_BUILDERS`
antwortet mit 404. Ein dynamischer Attribut-Lookup über den Modulnamen findet nicht statt
(T-43.1-03).
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from app.db.session import get_session
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.routers.horoscope import _build_horoscope_response_data
from app.routers.nodes import _calculate_nodes_response
from app.routers.solar import _build_solar_return_response
from app.routers.synastry import _calculate_synastry_response, _lookup_person_birth_data
from app.routers.transits import _build_transits_bundle
from app.schemas.datetime_models import DateTimeRequest, SolarReturnRequest, SynastryRequest
from app.schemas.transits import TransitRequest
from app.services.ephemeris import calc_ut_with_speed, houses
from app.services.planet_names import API_PLANET_TO_EPHE_ID
from app.static.german_names import (
    get_aspect_de_by_english,
    get_aspect_de_by_index,
    get_planet_de,
    get_planet_de_by_english,
    get_zodiac_de,
)

ChartType = Literal[
    "horoscope",
    "nodes",
    "synastry",
    "transits",
    "solar_return",
    "age_points",
]

router = APIRouter(tags=["chart-data"], dependencies=[Depends(require_authenticated_user)])


def _degree_minute(longitude):
    """Grad und Minute innerhalb des Zeichens als `(int, int)`.

    Bewusst numerisch aus `longitude % 30` abgeleitet: der vorhandene `sign_degree`-String
    enthält Leerzeichen und U+2032 und passt nicht zur Formatierung des Frontends.
    """
    lon = float(longitude) % 30.0
    degree = int(lon)
    minute = int((lon - degree) * 60)
    return degree, minute


def _orb(separation, aspect_index):
    """Orbis als Abstand zum **gespiegelten** Nominalwinkel, auf eine Nachkommastelle.

    `aspect_index` kommt als `nsig % 12` aus der Aspekt-Berechnung und kann 7…11 annehmen
    (gespiegelte Aspekte), während `separation` auf ≤ 180° normiert ist. Der Nominalwinkel
    ist deshalb `30 * min(a, 12 - a)` — mit `30 * a` wäre rund die Hälfte jeder
    Aspekttabelle erfunden.
    """
    a = int(aspect_index)
    nominal = 30 * min(a, 12 - a)
    return round(abs(float(separation) - nominal), 1)


def _aspect_row(asp):
    """Projiziert eine Aspektzeile auf `{a, b, aspect, orb}`.

    Ohne `separation` gibt es keinen belastbaren Orbis — dann `None`, und der Aufrufer lässt
    die Zeile weg, statt einen Wert zu erfinden.
    """
    try:
        separation = asp.get('separation')
    except Exception:
        return None
    if separation is None:
        return None
    try:
        a = int(asp.get('a'))
    except Exception:
        return None
    return {
        'a': get_planet_de_by_english(asp.get('p1_name')),
        'b': get_planet_de_by_english(asp.get('p2_name')),
        'aspect': get_aspect_de_by_index(a),
        'orb': _orb(separation, a),
    }


def _is_retrograde(jd, planet_id):
    """Rückläufigkeit über die Längengrad-Geschwindigkeit; bei jedem Fehler `False`."""
    try:
        ephe_id = API_PLANET_TO_EPHE_ID.get(int(planet_id), int(planet_id))
    except Exception:
        return False
    try:
        _flags, _lon, speed, error = calc_ut_with_speed(jd, ephe_id, 4)
    except Exception:
        return False
    if error:
        return False
    try:
        return float(speed) < 0
    except Exception:
        return False


def _planet_row(name_de, longitude, jd, planet_id):
    """Projiziert eine Planetenposition auf das DTO; ohne Längengrad `None`."""
    if longitude is None:
        return None
    try:
        lon = float(longitude)
    except Exception:
        return None
    sign_index = int(lon // 30) % 12
    degree, minute = _degree_minute(lon)
    return {
        'name': name_de,
        'sign': get_zodiac_de(sign_index),
        'degree': degree,
        'minute': minute,
        'retrograde': _is_retrograde(jd, planet_id),
    }


def _house_rows(cusps):
    """Zwölf Häuserspitzen als `{house, sign, degree, minute}`; sonst eine leere Liste.

    Liegt auch nur eine Spitze als `None` vor (Polarkreis-Fall), entfällt die ganze
    Häuser-Tabelle — eine halbe Häuserliste wäre eine falsche Angabe (D-10).
    """
    if not cusps:
        return []
    try:
        values = list(cusps)
    except Exception:
        return []
    if len(values) != 12 or any(cusp is None for cusp in values):
        return []
    rows = []
    for index, cusp in enumerate(values):
        try:
            lon = float(cusp)
        except Exception:
            return []
        sign_index = int(lon // 30) % 12
        degree, minute = _degree_minute(lon)
        rows.append({
            'house': index + 1,
            'sign': get_zodiac_de(sign_index),
            'degree': degree,
            'minute': minute,
        })
    return rows


def _group(label, planets, aspects, houses):
    """DTO-Baustein einer Gruppe; `None`-Zeilen werden verworfen, nie durchgereicht."""
    return {
        'label': label,
        'planets': [row for row in (planets or []) if row],
        'aspects': [row for row in (aspects or []) if row],
        'houses': list(houses or []),
    }


def _adapter_horoscope(model, request):
    """Adapter für `horoscope`: vorhandene Berechnung, deutsche Projektion."""
    data = _build_horoscope_response_data(model)
    jd = data.get('julian_day')

    planets = []
    for planet in data.get('planets') or []:
        planets.append(_planet_row(
            get_planet_de(planet.get('planet_id')),
            planet.get('longitude'),
            jd,
            planet.get('planet_id'),
        ))

    aspects = [_aspect_row(asp) for asp in (data.get('aspects') or [])]

    return {
        'chart_type': 'horoscope',
        'groups': [_group('Planeten', planets, aspects, _house_rows(data.get('houses')))],
    }


def _person_label(name, fallback):
    """Display label for a synastry person: trimmed name, else the fallback."""
    label = (name or '').strip()
    return label or fallback


def _node_rows(nodes, jd):
    """Projiziert die zwei Knoten der Antwort wörtlich („Mondknoten"/„Südknoten").

    `planet_name` wird übernommen, nicht über `get_planet_de(planet_id)` neu aufgelöst:
    der Südknoten trägt `planet_id` 13, und dieser Index ist in `PLANET_NAMES_DE` Lilith.
    `retrograde` wird **einmal** aus dem Mondknoten (Index 10) bestimmt und gilt für beide
    Zeilen — der Südknoten ist der Gegenpunkt desselben Knotens, und Ephemeriden-Index 13
    wäre Liliths Geschwindigkeit.
    """
    retrograde = _is_retrograde(jd, 10)
    rows = []
    for node in nodes or []:
        longitude = node.get('longitude')
        if longitude is None:
            continue
        try:
            lon = float(longitude)
        except Exception:
            continue
        degree, minute = _degree_minute(lon)
        rows.append({
            'name': node.get('planet_name'),
            'sign': get_zodiac_de(int(lon // 30) % 12),
            'degree': degree,
            'minute': minute,
            'retrograde': retrograde,
        })
    return rows


def _adapter_nodes(model, request):
    """Adapter für `nodes`: die vorhandene Knoten-Berechnung, auf zwei Zeilen begrenzt."""
    data = _calculate_nodes_response(model)
    jd = data.get('julian_day')
    try:
        cusps = houses(jd, model.latitude, model.longitude)
    except Exception:
        cusps = None

    return {
        'chart_type': 'nodes',
        'groups': [_group('Planeten', _node_rows(data.get('planets'), jd), [], _house_rows(cusps))],
    }


def _planet_rows_from_entries(entries, jd):
    """Projiziert Einträge mit `planet_id`/`longitude` auf Planetenzeilen."""
    rows = []
    for entry in entries or []:
        planet_id = entry.get('planet_id')
        rows.append(_planet_row(get_planet_de(planet_id), entry.get('longitude'), jd, planet_id))
    return rows


def _synastry_planet_rows(entries, jd):
    """Projiziert die Planetenliste **einer** Person der Synastrie.

    Iteriert über `entries`, nie über `range(10)`: die Berechnung überspringt Körper,
    deren Ephemeriden-Aufruf fehlschlägt, und ein festes Zehner-Raster würde dann eine
    Zeile erfinden oder einen `IndexError` werfen.
    """
    return _planet_rows_from_entries(entries, jd)


def _resolve_cross_index(index, entries_a, entries_b):
    """Ordnet einen Index der kombinierten Planetenliste einer Person zu.

    Returns:
        `(entries, index)` innerhalb der Liste dieser Person, sonst `None`, wenn der Index
        außerhalb beider Listen liegt.
    """
    try:
        position = int(index)
    except Exception:
        return None
    if position < 0:
        return None
    if position < len(entries_a):
        return entries_a, position
    offset = position - len(entries_a)
    if offset < len(entries_b):
        return entries_b, offset
    return None


def _synastry_aspect_rows(cross_aspects, entries_a, entries_b):
    """Queraspekt-Zeilen `{a, b, aspect, orb}` aus den rohen Aspekt-Dicts.

    Die Grenze zwischen beiden Personen ist `len(entries_a)`, nicht die Literalzahl 10: der
    Router filtert Queraspekte `is_cross` mit der festen 10, was nur bei zwei vollen Listen
    stimmt. Eine Zeile entfällt, wenn ein Index außerhalb beider Listen liegt **oder** beide
    Indizes zur selben Person gehören — dann ist sie kein Queraspekt, und eine 500 auf einer
    Anzeigefunktion wäre der schlechteste Ausgang.
    """
    rows = []
    for asp in cross_aspects or []:
        left = _resolve_cross_index(asp.get('p1'), entries_a, entries_b)
        right = _resolve_cross_index(asp.get('p2'), entries_a, entries_b)
        if left is None or right is None or left[0] is right[0]:
            continue
        try:
            separation = abs(
                float(left[0][left[1]]['longitude']) - float(right[0][right[1]]['longitude'])
            )
        except Exception:
            continue
        if separation > 180.0:
            separation = 360.0 - separation
        try:
            aspect_index = int(asp.get('a'))
        except Exception:
            continue
        rows.append({
            'a': get_planet_de(left[0][left[1]].get('planet_id')),
            'b': get_planet_de(right[0][right[1]].get('planet_id')),
            'aspect': get_aspect_de_by_index(aspect_index),
            'orb': _orb(separation, aspect_index),
        })
    return rows


def _adapter_synastry(model, request):
    """Adapter für `synastry`: eigentümergebundener Personen-Lookup, vorhandene Berechnung.

    Der Lookup läuft ausschließlich über `_lookup_person_birth_data(db, person_id, user_id)`
    mit `user_id` aus der Session — keine eigene Query, sonst wäre `POST
    /chart-data/synastry` ein IDOR (T-43.1-02). „Existiert nicht" und „gehört dir nicht"
    antworten dort identisch mit 400.
    """
    user = _get_user_from_request(request)
    user_id = user['id'] if user else None

    db = get_session()
    try:
        birth_data_a = _lookup_person_birth_data(db, model.person_a_id, user_id)
        birth_data_b = _lookup_person_birth_data(db, model.person_b_id, user_id)
    finally:
        db.close()

    data = _calculate_synastry_response(
        birth_data_a,
        birth_data_b,
        model.comparison_mode,
        model.additional_question,
        model.person_a_name,
        model.person_b_name,
    )

    entries_a = data.get('planet_entries_a') or []
    entries_b = data.get('planet_entries_b') or []
    aspects = _synastry_aspect_rows(data.get('cross_aspects'), entries_a, entries_b)

    # Cusps beider Personen nur im Häuservergleich; `rr` zeigt keine Häuser-Tabelle (D-10).
    show_houses = model.comparison_mode == 'hh'
    houses_a = _house_rows(data['chart_a'].houses) if show_houses else []
    houses_b = _house_rows(data['chart_b'].houses) if show_houses else []

    return {
        'chart_type': 'synastry',
        'groups': [
            _group(
                _person_label(model.person_a_name, 'Person A'),
                _synastry_planet_rows(entries_a, data.get('jd_a')),
                [],
                houses_a,
            ),
            _group(
                _person_label(model.person_b_name, 'Person B'),
                _synastry_planet_rows(entries_b, data.get('jd_b')),
                aspects,
                houses_b,
            ),
        ],
    }


def _transit_aspect_rows(raw_aspects):
    """Aspektzeilen aus `_build_transits_bundle` in der Lesart „Radix → Transit".

    Die Dicts der Berechnung führen unter `p1_name` den **Transit**-Körper und unter
    `p2_name` den **Radix**-Körper; für D-07 wird die Lesart gedreht, damit `a` immer der
    Radix-Körper ist. `orb` trägt dort `round(orb, 4)` und wird auf genau eine
    Nachkommastelle normalisiert (D-09, UI-SPEC „2,1°").

    Fehlt einer der vier Schlüssel oder ist `orb` `None`, entfällt die Zeile — dieselbe
    Degradation wie in `_aspect_row` und `_synastry_aspect_rows` (WR-02). `TransitResponse`
    typisiert `aspects` als `Optional[List[dict]]` und garantiert keinen der Schlüssel; eine
    500 auf einer reinen Anzeigefunktion wäre der schlechteste Ausgang.
    """
    rows = []
    for asp in raw_aspects or []:
        try:
            rows.append({
                'a': get_planet_de_by_english(asp['p2_name']),
                'b': get_planet_de_by_english(asp['p1_name']),
                'aspect': get_aspect_de_by_english(asp['aspect']),
                'orb': round(float(asp['orb']), 1),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return rows


def _transit_groups(model, request, radix_label, transit_label):
    """Radix- und Transit-Gruppe aus **einer** Transit-Rechnung (D-17, D-19).

    `_build_transits_bundle` liefert Antwort, Planetenlisten, beide julianischen Tage und
    beide Häuserlisten; Positionen, Aspektzeilen und Häuserspitzen stammen damit aus
    demselben Lauf und können sich innerhalb eines Kastens nicht mehr widersprechen
    (WR-01). Zusätzliche Ephemeridenkosten entstehen hier nur für das Retrograd-Flag:
    `_planet_row` holt es je Zeile über `calc_ut_with_speed`, weil die Planetenliste es
    nicht kennt. `request` ist Pflicht, weil die Sammelfunktion es für
    `ensure_astro_env(request.app)` braucht.
    """
    bundle = _build_transits_bundle(model, request)

    return [
        _group(
            radix_label,
            _planet_rows_from_entries(bundle.radix_entries, bundle.jd_birth),
            [],
            _house_rows(bundle.natal_houses),
        ),
        _group(
            transit_label,
            _planet_rows_from_entries(bundle.transit_entries, bundle.jd_transit),
            _transit_aspect_rows(bundle.response.aspects),
            _house_rows(bundle.transit_houses),
        ),
    ]


def _adapter_transits(model, request):
    """Adapter für `transits`: Radix- und Transit-Gruppe mit den Labels „Radix"/„Transit"."""
    return {
        'chart_type': 'transits',
        'groups': _transit_groups(model, request, 'Radix', 'Transit'),
    }


def _adapter_age_points(model, request):
    """Adapter für `age_points`: derselbe Transit-Datenweg, Label „Alterspunkt" (D-17)."""
    return {
        'chart_type': 'age_points',
        'groups': _transit_groups(model, request, 'Radix', 'Alterspunkt'),
    }


def _adapter_solar_return(model, request):
    """Adapter für `solar_return`: vorhandene Berechnung, Pydantic-Objekte projiziert."""
    response = _build_solar_return_response(model)
    jd = response.julian_day

    planets = [
        _planet_row(get_planet_de(planet.planet_id), planet.longitude, jd, planet.planet_id)
        for planet in response.planets
    ]
    aspects = [_aspect_row(asp.model_dump()) for asp in response.aspects]

    return {
        'chart_type': 'solar_return',
        'groups': [_group('Planeten', planets, aspects, _house_rows(response.houses))],
    }


# Dispatch ausschließlich über diese Tabelle — kein `getattr` auf den Modulnamen.
_BUILDERS = {
    'horoscope': (DateTimeRequest, _adapter_horoscope),
    'nodes': (DateTimeRequest, _adapter_nodes),
    'synastry': (SynastryRequest, _adapter_synastry),
    'transits': (TransitRequest, _adapter_transits),
    'solar_return': (SolarReturnRequest, _adapter_solar_return),
    'age_points': (TransitRequest, _adapter_age_points),
}


@router.post("/chart-data/{chart_type}")
def get_chart_data(chart_type: ChartType, payload: dict, request: Request):
    """Liefert die einem Chart zugrundeliegenden Daten als DTO (ohne KI-Aufruf)."""
    entry = _BUILDERS.get(chart_type)
    if not entry:
        raise HTTPException(status_code=404, detail="Unbekannte Chart-Art")

    model_class, adapter = entry
    try:
        model = model_class.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    return adapter(model, request)

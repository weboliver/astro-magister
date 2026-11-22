"""Deutsche Namen für Zeichen, Planeten und Aspekte.

Die englischen Vorlagen stehen in `app/static/zodiac_names.py`,
`app/services/planet_names.py` und `app/static/aspect_names.py`. Dieses Modul liefert
ausschließlich die deutsche Ausgabeseite derselben Reihenfolgen, damit das Frontend keine
eigene Zuordnung braucht (D-20/D-12: deutsche Namen kommen aus dem Backend).

Alle Helfer folgen dem Defensiv-Muster von `get_zodiac_name`/`get_planet_name`: bei
ungültiger Eingabe fällt der Helfer auf `str(index)` bzw. den Eingabewert zurück und wirft
nie eine Exception.
"""

from app.services.planet_names import PLANET_NAMES_LIST
from app.static.aspect_names import ASPECT_SHORT_ORDER, get_aspect_english_by_index

# Reihenfolge wie `ZODIAC_NAMES_LIST` (0 = Widder … 11 = Fische).
ZODIAC_NAMES_DE = [
    'Widder', 'Stier', 'Zwillinge', 'Krebs', 'Löwe', 'Jungfrau',
    'Waage', 'Skorpion', 'Schütze', 'Steinbock', 'Wassermann', 'Fische',
]

# Reihenfolge wie `PLANET_NAMES_LIST` (0 = Sonne … 12 = Chiron). Index 10 heißt dort
# „Node“ und ist im Chart der Mondknoten — dieselbe Lesart wie
# `AGE_POINT_PLANET_TRANSLATIONS['node']`.
PLANET_NAMES_DE = [
    'Sonne', 'Mond', 'Merkur', 'Venus', 'Mars', 'Jupiter', 'Saturn',
    'Uranus', 'Neptun', 'Pluto', 'Mondknoten', 'Lilith', 'Chiron',
]

# Die sieben Codes aus `ASPECT_SHORT_ORDER` (die Liste selbst wiederholt sie gespiegelt).
ASPECT_NAMES_DE_BY_SHORT = {
    'conj': 'Konjunktion',
    'semi': 'Halbsextil',
    'sext': 'Sextil',
    'cuad': 'Quadrat',
    'trig': 'Trigon',
    'quinc': 'Quincunx',
    'opos': 'Opposition',
}

# Zielwerte zu den englischen Labels aus `get_aspect_english_by_index`.
ASPECT_NAMES_DE_BY_ENGLISH = {
    'Conjunction': 'Konjunktion',
    'Semi-sextile': 'Halbsextil',
    'Sextile': 'Sextil',
    'Square': 'Quadrat',
    'Trigon': 'Trigon',
    'Quincunx': 'Quincunx',
    'Opposition': 'Opposition',
}


def get_zodiac_de(index):
    """Deutscher Zeichenname für Index 0..11. Bei ungültiger Eingabe `str(index)`."""
    try:
        i = int(index) % len(ZODIAC_NAMES_DE)
    except Exception:
        return str(index)
    return ZODIAC_NAMES_DE[i]


def get_planet_de(planet_id):
    """Deutscher Planetenname für `planet_id` 0..12. Sonst `str(planet_id)`."""
    try:
        i = int(planet_id)
    except Exception:
        return str(planet_id)
    if 0 <= i < len(PLANET_NAMES_DE):
        return PLANET_NAMES_DE[i]
    return str(planet_id)


def get_planet_de_by_english(name):
    """Deutscher Name zu einem englischen Planetenlabel aus `PLANET_NAMES_LIST`.

    Die Aspekt-Dicts der Berechnung tragen nur den englischen Namen; dieser Helfer ist der
    Weg von dort zurück auf die deutsche Ausgabe.
    """
    if not name:
        return name or ''
    try:
        i = PLANET_NAMES_LIST.index(name)
    except Exception:
        return str(name)
    return PLANET_NAMES_DE[i]


def get_aspect_de_by_index(idx):
    """Deutscher Aspektname zum Aspekt-Index (gespiegelte Liste aus `ASPECT_SHORT_ORDER`)."""
    try:
        code = ASPECT_SHORT_ORDER[int(idx) % len(ASPECT_SHORT_ORDER)]
    except Exception:
        return str(idx)
    return ASPECT_NAMES_DE_BY_SHORT.get(code, str(idx))


def get_aspect_de_by_english(label):
    """Deutscher Aspektname zum englischen Label (`get_aspect_english_by_index`).

    Unbekannte Labels werden unverändert durchgereicht — nie eine Exception.
    """
    if not label:
        return label or ''
    try:
        return ASPECT_NAMES_DE_BY_ENGLISH.get(label, str(label))
    except Exception:
        return str(label)

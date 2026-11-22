"""
Article cover rendering: curated glyph + two colour presets -> 400x210 WebP.

The file name hashes the *inputs* (glyph key, background hex, glyph hex, layout
constant, renderer version) and never the produced bytes. Byte identity is not
portable: the identical image is 6514 bytes with Pillow 13 and 6710 bytes with
Pillow 9.4 (different libwebp), so a byte hash would mint a new URL on every
environment change and a renderer fix would leave a stale image behind a one-year
``immutable`` cache.

Rendering fits the glyph's *ink* into a 280x130 box and centres that ink on the
image middle. A single ``font_size`` for all glyphs does not work: at size 96 a
zodiac sign is ~145x49 px (2.9:1) while a planet is ~85x85 px (1:1). The ``mm``
anchor aligns the em box, not the ink, and pushes zodiac signs noticeably
off-centre, so the ink box is measured and the drawing offset derived from it.
Verified in the project .venv (Pillow 9.4): all curated glyphs — the 12 zodiac
signs, the 11 planets and the 12 self-drawn houses — land on (200, 105) +-1 px
and encode to 1.3-5.3 KB (Pillow 13 in the API container differs by a few
percent, see above).

Houses are drawn, not typed: neither ``Astro-Nex.ttf`` nor Unicode encodes house symbols
(checked against the font's cmap and the Unicode name database), so ``_house_mask`` draws
a wheel of twelve sectors with the selected one filled.

Nothing in this module touches the database. Validation belongs to the input
schemas, persistence to the wiki service; both call the functions below.
"""
from __future__ import annotations

import functools
import hashlib
import math
import os
import tempfile
import threading
import unicodedata
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services.glyph_renderer import (
    PLANET_CODEPOINTS,
    ZODIAC_CODEPOINTS,
    get_font_path,
)

# ── Whitelist (D-01): the 12 zodiac signs, the 11 planets glyph_renderer maps, and the 12
# houses (drawn, see ``_house_mask``) ────────────────────────────────────────────────
# German labels are part of the whitelist because no backend source has them ("Erde"
# is missing from every translation table in the project).
GLYPHS: dict[str, dict] = {
    'aries':       {'char': chr(ZODIAC_CODEPOINTS[0]),  'name': 'Widder',     'family': 'zodiac'},
    'taurus':      {'char': chr(ZODIAC_CODEPOINTS[1]),  'name': 'Stier',      'family': 'zodiac'},
    'gemini':      {'char': chr(ZODIAC_CODEPOINTS[2]),  'name': 'Zwillinge',  'family': 'zodiac'},
    'cancer':      {'char': chr(ZODIAC_CODEPOINTS[3]),  'name': 'Krebs',      'family': 'zodiac'},
    'leo':         {'char': chr(ZODIAC_CODEPOINTS[4]),  'name': 'Löwe',       'family': 'zodiac'},
    'virgo':       {'char': chr(ZODIAC_CODEPOINTS[5]),  'name': 'Jungfrau',   'family': 'zodiac'},
    'libra':       {'char': chr(ZODIAC_CODEPOINTS[6]),  'name': 'Waage',      'family': 'zodiac'},
    'scorpio':     {'char': chr(ZODIAC_CODEPOINTS[7]),  'name': 'Skorpion',   'family': 'zodiac'},
    'sagittarius': {'char': chr(ZODIAC_CODEPOINTS[8]),  'name': 'Schütze',    'family': 'zodiac'},
    'capricorn':   {'char': chr(ZODIAC_CODEPOINTS[9]),  'name': 'Steinbock',  'family': 'zodiac'},
    'aquarius':    {'char': chr(ZODIAC_CODEPOINTS[10]), 'name': 'Wassermann', 'family': 'zodiac'},
    'pisces':      {'char': chr(ZODIAC_CODEPOINTS[11]), 'name': 'Fische',     'family': 'zodiac'},
    'sun':         {'char': chr(PLANET_CODEPOINTS['sun']),     'name': 'Sonne',   'family': 'planet'},
    'moon':        {'char': chr(PLANET_CODEPOINTS['moon']),    'name': 'Mond',    'family': 'planet'},
    'mercury':     {'char': chr(PLANET_CODEPOINTS['mercury']), 'name': 'Merkur',  'family': 'planet'},
    'venus':       {'char': chr(PLANET_CODEPOINTS['venus']),   'name': 'Venus',   'family': 'planet'},
    'earth':       {'char': chr(PLANET_CODEPOINTS['earth']),   'name': 'Erde',    'family': 'planet'},
    'mars':        {'char': chr(PLANET_CODEPOINTS['mars']),    'name': 'Mars',    'family': 'planet'},
    'jupiter':     {'char': chr(PLANET_CODEPOINTS['jupiter']), 'name': 'Jupiter', 'family': 'planet'},
    'saturn':      {'char': chr(PLANET_CODEPOINTS['saturn']),  'name': 'Saturn',  'family': 'planet'},
    'uranus':      {'char': chr(PLANET_CODEPOINTS['uranus']),  'name': 'Uranus',  'family': 'planet'},
    'neptune':     {'char': chr(PLANET_CODEPOINTS['neptune']), 'name': 'Neptun',  'family': 'planet'},
    'pluto':       {'char': chr(PLANET_CODEPOINTS['pluto']),   'name': 'Pluto',   'family': 'planet'},
    # Houses carry no ``char`` — neither the font nor Unicode has house symbols, so
    # ``_house_mask`` draws them. The number is the wheel sector (1 = top, clockwise).
    'house_1':  {'house': 1 , 'name': '1. Haus', 'family': 'house'},
    'house_2':  {'house': 2 , 'name': '2. Haus', 'family': 'house'},
    'house_3':  {'house': 3 , 'name': '3. Haus', 'family': 'house'},
    'house_4':  {'house': 4 , 'name': '4. Haus', 'family': 'house'},
    'house_5':  {'house': 5 , 'name': '5. Haus', 'family': 'house'},
    'house_6':  {'house': 6 , 'name': '6. Haus', 'family': 'house'},
    'house_7':  {'house': 7 , 'name': '7. Haus', 'family': 'house'},
    'house_8':  {'house': 8 , 'name': '8. Haus', 'family': 'house'},
    'house_9':  {'house': 9 , 'name': '9. Haus', 'family': 'house'},
    'house_10':  {'house': 10, 'name': '10. Haus', 'family': 'house'},
    'house_11':  {'house': 11, 'name': '11. Haus', 'family': 'house'},
    'house_12':  {'house': 12, 'name': '12. Haus', 'family': 'house'},
}

# ── Colour presets (D-03): a fixed palette, no free colour choice in the CMS ───────────
# Grouped on purpose: all 50 allowed pairs reach a contrast ratio of at least 5.27:1,
# while the 14 mixed pairs (dark glyph on a dark background or a light glyph on paper)
# are unreadable (e.g. bronze + tinte is ~1:1). The grouping is what makes the palette
# a safety feature instead of an 8x8 cross product.
#
# Palette revision 3 (2026-11-01, User-Feedback): revision 2 war noch zu wenig getrennt —
# Pflaume/Umbra und Nachtblau/Mitternacht blieben im ΔE2000 bei 8.7 bzw. 10.4, also praktisch
# ununterscheidbar. Jetzt liegt jedes Paar bei ΔE2000 ≥ 16.8 (Pflaume↔Umbra 18.9,
# Nachtblau↔Mitternacht 17.6), die dunklen Flächen bei 15–32 L*, und der kleinste Kontrast
# aller 50 erlaubten Paare bei 5.27:1 (bronze + flieder) — weiterhin deutlich über der 3:1-
# Schwelle, die die große Glyphe braucht.
#
# Weil der Hex in den Datei-Hash eingeht, ändert jede Palette-Revision alle Cover-URLs: kein
# stale `immutable`-Cache. Bestehende Zeilen werden von der jeweiligen `*_cover_palette_*`-
# Datenmigration umgeschrieben.
BG_PRESETS: list[dict] = [
    {'key': 'nachtblau',    'name': 'Nachtblau',    'hex': '#093155', 'family': 'dark'},
    {'key': 'pflaume',      'name': 'Pflaume',      'hex': '#45152D', 'family': 'dark'},
    {'key': 'tannengruen',  'name': 'Tannengrün',   'hex': '#113929', 'family': 'dark'},
    {'key': 'umbra',        'name': 'Umbra',        'hex': '#4D2515', 'family': 'dark'},
    {'key': 'schiefer',     'name': 'Schiefer',     'hex': '#494549', 'family': 'dark'},
    {'key': 'bronze',       'name': 'Bronze',       'hex': '#594929', 'family': 'dark'},
    {'key': 'mitternacht',  'name': 'Mitternacht',  'hex': '#553975', 'family': 'dark'},
    {'key': 'papier',       'name': 'Papier',       'hex': '#F4F1EA', 'family': 'light'},
]

GLYPH_PRESETS: list[dict] = [
    {'key': 'gold',      'name': 'Gold',      'hex': '#E8D9A0', 'families': ('dark',)},
    {'key': 'elfenbein', 'name': 'Elfenbein', 'hex': '#F2EEE3', 'families': ('dark',)},
    {'key': 'eisblau',   'name': 'Eisblau',   'hex': '#CBE0E6', 'families': ('dark',)},
    {'key': 'sand',      'name': 'Sand',      'hex': '#E7C6A8', 'families': ('dark',)},
    {'key': 'flieder',   'name': 'Flieder',   'hex': '#D5C2E8', 'families': ('dark',)},
    {'key': 'salbei',    'name': 'Salbei',    'hex': '#C6D6B4', 'families': ('dark',)},
    {'key': 'rose',      'name': 'Rosé',      'hex': '#EFD3D3', 'families': ('dark',)},
    {'key': 'tinte',     'name': 'Tinte',     'hex': '#1A2233', 'families': ('light',)},
]

# ── Layout / renderer constants — both are part of the file-name hash (D-07) ──────────
COVER_W, COVER_H = 400, 210
BOX_W, BOX_H = int(COVER_W * 0.70), int(COVER_H * 0.62)   # 280 x 130
REF_SIZE = 400
WEBP_QUALITY, WEBP_METHOD = 88, 6
COVER_LAYOUT = '400x210-fit-70x62-webp-q88-m6'
COVER_RENDER_VERSION = '2'    # bump on every visible renderer change (D-07)
# Cover files are served by nginx, which runs as a different user than the API.
COVER_FILE_MODE = 0o644

DEFAULT_BG_KEY = 'nachtblau'
DEFAULT_FG_KEY = 'gold'

# ── Standardbild (IMG-05, D-14 in der B-1-Auflösung) ─────────────────────────────────
# Das Verzeichnis ``app/static/wiki-covers/`` ist ein gitignoriertes Laufzeit-Artefakt
# (``.gitignore:127``): eine committete Datei kann es dort nicht geben, und
# ``git add --force`` ist laut AGENTS.md verboten. Der Miss-Router akzeptiert außerdem nur
# inhaltsadressierte Namen (``^[0-9a-f]{32}\.webp$``, ``app/routers/covers.py:27``), ein
# ``default.webp`` wäre also gar nicht auslieferbar. Das Standardbild ist deshalb eine
# gewöhnliche Whitelist-Auswahl: Sonne auf Schiefer mit Elfenbein — dieselbe Kette aus
# ``cover_url_for()`` und ``ensure_cover()`` wie jedes andere Cover, kein zweiter Pfad.
# Bewusst **nicht** das Eintrags-Default-Paar Nachtblau/Gold (A-7): sonst wäre „kein Bild
# gewählt“ nicht von einem echten Cover zu unterscheiden.
DEFAULT_COVER_GLYPH = 'sun'
DEFAULT_COVER_BG_KEY = 'schiefer'
DEFAULT_COVER_FG_KEY = 'elfenbein'

# Preview output sizes (IMG-02, §F-3): the stored file is always the full size, the CMS
# tiles ask for the same composition scaled down. Never a second geometry.
PREVIEW_VARIANTS = {'full': (COVER_W, COVER_H), 'tile': (COVER_W // 2, COVER_H // 2)}

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}
# One process-wide FreeTypeFont per size is shared by every threadpool thread (the render
# routes are sync ``def`` handlers). FreeType faces are not safe for concurrent use, so the
# cache lookup and every draw call with a cached font run under this lock. Re-entrant
# because ``_ink``/``_ink_mask`` hold it while calling ``_get_font``. The render path is
# short (~50-100 ms), so serialising it per worker is cheap.
_font_lock = threading.RLock()


# ── Preset lookups ───────────────────────────────────────────────────────────

def bg_preset(key: str) -> dict | None:
    """Return the background preset for *key*, or ``None`` when it is unknown."""
    for preset in BG_PRESETS:
        if preset['key'] == key:
            return preset
    return None


def fg_preset(key: str) -> dict | None:
    """Return the glyph-colour preset for *key*, or ``None`` when it is unknown."""
    for preset in GLYPH_PRESETS:
        if preset['key'] == key:
            return preset
    return None


def allowed_fg_keys(bg_key: str) -> list[str]:
    """Glyph-colour keys that may be combined with *bg_key* (empty for unknown keys).

    The palette is grouped by family so the CMS can only offer readable pairs; this is
    the single source of that rule for validation, the hash index and the UI.
    """
    background = bg_preset(bg_key)
    if background is None:
        return []
    return [
        preset['key']
        for preset in GLYPH_PRESETS
        if background['family'] in preset['families']
    ]


def is_allowed_pair(bg_key: str, fg_key: str) -> bool:
    """True when the two preset keys may be combined."""
    return fg_key in allowed_fg_keys(bg_key)


def bg_key_for_hex(hex_value) -> str | None:
    """Map a stored background hex back to its preset key (case-insensitive)."""
    if not isinstance(hex_value, str):
        return None
    wanted = hex_value.strip().upper()
    for preset in BG_PRESETS:
        if preset['hex'].upper() == wanted:
            return preset['key']
    return None


def fg_key_for_hex(hex_value) -> str | None:
    """Map a stored glyph hex back to its preset key (case-insensitive)."""
    if not isinstance(hex_value, str):
        return None
    wanted = hex_value.strip().upper()
    for preset in GLYPH_PRESETS:
        if preset['hex'].upper() == wanted:
            return preset['key']
    return None


def cover_options() -> dict:
    """Everything the CMS picker needs (IMG-02, V5) — no name or colour is hard-coded there.

    ``glyphs`` is in display order: the twelve zodiac signs in ``GLYPHS`` order (Widder …
    Fische), then the eleven planets (Sonne … Pluto). ``glyph_colors`` carries the allowed
    backgrounds per glyph colour, derived from the same ``families`` grouping that
    ``allowed_fg_keys`` validates against — so the picker can never offer a pair the server
    would reject.
    """
    glyphs = [
        {'key': key, 'name': preset['name'], 'family': preset['family']}
        for family in ('zodiac', 'planet', 'house')
        for key, preset in GLYPHS.items()
        if preset['family'] == family
    ]
    backgrounds = [
        {
            'key': preset['key'],
            'name': preset['name'],
            'hex': preset['hex'],
            'family': preset['family'],
        }
        for preset in BG_PRESETS
    ]
    glyph_colors = [
        {
            'key': preset['key'],
            'name': preset['name'],
            'hex': preset['hex'],
            'allowed_for': [
                background['key']
                for background in BG_PRESETS
                if background['family'] in preset['families']
            ],
        }
        for preset in GLYPH_PRESETS
    ]
    tile_background, tile_glyph_color = tile_pair()
    return {
        'glyphs': glyphs,
        'backgrounds': backgrounds,
        'glyph_colors': glyph_colors,
        'default_background': DEFAULT_BG_KEY,
        'default_glyph_color': DEFAULT_FG_KEY,
        # The neutral pair the picker uses for its 23 glyph tiles (UI-SPEC A-5); served so
        # the CMS never hard-codes a preset key (REVIEW WR-05).
        'tile_background': tile_background,
        'tile_glyph_color': tile_glyph_color,
    }


def tile_pair() -> tuple[str | None, str | None]:
    """Preset keys of the neutral tile pair: the first light background and its first glyph colour.

    Falls back to the default pair when the palette has no light background. Returns
    ``(None, None)`` only if not even that pair is allowed — the picker then shows an error
    instead of 23 blank tiles.
    """
    for background in BG_PRESETS:
        if background['family'] == 'light':
            allowed = allowed_fg_keys(background['key'])
            if allowed:
                return background['key'], allowed[0]
    if is_allowed_pair(DEFAULT_BG_KEY, DEFAULT_FG_KEY):
        return DEFAULT_BG_KEY, DEFAULT_FG_KEY
    return None, None


# ── Suggestion chain (IMG-07, D-04) — a pure string function ──────────────────
# Ordered (keyword, glyph_key) pairs. The list is sorted by keyword length, descending, right
# after its definition: the longest keyword wins, so "saturn" is never swallowed by a shorter
# one and the first hit is deterministic. Every keyword is written in the form ``_normalize``
# produces (lower case, no diacritics), and the German names come from ``GLYPHS`` — inflected
# forms, English keys and umlaut-free spellings are included because article titles use all of
# them ("Mondknoten", "Löwe", "loewe").
GLYPH_KEYWORDS: list[tuple[str, str]] = [
    # Planets
    ('sonne', 'sun'),
    ('sonnen', 'sun'),
    ('sun', 'sun'),
    ('mond', 'moon'),
    ('monde', 'moon'),
    ('moon', 'moon'),
    ('merkur', 'mercury'),
    ('mercury', 'mercury'),
    ('venus', 'venus'),
    ('erde', 'earth'),
    ('earth', 'earth'),
    ('mars', 'mars'),
    ('jupiter', 'jupiter'),
    ('saturn', 'saturn'),
    ('uranus', 'uranus'),
    ('neptun', 'neptune'),
    ('neptune', 'neptune'),
    ('pluto', 'pluto'),
    # Zodiac signs
    ('widder', 'aries'),
    ('aries', 'aries'),
    ('stier', 'taurus'),
    ('taurus', 'taurus'),
    ('zwillinge', 'gemini'),
    ('zwilling', 'gemini'),
    ('gemini', 'gemini'),
    ('krebs', 'cancer'),
    ('cancer', 'cancer'),
    ('loewe', 'leo'),
    ('lowe', 'leo'),
    ('leo', 'leo'),
    ('jungfrau', 'virgo'),
    ('virgo', 'virgo'),
    ('waage', 'libra'),
    ('libra', 'libra'),
    ('skorpion', 'scorpio'),
    ('scorpio', 'scorpio'),
    ('schuetze', 'sagittarius'),
    ('schutze', 'sagittarius'),
    ('sagittarius', 'sagittarius'),
    ('steinbock', 'capricorn'),
    ('capricorn', 'capricorn'),
    ('wassermann', 'aquarius'),
    ('aquarius', 'aquarius'),
    ('fische', 'pisces'),
    ('pisces', 'pisces'),
]

# Houses: the ordinal wording ("Erstes Haus"), the numeric form ("Haus 1", "1. Haus") and the
# umlaut spellings users actually type. Keywords are written the way ``_normalize`` produces
# them, and the longest-match sort below keeps "haus 12" from being eaten by "haus 1".
#
# They are a SEPARATE, LOWER-PRIORITY list: a title like "Saturn im 10. Haus" is about Saturn,
# and the sign/planet keyword must win there. Houses only decide when nothing else matched, so
# every suggestion that existed before houses were added stays exactly the same.
_HOUSE_WORDS = (
    ('erstes',), ('zweites',), ('drittes',), ('viertes',),
    ('funftes', 'fuenftes'), ('sechstes',), ('siebtes',), ('achtes',),
    ('neuntes',), ('zehntes',), ('elftes',), ('zwolftes', 'zwoelftes'),
)
HOUSE_KEYWORDS: list[tuple[str, str]] = []
for _number, _words in enumerate(_HOUSE_WORDS, start=1):
    _key = f'house_{_number}'
    for _word in _words:
        # "erstes Haus" (predicative) und "erste Haus" nach Artikel — beide Formen kommen vor.
        HOUSE_KEYWORDS.append((f'{_word} haus', _key))
        HOUSE_KEYWORDS.append((f'{_word[:-1]} haus', _key))
    HOUSE_KEYWORDS.append((f'{_number}. haus', _key))
    HOUSE_KEYWORDS.append((f'haus {_number}', _key))
del _number, _words, _key, _word

# Sorting at import time is part of the contract (``test_suggest_glyph_is_longest_match``):
# ``list.sort`` is stable, so equally long keywords keep their declared order.
GLYPH_KEYWORDS.sort(key=lambda item: len(item[0]), reverse=True)
HOUSE_KEYWORDS.sort(key=lambda item: len(item[0]), reverse=True)


def _normalize(text: str) -> str:
    """Lower-case *text* and strip its diacritics ("Löwe" must also match "loewe"/"lowe").

    ``NFKD`` splits a composed character into its base letter plus combining marks; dropping
    the marks leaves the ASCII spelling. "ß" does not decompose and is mapped to "ss" by hand.
    """
    decomposed = unicodedata.normalize('NFKD', text.lower())
    stripped = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.replace('ß', 'ss')


def suggest_glyph(name: str | None, category_name: str | None = None) -> str | None:
    """Suggest a glyph key for an entry from its title, falling back to its category name.

    Deterministic and free of database and Pillow access, which is what lets the bulk action
    check every candidate row without a query per row. No hit means **no suggestion**: the
    entry stays without an image instead of getting a forced or random glyph (D-04).
    """
    for keywords in (GLYPH_KEYWORDS, HOUSE_KEYWORDS):
        for candidate in (name, category_name):
            if not candidate:
                continue
            haystack = _normalize(str(candidate))
            for keyword, glyph_key in keywords:
                if keyword in haystack:
                    return glyph_key
    return None


# ── Ink measurement and rendering ────────────────────────────────────────────

def _get_font(size: int) -> ImageFont.FreeTypeFont:
    """Return a cached FreeTypeFont at *size* (a font load costs ~43 ms).

    ``layout_engine=BASIC`` is not a micro-optimisation, it is a correctness fix: the
    API imports the desktop chart stack (``astronex.chart`` → GTK3), and after that
    import Pillow's RAQM layout engine — the default whenever libraqm is present —
    silently rasterises *nothing*. Basic layout is exactly right here because every
    glyph is a single character, so no shaping or bidirectional layout is involved.
    """
    with _font_lock:
        font = _font_cache.get(size)
        if font is None:
            font = ImageFont.truetype(
                get_font_path(), size, layout_engine=ImageFont.Layout.BASIC
            )
            _font_cache[size] = font
        return font


def _ink(char: str, size: int):
    """Return the ink bounding box and font for *char* drawn at *size*.

    The box is measured on a ``size*5`` scratch canvas with the em anchor in its middle.
    Only its extent (width/height) is used for the contain fit; ``render_cover`` takes
    the drawing offset from the font's own ink box, so the em-box anchor never leaks
    into the final placement.
    """
    scratch = Image.new('L', (size * 5, size * 5), 0)
    with _font_lock:
        font = _get_font(size)
        ImageDraw.Draw(scratch).text(
            (size * 2, size * 2), char, fill=255, font=font, anchor='mm'
        )
    return scratch.getbbox(), font


def fit_size(char: str) -> int:
    """Font size whose ink fits the 280x130 box (zodiac is width-, planets height-bound).

    A missing or degenerate ink box falls back to ``REF_SIZE`` instead of scaling up:
    dividing by an empty box would ask for a canvas of billions of pixels, and a font
    that draws nothing must never turn into a decompression-bomb error.
    """
    bbox, _ = _ink(char, REF_SIZE)
    if bbox is None:
        return REF_SIZE
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if width < 2 or height < 2:
        return REF_SIZE
    scale = min(BOX_W / width, BOX_H / height)
    return max(1, round(REF_SIZE * scale))


def _ink_mask(char: str, size: int) -> Image.Image:
    """Render *char* at *size* into an L-mode mask cropped to its ink bounding box.

    Drawing at the default anchor and cropping afterwards is what makes the *rendered*
    ink the placement unit: the pasted crop is centred by its own size, so no em-box
    metric (and no anchor) can shift the glyph off the image middle.
    """
    layer = Image.new('L', (size * 5, size * 5), 0)
    with _font_lock:
        font = _get_font(size)
        ImageDraw.Draw(layer).text((size * 2, size * 2), char, fill=255, font=font)
    bbox = layer.getbbox()
    if bbox is None:
        # Never write a blank cover: an empty raster means the font failed, and a
        # silently blank image would be cached as immutable for a year (D-07).
        raise RuntimeError(f'glyph {char!r} produced no ink at size {size}')
    return layer.crop(bbox)


HOUSE_COUNT = 12

def _house_mask(number: int, size: int = BOX_H) -> Image.Image:
    """L-mask of the house wheel: twelve sectors, the *number*-th one filled.

    Sector 1 sits at the top and the wheel runs clockwise, the way a chart is read.
    Drawn at 4x and scaled down so the diagonals stay smooth; the result is a ``size``
    square, the height-bound geometry the planet glyphs use.
    """
    if not 1 <= number <= HOUSE_COUNT:
        raise ValueError(f'house number out of range: {number!r}')
    canvas = size * 4
    mask = Image.new('L', (canvas, canvas), 0)
    draw = ImageDraw.Draw(mask)
    centre = canvas / 2
    radius = canvas / 2 - 4
    stroke = max(2, round(canvas * 0.026))
    start = -90 + (number - 1) * 30 - 15
    box = [centre - radius, centre - radius, centre + radius, centre + radius]
    draw.pieslice(box, start, start + 30, fill=255)
    draw.ellipse(box, outline=255, width=stroke)
    for index in range(HOUSE_COUNT):
        angle = math.radians(-90 + index * 30)
        draw.line(
            [centre, centre,
             centre + math.cos(angle) * radius, centre + math.sin(angle) * radius],
            fill=255,
            width=stroke,
        )
    return mask.resize((size, size), Image.LANCZOS)


def _glyph_mask(glyph_key: str) -> Image.Image:
    """Ink mask for *glyph_key*: a font glyph for signs/planets, a drawn wheel for houses."""
    spec = GLYPHS[glyph_key]
    if 'house' in spec:
        return _house_mask(spec['house'])
    return _ink_mask(spec['char'], fit_size(spec['char']))


def render_cover(glyph_key: str, bg_hex: str, fg_hex: str, tile: bool = False) -> bytes:
    """Render one 400x210 WebP cover and return the encoded bytes.

    One geometry, two output sizes: ``tile=True`` shrinks the finished 400x210 composition to
    200x105 before encoding. The stored file is always the full size, so the file-name hash
    never depends on the variant (D-07).

    Raises ``KeyError`` for an unknown glyph key; callers validate the selection first.
    """
    ink = _glyph_mask(glyph_key)

    image = Image.new('RGB', (COVER_W, COVER_H), bg_hex)
    image.paste(
        Image.new('RGB', ink.size, fg_hex),
        (COVER_W // 2 - ink.width // 2, COVER_H // 2 - ink.height // 2),
        ink,
    )
    if tile:
        image = image.resize(PREVIEW_VARIANTS['tile'], Image.LANCZOS)

    buffer = BytesIO()
    image.save(buffer, format='WEBP', quality=WEBP_QUALITY, method=WEBP_METHOD)
    return buffer.getvalue()


# ── File-name hash, index, storage ───────────────────────────────────────────

def cover_hash(glyph_key: str, bg_hex: str, fg_hex: str) -> str:
    """Content-addressed name over the inputs (D-07). 32 hex chars = 128 bit.

    Layout constant and renderer version are part of the payload, so a renderer fix
    automatically produces new URLs for *every* entry — no data migration, no stale
    image behind a one-year ``immutable`` cache.
    """
    payload = f'{glyph_key}|{bg_hex.upper()}|{fg_hex.upper()}|{COVER_LAYOUT}|{COVER_RENDER_VERSION}'
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:32]


def cover_dir() -> Path:
    """Runtime directory for cover files, shared with nginx through the /workspace mount."""
    return Path(__file__).resolve().parent.parent / 'static' / 'wiki-covers'


def cover_url(hash_value: str) -> str:
    """Public URL of a cover file (no ``/api`` prefix — nginx serves it directly)."""
    return f'/static/wiki-covers/{hash_value}.webp'


def write_cover(name: str, data: bytes) -> Path:
    """Write a cover file atomically and return its path.

    Four uvicorn workers (and the threadpool inside each) can render the same file
    concurrently. Every writer therefore gets its *own* temporary file from
    ``tempfile.mkstemp`` in the target directory and publishes it with ``os.replace``.
    A shared, deterministic temp name would let two writers truncate and write the same
    inode — one of them would then publish a half-written image under an ``immutable``
    URL, or fail its rename with ``FileNotFoundError``. With a private temp file the
    last rename simply wins, and both candidates carry identical, complete bytes.
    """
    directory = cover_dir()
    directory.mkdir(parents=True, exist_ok=True)

    target = directory / f'{name}.webp'
    if target.is_file() and target.stat().st_size > 0:
        return target

    fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=f'{name}.', suffix='.tmp')
    try:
        # mkstemp creates the file 0600; nginx (another user) must be able to read it.
        os.fchmod(fd, COVER_FILE_MODE)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise
    return target


@functools.cache
def _hash_index() -> dict[str, tuple[str, str, str]]:
    """Map every renderable cover hash to its ``(glyph_key, bg_hex, fg_hex)`` params.

    The set is finite and small — 35 glyphs x 50 allowed colour pairs = 1 750 entries —
    so the render-on-miss path needs neither a database nor an inverse function: an
    unknown hash simply is not in the map, which bounds the renderable files to the
    whitelist. ``COVER_RENDER_VERSION`` is part of the hash, so a version bump builds a
    new index; tests clear it with ``_hash_index.cache_clear()``.
    """
    index: dict[str, tuple[str, str, str]] = {}
    for glyph_key in GLYPHS:
        for background in BG_PRESETS:
            for fg_key in allowed_fg_keys(background['key']):
                foreground = fg_preset(fg_key)
                index[cover_hash(glyph_key, background['hex'], foreground['hex'])] = (
                    glyph_key,
                    background['hex'],
                    foreground['hex'],
                )
    return index


def params_for_hash(hash_value) -> tuple[str, str, str] | None:
    """Resolve a file-name hash back to its render parameters, or ``None``."""
    if not isinstance(hash_value, str):
        return None
    return _hash_index().get(hash_value)


def cover_url_for(glyph_key, bg_hex, fg_hex) -> str | None:
    """Derive the public URL for a stored selection, or ``None``.

    Never raises: this runs in every read path (``EntryOut.cover_url``), and a preset
    that was later removed from the palette must degrade to "no image" instead of
    turning every entry response into a validation error.
    """
    if not isinstance(glyph_key, str) or glyph_key not in GLYPHS:
        return None
    if not bg_hex or not fg_hex:
        return None

    bg_key = bg_key_for_hex(bg_hex)
    fg_key = fg_key_for_hex(fg_hex)
    if bg_key is None or fg_key is None or not is_allowed_pair(bg_key, fg_key):
        return None

    background = bg_preset(bg_key)
    foreground = fg_preset(fg_key)
    return cover_url(
        cover_hash(glyph_key, background['hex'], foreground['hex'])
    )


def cover_alt_for(glyph_key) -> str | None:
    """German accessible name of a cover glyph, or ``None`` (no image / unknown key).

    Returns the full string including the ``Symbol `` prefix (e.g. ``'Symbol Saturn'``),
    so both clients — the React app and the JavaScript-free Astro page — can use the value
    directly as the ``alt`` attribute without further string work.

    Never raises: this runs in every read path. ``None`` means the caller renders
    ``alt=""`` (a decorative image or no image at all).
    """
    if not isinstance(glyph_key, str) or glyph_key not in GLYPHS:
        return None
    return f'Symbol {GLYPHS[glyph_key]["name"]}'


def default_cover_url() -> str | None:
    """Public URL of the one fallback image (IMG-05), or ``None`` if the palette changed.

    The default is an ordinary whitelisted selection, not a file in the repository: the
    cover directory is gitignored and the miss router only accepts content-addressed
    names. The file therefore does not exist until the first request creates it through
    the existing ``ensure_cover`` path — the *URL* is the contract, not the file.

    ``None`` only if a preset of the default pair is ever removed from the palette; the
    callers then fall back to "no image" instead of inventing a path.
    """
    background = bg_preset(DEFAULT_COVER_BG_KEY)
    foreground = fg_preset(DEFAULT_COVER_FG_KEY)
    if background is None or foreground is None:
        return None
    return cover_url_for(DEFAULT_COVER_GLYPH, background['hex'], foreground['hex'])


def ensure_cover(glyph_key: str, bg_hex: str, fg_hex: str) -> Path:
    """Return the cover file for a selection, rendering it only when it is missing.

    The one place that renders a persisted cover: the write path, the render-on-miss
    endpoint and the bulk suggestion all go through here, so there is no second
    render call anywhere.
    """
    name = cover_hash(glyph_key, bg_hex, fg_hex)
    target = cover_dir() / f'{name}.webp'
    # An empty file is never a finished cover (a crashed or foreign writer); re-render it.
    if target.is_file() and target.stat().st_size > 0:
        return target
    return write_cover(name, render_cover(glyph_key, bg_hex, fg_hex))


def cover_params_from_keys(glyph_key: str, bg_key: str, fg_key: str) -> dict:
    """Resolve preset keys to the three canonical column values.

    Returns ``{"cover_glyph", "cover_bg", "cover_fg"}`` with the palette's own hex
    spelling — no hash, because none is stored (it is derived on every read). Raises
    ``KeyError`` for an unknown key or a pair the palette does not allow; the schema
    already rejects both, this is the belt next to the braces.
    """
    if glyph_key not in GLYPHS:
        raise KeyError(glyph_key)

    background = bg_preset(bg_key)
    if background is None:
        raise KeyError(bg_key)

    foreground = fg_preset(fg_key)
    if foreground is None:
        raise KeyError(fg_key)

    if not is_allowed_pair(bg_key, fg_key):
        raise KeyError(f'{bg_key}/{fg_key}')

    return {
        'cover_glyph': glyph_key,
        'cover_bg': background['hex'],
        'cover_fg': foreground['hex'],
    }

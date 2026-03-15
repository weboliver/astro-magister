"""Aspect name resources (short codes -> English full names).

Provide ordered lists matching `astronex.chart.aspnames` and helpers for lookup.
"""

ASPECT_SHORT_ORDER = [
    'conj', 'semi', 'sext', 'cuad', 'trig', 'quinc', 'opos', 'quinc', 'trig', 'cuad', 'sext', 'semi'
]

ASPECT_ENGLISH_BY_SHORT = {
    'conj': 'Conjunction',
    'semi': 'Semi-sextile',
    'sext': 'Sextile',
    'cuad': 'Square',
    'trig': 'Trigon',
    'quinc': 'Quincunx',
    'opos': 'Opposition',
}


def get_aspect_english_by_short(code: str) -> str:
    """Return English name for a short code like 'conj' or 'opos'."""
    if not code:
        return ''
    return ASPECT_ENGLISH_BY_SHORT.get(code, str(code))


def get_aspect_english_by_index(idx: int) -> str:
    """Return English name for an aspect index aligned with ASPECT_SHORT_ORDER."""
    try:
        code = ASPECT_SHORT_ORDER[int(idx) % len(ASPECT_SHORT_ORDER)]
    except Exception:
        return ''
    return get_aspect_english_by_short(code)

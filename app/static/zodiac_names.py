"""English zodiac sign names for REST API usage.

Exports `ZODIAC_NAMES_LIST` (0..11) and helper `get_zodiac_name(index)`.
"""

ZODIAC_NAMES_LIST = [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
]


def get_zodiac_name(idx):
    """Return English zodiac name for index 0..11. On invalid input, return str(idx)."""
    try:
        i = int(idx) % len(ZODIAC_NAMES_LIST)
    except Exception:
        return str(idx)
    return ZODIAC_NAMES_LIST[i]

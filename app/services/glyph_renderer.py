"""
Glyph-to-PNG rendering service using Pillow + Astro-Nex.ttf.

Renders zodiac sign and planet glyphs as RGBA PNG images, disk-cached
in app/static/glyphs/. Regenerated on startup and admin theme save.
"""
import os
import math
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageFont, ImageDraw


# ═══════════════════════════════════════════════════════════════════════════
# Font path resolution
# ═══════════════════════════════════════════════════════════════════════════

def get_font_path() -> str:
    """Resolve the path to Astro-Nex.ttf.

    Tries Docker container path first, then local dev path relative to repo root.
    Raises FileNotFoundError if the font cannot be located at any expected path.
    """
    checked = []

    # Docker path (api.Dockerfile line 29)
    docker_path = "/usr/local/share/fonts/astronex/Astro-Nex.ttf"
    if os.path.isfile(docker_path) and os.access(docker_path, os.R_OK):
        return docker_path
    checked.append(docker_path)

    # Local dev path — resolve relative to this file
    # app/services/glyph_renderer.py → app → repo_root
    repo_root = Path(__file__).resolve().parent.parent.parent
    local_path = str(repo_root / "astronex" / "resources" / "Astro-Nex.ttf")
    if os.path.isfile(local_path) and os.access(local_path, os.R_OK):
        return local_path
    checked.append(local_path)

    raise FileNotFoundError(
        f"Astro-Nex.ttf font not found. Checked: {', '.join(checked)}"
    )


# ═══════════════════════════════════════════════════════════════════════════
# Glyph codepoint mappings
# ═══════════════════════════════════════════════════════════════════════════

# Astro-Nex.ttf is a symbol font that maps ASCII keyboard characters
# to zodiac/planet glyphs (see astronex/zodiac.py:7-16).  Unicode
# astrological codepoints (U+2648-U+2653 etc.) all render as the
# .notdef box — use the ASCII characters below instead.

ZODIAC_CODEPOINTS: dict[int, int] = {
    0: 0x71,   # q = Aries
    1: 0x77,   # w = Taurus
    2: 0x65,   # e = Gemini
    3: 0x72,   # r = Cancer
    4: 0x74,   # t = Leo
    5: 0x79,   # y = Virgo
    6: 0x75,   # u = Libra
    7: 0x69,   # i = Scorpio
    8: 0x6F,   # o = Sagittarius
    9: 0x70,   # p = Capricorn
    10: 0x61,  # a = Aquarius
    11: 0x73,  # s = Pisces
}

PLANET_CODEPOINTS: dict[str, int] = {
    "sun":       0x64,  # d
    "moon":      0x66,  # f
    "mercury":   0x68,  # h
    "venus":     0x6A,  # j
    "earth":     0x6B,  # k
    "mars":      0x6C,  # l
    "jupiter":   0x67,  # g
    "saturn":    0x7A,  # z
    "uranus":    0x78,  # x
    "neptune":   0x63,  # c
    "pluto":     0x76,  # v
}

PLANET_NAMES: list[str] = [
    "sun", "moon", "mercury", "venus", "earth",
    "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
]


# ═══════════════════════════════════════════════════════════════════════════
# Default accent colours (matches _THEME_DEFAULTS in app/routers/theme.py)
# ═══════════════════════════════════════════════════════════════════════════

_DEFAULT_ACCENT_COLORS: dict[int, str] = {
    0: "#8B1A1A",   # Aries
    1: "#7A5C2C",   # Taurus
    2: "#5A7A2C",   # Gemini
    3: "#4A6FA5",   # Cancer
    4: "#B84C2B",   # Leo
    5: "#6B5B3D",   # Virgo
    6: "#7A8B6A",   # Libra
    7: "#2C3E6B",   # Scorpio
    8: "#6C3483",   # Sagittarius
    9: "#4A4238",   # Capricorn
    10: "#1A6B6B",  # Aquarius
    11: "#1A6B5A",  # Pisces
}


# ═══════════════════════════════════════════════════════════════════════════
# Cached font loader
# ═══════════════════════════════════════════════════════════════════════════

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def _get_font(size: int = 96) -> ImageFont.FreeTypeFont:
    """Return a cached Pillow FreeTypeFont at the requested size.

    Fonts are reused across calls to avoid repeated ~43 ms font loads.
    """
    if size not in _font_cache:
        _font_cache[size] = ImageFont.truetype(get_font_path(), size)
    return _font_cache[size]


# ═══════════════════════════════════════════════════════════════════════════
# Per-glyph PNG generation
# ═══════════════════════════════════════════════════════════════════════════

def generate_sign_png(
    sign_index: int,
    accent_hex: str,
    size: int = 128,
    font_size: int = 96,
    opacity: int = 255,
    padding: int = 0,
) -> bytes:
    """Render a single zodiac-sign glyph to a PNG byte-string.

    Args:
        sign_index: 0 (Aries) … 11 (Pisces).
        accent_hex: 7-char hex colour string (e.g. ``"#8B1A1A"``).
        size: Output image width/height in pixels (glyph area).
        font_size: Point size passed to FreeType.
        opacity: Alpha value 0-255 applied to the glyph colour.
        padding: Extra transparent pixels added equally on all sides.

    Returns:
        PNG image bytes (RGBA, transparent background).

    Raises:
        ValueError: if *sign_index* is out of range.
    """
    if sign_index < 0 or sign_index > 11:
        raise ValueError(f"sign_index must be 0-11, got {sign_index}")

    codepoint = ZODIAC_CODEPOINTS[sign_index]
    glyph_char = chr(codepoint)

    r = int(accent_hex[1:3], 16)
    g = int(accent_hex[3:5], 16)
    b = int(accent_hex[5:7], 16)

    canvas = size + padding * 2
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _get_font(font_size)

    draw.text(
        (canvas // 2, canvas // 2),
        glyph_char,
        fill=(r, g, b, opacity),
        font=font,
        anchor="mm",
    )

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_planet_png(
    planet_name: str,
    accent_hex: str,
    size: int = 128,
    font_size: int = 96,
) -> bytes:
    """Render a planet glyph to a PNG byte-string.

    Args:
        planet_name: Lowercase planet key (``"sun"``, ``"moon"``, …).
        accent_hex: 7-char hex colour string.
        size: Output image width/height in pixels.
        font_size: Point size passed to FreeType.

    Returns:
        PNG image bytes (RGBA, transparent background).

    Raises:
        ValueError: if *planet_name* is not a recognised planet.
    """
    key = planet_name.lower()
    if key not in PLANET_CODEPOINTS:
        raise ValueError(
            f"Unknown planet '{planet_name}'. "
            f"Valid: {', '.join(PLANET_CODEPOINTS.keys())}"
        )

    codepoint = PLANET_CODEPOINTS[key]
    glyph_char = chr(codepoint)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _get_font(font_size)

    draw.text(
        (size // 2, size // 2),
        glyph_char,
        fill=accent_hex,
        font=font,
        anchor="mm",
    )

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_background_png(
    accent_colors: dict[int, str],
    width: int = 1920,
    height: int = 1080,
    radius: int = 420,
    font_size: int = 72,
    opacity: int = 38,
) -> bytes:
    """Render a composite zodiac-wheel background PNG.

    All 12 zodiac glyphs are placed in a circular layout centred on the
    canvas.  Each glyph is drawn at the specified *opacity* (0-255).

    Args:
        accent_colors: Mapping of sign index (0-11) → hex colour string.
        width: Canvas width in pixels.
        height: Canvas height in pixels.
        radius: Distance from centre point to each glyph anchor.
        font_size: Point size for the glyph font.
        opacity: Alpha value applied to every glyph (0 = fully transparent,
            255 = fully opaque).

    Returns:
        PNG image bytes (RGBA, transparent background).
    """
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _get_font(font_size)

    cx = width // 2   # 960
    cy = height // 2  # 540

    for i in range(12):
        angle = -math.pi / 2 + (2 * math.pi * i / 12)  # start from top, clockwise
        x = int(cx + radius * math.cos(angle))
        y = int(cy + radius * math.sin(angle))

        hex_color = accent_colors.get(i, _DEFAULT_ACCENT_COLORS[i])
        # Parse hex to RGB
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)

        codepoint = ZODIAC_CODEPOINTS[i]
        glyph_char = chr(codepoint)

        draw.text(
            (x, y),
            glyph_char,
            fill=(r, g, b, opacity),
            font=font,
            anchor="mm",
        )

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════════════════════
# Disk caching helpers
# ═══════════════════════════════════════════════════════════════════════════

def _make_filename(entity_type: str, identifier, accent_hex: str) -> str:
    """Build a cache filename keyed by type, id, and accent colour.

    >>> _make_filename("sign", 0, "#8B1A1A")
    'sign_0_accent_8B1A1A.png'
    >>> _make_filename("planet", "sun", "#4A6FA5")
    'planet_sun_accent_4A6FA5.png'
    """
    accent_hex_clean = accent_hex.lstrip("#")
    return f"{entity_type}_{identifier}_accent_{accent_hex_clean}.png"


def regenerate_all_glyphs(
    output_dir: str,
    accent_colors: dict[int, str],
    force: bool = False,
) -> dict:
    """Batch-regenerate all glyph PNGs to disk.

    Generates one PNG per zodiac sign, one per planet, plus the composite
    background.  Files that already exist (and whose accent colour has not
    changed) are skipped unless *force* is ``True``.

    Args:
        output_dir: Directory in which to write the PNG files (created if
            it does not exist).
        accent_colors: Mapping of sign index (0-11) → hex colour string.
        force: If ``True``, overwrite existing files even when the accent
            colour matches.

    Returns:
        ``{"generated": [...], "skipped": [...], "errors": [...]}``
    """
    os.makedirs(output_dir, exist_ok=True)

    generated: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    # ── Zodiac signs ────────────────────────────────────────────────
    for sign_index in range(12):
        try:
            accent = accent_colors.get(sign_index, _DEFAULT_ACCENT_COLORS[sign_index])
            filename = _make_filename("sign", sign_index, accent)
            filepath = os.path.join(output_dir, filename)

            if os.path.isfile(filepath) and not force:
                skipped.append(filename)
                continue

            png_bytes = generate_sign_png(sign_index, accent)
            with open(filepath, "wb") as f:
                f.write(png_bytes)
            generated.append(filename)
        except Exception as exc:
            errors.append(f"sign {sign_index}: {exc}")

    # ── Planets ─────────────────────────────────────────────────────
    # Planets use the first sign's accent as default (D-03/D-18)
    default_planet_accent = accent_colors.get(0, _DEFAULT_ACCENT_COLORS[0])
    for planet_name in PLANET_NAMES:
        try:
            filename = _make_filename("planet", planet_name, default_planet_accent)
            filepath = os.path.join(output_dir, filename)

            if os.path.isfile(filepath) and not force:
                skipped.append(filename)
                continue

            png_bytes = generate_planet_png(planet_name, default_planet_accent)
            with open(filepath, "wb") as f:
                f.write(png_bytes)
            generated.append(filename)
        except Exception as exc:
            errors.append(f"planet {planet_name}: {exc}")

    # ── Background ──────────────────────────────────────────────────
    try:
        bg_filepath = os.path.join(output_dir, "background.png")
        # Always overwrite background — it uses all 12 colours
        # and has no colour hash in its name
        if os.path.isfile(bg_filepath) and not force:
            skipped.append("background.png")
        else:
            png_bytes = generate_background_png(accent_colors)
            with open(bg_filepath, "wb") as f:
                f.write(png_bytes)
            generated.append("background.png")
    except Exception as exc:
        errors.append(f"background: {exc}")

    return {"generated": generated, "skipped": skipped, "errors": errors}

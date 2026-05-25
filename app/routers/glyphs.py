"""
Glyph PNG endpoints — serve zodiac/planet glyph images and composite background.

Endpoints serve disk-cached PNGs. Missing files are generated on-demand
from the glyph_renderer service. All endpoints are public (no auth required).
"""
import json
import os
import subprocess
import sys

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.db.models.settings import AppSetting
from app.db.session import get_session
from app.services.glyph_renderer import (
    ZODIAC_CODEPOINTS,
    PLANET_CODEPOINTS,
    PLANET_NAMES,
    _DEFAULT_ACCENT_COLORS,
)

router = APIRouter(prefix="/theme/glyph", tags=["glyphs"])


# ══════════════════════════════════════════════════════════════════
# In-memory glyph cache — rendered once at startup via subprocess
# ══════════════════════════════════════════════════════════════════

_GLYPH_CACHE: dict[str, bytes] = {}
_CHARS = ['q','w','e','r','t','y','u','i','o','p','a','s']


def _cache_key(index: int, opacity: int, padding: int) -> str:
    return f"s{index}_o{opacity}_p{padding}"


def warm_glyph_cache(accent_colors: dict | None = None):
    """Pre-render all sign glyphs. Overwrites existing cache entries."""
    if accent_colors is None:
        accent_colors = {i: '#324c9a' for i in range(12)}
    combos = [(255, 0), (76, 0)]
    to_render = []
    for i in range(12):
        acc = accent_colors.get(i, '#324c9a')
        for op, pad in combos:
            key = _cache_key(i, op, pad)
            to_render.append((key, _CHARS[i], acc, op, pad))

    if not to_render:
        return

    # Build a single Python script that renders all glyphs and outputs them
    # as base64-encoded chunks separated by newlines
    lines = ["from PIL import Image, ImageFont, ImageDraw", "from io import BytesIO", "import base64, sys"]
    lines.append("font = ImageFont.truetype('/usr/local/share/fonts/astronex/Astro-Nex.ttf', 96)")
    for key, ch, acc, op, pad in to_render:
        r, g, b = int(acc[1:3], 16), int(acc[3:5], 16), int(acc[5:7], 16)
        canvas = 128 + pad * 2
        lines.append(f"img = Image.new('RGBA', ({canvas}, {canvas}), (0, 0, 0, 0))")
        lines.append("draw = ImageDraw.Draw(img)")
        lines.append(f"draw.text(({canvas // 2}, {canvas // 2}), {ch!r}, fill=({r}, {g}, {b}, {op}), font=font, anchor='mm')")
        lines.append("buf = BytesIO()")
        lines.append("img.save(buf, format='PNG')")
        lines.append(f"print({key!r})")
        lines.append("sys.stdout.buffer.write(base64.b64encode(buf.getvalue()) + b'\\n')")
        lines.append("sys.stdout.flush()")

    proc = subprocess.run(
        [sys.executable, '-c', '\n'.join(lines)],
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Glyph render failed: {proc.stderr.decode()[:200]}")

    # Parse output: key\nbase64\nkey\nbase64\n...
    parts = proc.stdout.strip().split(b'\n')
    for i in range(0, len(parts), 2):
        key = parts[i].decode()
        data = __import__('base64').b64decode(parts[i + 1])
        _GLYPH_CACHE[key] = data


# Warm cache at import time with defaults
warm_glyph_cache()


def refresh_glyph_cache():
    """Re-warm the cache with per-sign accent colors from DB."""
    import logging
    log = logging.getLogger("uvicorn")
    try:
        session = get_session()
        try:
            row = session.query(AppSetting).filter(
                AppSetting.setting_name == "zodiac_theme"
            ).first()
            accent_colors = dict(_DEFAULT_ACCENT_COLORS)
            if row and row.setting_value:
                theme = json.loads(row.setting_value)
                for k, v in theme.items():
                    accent = v.get("accent")
                    if accent:
                        accent_colors[int(k)] = accent
        finally:
            session.close()
        warm_glyph_cache(accent_colors)
        log.info("Glyph cache refreshed (%d sign-specific accents)", len(accent_colors))
    except Exception:
        log.warning("Glyph cache refresh failed", exc_info=True)


# ── Helpers ────────────────────────────────────────────────────────

def _get_accent_for_sign(sign_index: int) -> str:
    """Read the accent colour for *sign_index* from the DB theme.

    Falls back to ``_DEFAULT_ACCENT_COLORS`` when no stored theme exists.
    """
    session = get_session()
    try:
        row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()
        if row and row.setting_value:
            try:
                theme = json.loads(row.setting_value)
                accent = theme.get(str(sign_index), {}).get("accent")
                if accent:
                    return accent
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
    finally:
        session.close()
    return _DEFAULT_ACCENT_COLORS.get(sign_index, "#8B1A1A")


def _get_all_accent_colors() -> dict[int, str]:
    """Read the full 12-sign accent palette from the DB theme.

    Falls back to ``_DEFAULT_ACCENT_COLORS`` when no stored theme exists.
    """
    session = get_session()
    try:
        row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()
        if row and row.setting_value:
            try:
                theme = json.loads(row.setting_value)
                result = {}
                for k, v in theme.items():
                    accent = v.get("accent")
                    if accent:
                        result[int(k)] = accent
                if len(result) == 12:
                    return result
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
    finally:
        session.close()
    return dict(_DEFAULT_ACCENT_COLORS)


# ── Endpoints ──────────────────────────────────────────────────────

@router.get("/sign/{index}")
def get_sign_glyph(index: int, opacity: int = 255, padding: int = 0):
    """Serve the zodiac-sign glyph PNG for *index* (0–11). Cache-only."""
    if index < 0 or index > 11:
        raise HTTPException(status_code=422, detail="Sign index must be 0-11")

    key = _cache_key(index, opacity or 255, padding or 0)
    data = _GLYPH_CACHE.get(key)
    if not data:
        raise HTTPException(status_code=404, detail="Glyph not in cache")

    return Response(content=data, media_type="image/png")


@router.get("/planet/{index}")
def get_planet_glyph(index: int):
    """Not implemented — no planet glyphs needed currently."""
    raise HTTPException(status_code=404, detail="Not implemented")


@router.get("/background")
def get_background():
    """Not implemented — background glyph pattern removed."""
    raise HTTPException(status_code=404, detail="Not implemented")

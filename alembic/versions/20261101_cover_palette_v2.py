"""rewrite stored cover colours for palette revision 2

Revision ID: 20261101_cover_palette_v2
Revises: 20261101_cover_home
Create Date: 2026-11-01

Palette revision 2 (#39) lightened every dark cover background and pulled the three
blue-ish tones apart (Nachtblau/Schiefer/Mitternacht differed by ΔE 1.8–6.7 before).

The stored values are the *hex* of a preset, not its key, so a hex change would leave
existing rows pointing at a colour that no longer exists: ``bg_key_for_hex`` would return
``None``, the CMS would show no selection and ``cover_url_for`` would return ``None`` —
every already-illustrated article would silently lose its image. This migration rewrites
the old hex to the new one, which keeps the selection intact and gives the entry the URL
of the re-coloured image (the file name hashes the hex, so no old image is reused).

Only ``cover_bg`` is affected: no glyph colour changed. The update is keyed on the
uppercase form because ``app/routers/wiki.py`` normalises stored hex to uppercase.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20261101_cover_palette_v2'
down_revision: Union[str, None] = '20261101_cover_home'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Preset key → (revision 1 hex, revision 2 hex). Keep in step with BG_PRESETS in
# app/services/wiki_covers.py.
PALETTE_V2: dict[str, tuple[str, str]] = {
    'nachtblau':   ('#141B2B', '#1E2C4F'),
    'pflaume':     ('#241428', '#3A1B33'),
    'tannengruen': ('#0E211B', '#14301F'),
    'umbra':       ('#231710', '#37201A'),
    'schiefer':    ('#1B2028', '#343B44'),
    'bronze':      ('#2A2116', '#4E3C1F'),
    'mitternacht': ('#101827', '#332A63'),
}


def _rewrite(mapping: dict[str, str]) -> None:
    for old_hex, new_hex in mapping.items():
        op.execute(
            "UPDATE entries SET cover_bg = '{}' WHERE UPPER(cover_bg) = '{}'".format(
                new_hex, old_hex.upper()
            )
        )


def upgrade() -> None:
    _rewrite({old: new for old, new in PALETTE_V2.values()})


def downgrade() -> None:
    _rewrite({new: old for old, new in PALETTE_V2.values()})

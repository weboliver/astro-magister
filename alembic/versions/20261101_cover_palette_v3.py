"""rewrite stored cover colours for palette revision 3

Revision ID: 20261101_cover_palette_v3
Revises: 20261101_cover_palette_v2
Create Date: 2026-11-01

Revision 2 was not separated enough: Pflaume/Umbra and Nachtblau/Mitternacht sat at
ΔE2000 8.7–10.4, i.e. practically the same colour on screen. Revision 3 spreads every
pair to ΔE2000 ≥ 16.8 and lifts the whole dark family to 15–32 L*.

Both prior generations are rewritten here, so a database that never ran revision 2 and
one that already did both end up on revision 3. Only ``cover_bg`` is affected — no glyph
colour changed.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20261101_cover_palette_v3'
down_revision: Union[str, None] = '20261101_cover_palette_v2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Revision 1 (original palette) and revision 2 → revision 3. Keep in step with BG_PRESETS
# in app/services/wiki_covers.py.
V1_TO_V3: dict[str, str] = {
    '#141B2B': '#093155',   # nachtblau
    '#241428': '#45152D',   # pflaume
    '#0E211B': '#113929',   # tannengruen
    '#231710': '#4D2515',   # umbra
    '#1B2028': '#494549',   # schiefer
    '#2A2116': '#594929',   # bronze
    '#101827': '#553975',   # mitternacht
}

V2_TO_V3: dict[str, str] = {
    '#1E2C4F': '#093155',   # nachtblau
    '#3A1B33': '#45152D',   # pflaume
    '#14301F': '#113929',   # tannengruen
    '#37201A': '#4D2515',   # umbra
    '#343B44': '#494549',   # schiefer
    '#4E3C1F': '#594929',   # bronze
    '#332A63': '#553975',   # mitternacht
}


def _rewrite(mapping: dict[str, str]) -> None:
    for old_hex, new_hex in mapping.items():
        op.execute(
            "UPDATE entries SET cover_bg = '{}' WHERE UPPER(cover_bg) = '{}'".format(
                new_hex, old_hex.upper()
            )
        )


def upgrade() -> None:
    _rewrite(V1_TO_V3)
    _rewrite(V2_TO_V3)


def downgrade() -> None:
    # Back to revision 2, the immediate predecessor.
    _rewrite({new: old for old, new in V2_TO_V3.items()})

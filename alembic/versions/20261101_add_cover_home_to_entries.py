"""add cover parameters and home curation columns to entries

Revision ID: 20261101_cover_home
Revises: res_tz_to_persons
Create Date: 2026-11-01

Five columns and one index, no data migration: every new column is nullable or carries
a server default.

Idempotent DDL on purpose instead of an inspector check:
``scripts/docker_init_postgres.sh`` runs ``Base.metadata.create_all()`` and *then*
``alembic upgrade head`` on every API start. On a fresh database ``create_all`` already
created the columns from the ORM, on an existing one it did not — ``ADD COLUMN IF NOT
EXISTS`` covers both cases atomically, without the TOCTOU window an inspector check
leaves between "look" and "alter".

There is deliberately no stored hash column: the file name is derived from
``cover_glyph``/``cover_bg``/``cover_fg`` plus the layout and renderer constants on
every read, so a renderer-version bump changes the URL of every existing entry without
a migration (D-07).
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20261101_cover_home'
down_revision: Union[str, None] = 'res_tz_to_persons'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS cover_glyph VARCHAR(32)")
    op.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS cover_bg VARCHAR(7)")
    op.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS cover_fg VARCHAR(7)")
    op.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS home_featured BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS home_order INTEGER")
    op.execute("CREATE INDEX IF NOT EXISTS ix_entries_home_curated ON entries (home_featured, home_order)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_entries_home_curated")
    op.execute("ALTER TABLE entries DROP COLUMN IF EXISTS home_order")
    op.execute("ALTER TABLE entries DROP COLUMN IF EXISTS home_featured")
    op.execute("ALTER TABLE entries DROP COLUMN IF EXISTS cover_fg")
    op.execute("ALTER TABLE entries DROP COLUMN IF EXISTS cover_bg")
    op.execute("ALTER TABLE entries DROP COLUMN IF EXISTS cover_glyph")

"""add slug column to entries

Revision ID: 20260516_slug
Revises: a1b2c3d4e5f6
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = '20260516_slug'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('entries')]
    if 'slug' not in columns:
        op.add_column('entries', sa.Column('slug', sa.String(length=511), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('entries')]
    if 'slug' in columns:
        op.drop_column('entries', 'slug')
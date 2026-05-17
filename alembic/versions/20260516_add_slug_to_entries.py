"""add slug column to entries

Revision ID: 20260516_slug
Revises: a1b2c3d4e5f6
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa

revision = '20260516_slug'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('entries', sa.Column('slug', sa.String(length=511), nullable=True))


def downgrade() -> None:
    op.drop_column('entries', 'slug')
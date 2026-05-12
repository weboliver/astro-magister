"""add transit_location to user_interpretations

Revision ID: a1b2c3d4e5f6
Revises: fc9d99663118
Create Date: 2026-05-01

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'fc9d99663118'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_interpretations',
        sa.Column('transit_location_latitude', sa.Float(), nullable=True),
    )
    op.add_column(
        'user_interpretations',
        sa.Column('transit_location_longitude', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('user_interpretations', 'transit_location_longitude')
    op.drop_column('user_interpretations', 'transit_location_latitude')

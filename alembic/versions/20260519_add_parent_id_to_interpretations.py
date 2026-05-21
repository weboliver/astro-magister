"""add parent_id to user_interpretations

Revision ID: a1b2c3d4e5f7
Revises: 20260516_slug
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = '20260516_slug'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_interpretations', sa.Column(
        'parent_id',
        sa.Integer(),
        sa.ForeignKey('user_persons.id', ondelete='SET NULL'),
        nullable=True
    ))
    op.create_index(
        'ix_user_interpretations_parent_id',
        'user_interpretations',
        ['parent_id']
    )


def downgrade() -> None:
    op.drop_index('ix_user_interpretations_parent_id', table_name='user_interpretations')
    op.drop_column('user_interpretations', 'parent_id')

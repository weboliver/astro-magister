"""add user_person_id_2 to user_interpretations

Revision ID: add_user_person_id_2
Revises: c1d2e3f4a5b6
Create Date: 2026-05-20
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'add_user_person_id_2'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'user_interpretations',
        sa.Column(
            'user_person_id_2',
            sa.Integer(),
            sa.ForeignKey('user_persons.id', ondelete='CASCADE'),
            nullable=True,
        )
    )
    op.create_index(
        'ix_user_interpretations_user_person_id_2',
        'user_interpretations',
        ['user_person_id_2']
    )


def downgrade() -> None:
    op.drop_index('ix_user_interpretations_user_person_id_2', table_name='user_interpretations')
    op.drop_column('user_interpretations', 'user_person_id_2')
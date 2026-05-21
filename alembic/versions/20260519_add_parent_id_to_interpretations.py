"""add parent_id to user_interpretations

Revision ID: a1b2c3d4e5f7
Revises: 20260516_slug
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

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
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    fks = inspector.get_foreign_keys('user_interpretations')
    parent_fk = next(
        (fk for fk in fks if 'parent_id' in fk.get('constrained_columns', []) and fk.get('referred_table') == 'user_persons'),
        None,
    )
    if parent_fk and parent_fk.get('name'):
        op.drop_constraint(parent_fk['name'], 'user_interpretations', type_='foreignkey')
    indexes = [i['name'] for i in inspector.get_indexes('user_interpretations')]
    if 'ix_user_interpretations_parent_id' in indexes:
        op.drop_index('ix_user_interpretations_parent_id', table_name='user_interpretations')
    columns = [c['name'] for c in inspector.get_columns('user_interpretations')]
    if 'parent_id' in columns:
        op.drop_column('user_interpretations', 'parent_id')

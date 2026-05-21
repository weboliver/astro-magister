"""drop parent_id from user_interpretations

Revision ID: drop_parent_id
Revises: add_user_person_id_2
Create Date: 2026-05-20
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'drop_parent_id'
down_revision: Union[str, None] = 'add_user_person_id_2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_interpretations')]

    fks = inspector.get_foreign_keys('user_interpretations')
    if any(fk.get('name') == 'user_interpretations_parent_id_fkey' for fk in fks):
        op.drop_constraint('user_interpretations_parent_id_fkey', 'user_interpretations', type_='foreignkey')

    indexes = [i['name'] for i in inspector.get_indexes('user_interpretations')]
    if 'ix_user_interpretations_parent_id' in indexes:
        op.drop_index('ix_user_interpretations_parent_id', table_name='user_interpretations')

    if 'parent_id' in columns:
        op.drop_column('user_interpretations', 'parent_id')


def downgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_interpretations')]

    if 'parent_id' not in columns:
        op.add_column('user_interpretations', sa.Column(
            'parent_id',
            sa.Integer(),
            sa.ForeignKey('user_interpretations.id', ondelete='SET NULL'),
            nullable=True
        ))
    indexes = [i['name'] for i in inspector.get_indexes('user_interpretations')]
    if 'ix_user_interpretations_parent_id' not in indexes:
        op.create_index('ix_user_interpretations_parent_id', 'user_interpretations', ['parent_id'])

"""fix parent_id to self-reference user_interpretations, drop user_persons_b_id

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f7
Create Date: 2026-05-19
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_interpretations')]

    # Drop old FK to user_persons if it exists
    fks = inspector.get_foreign_keys('user_interpretations')
    has_old_fk = any(
        fk.get('name') == 'user_interpretations_parent_id_fkey'
        and fk.get('referred_table') == 'user_persons'
        for fk in fks
    )
    if has_old_fk:
        op.drop_constraint('user_interpretations_parent_id_fkey', 'user_interpretations', type_='foreignkey')

    # Create new self-referencing FK (only if it doesn't exist)
    has_self_fk = any(
        fk.get('name') == 'user_interpretations_parent_id_fkey'
        and fk.get('referred_table') == 'user_interpretations'
        for fk in fks
    )
    if not has_self_fk:
        op.create_foreign_key(
            'user_interpretations_parent_id_fkey',
            'user_interpretations',
            'user_interpretations',
            ['parent_id'],
            ['id'],
            ondelete='SET NULL',
        )

    # Drop user_persons_b_id column and index (only if they exist)
    indexes = [i['name'] for i in inspector.get_indexes('user_interpretations')]
    if 'ix_user_interpretations_user_persons_b_id' in indexes:
        op.drop_index('ix_user_interpretations_user_persons_b_id', table_name='user_interpretations')
    if 'user_persons_b_id' in columns:
        op.drop_column('user_interpretations', 'user_persons_b_id')


def downgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_interpretations')]

    if 'user_persons_b_id' not in columns:
        op.add_column('user_interpretations', sa.Column('user_persons_b_id', sa.Integer(), nullable=True))
    indexes = [i['name'] for i in inspector.get_indexes('user_interpretations')]
    if 'ix_user_interpretations_user_persons_b_id' not in indexes:
        op.create_index('ix_user_interpretations_user_persons_b_id', 'user_interpretations', ['user_persons_b_id'])

    fks = inspector.get_foreign_keys('user_interpretations')
    has_self_fk = any(
        fk.get('name') == 'user_interpretations_parent_id_fkey'
        and fk.get('referred_table') == 'user_interpretations'
        for fk in fks
    )
    if has_self_fk:
        op.drop_constraint('user_interpretations_parent_id_fkey', 'user_interpretations', type_='foreignkey')

    has_old_fk = any(
        fk.get('name') == 'user_interpretations_parent_id_fkey'
        and fk.get('referred_table') == 'user_persons'
        for fk in fks
    )
    if not has_old_fk:
        op.create_foreign_key(
            'user_interpretations_parent_id_fkey',
            'user_interpretations',
            'user_persons',
            ['parent_id'],
            ['id'],
            ondelete='SET NULL',
        )

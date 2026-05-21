"""add birth_timezone to user_persons if missing

Revision ID: add_birth_timezone_to_persons
Revises: drop_parent_id
Create Date: 2026-05-20
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision: str = 'add_birth_timezone_to_persons'
down_revision: Union[str, None] = 'drop_parent_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_persons')]
    if 'birth_timezone' not in columns:
        op.add_column('user_persons', sa.Column('birth_timezone', sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_persons')]
    if 'birth_timezone' in columns:
        op.drop_column('user_persons', 'birth_timezone')

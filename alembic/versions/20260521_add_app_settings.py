"""add app_settings table for runtime configuration

Revision ID: add_app_settings
Revises: add_birth_timezone_to_persons
Create Date: 2026-05-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'add_app_settings'
down_revision: Union[str, None] = 'add_birth_timezone_to_persons'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    tables = inspector.get_table_names()
    if 'app_settings' not in tables:
        op.create_table(
            'app_settings',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('setting_name', sa.String(), unique=True, nullable=False),
            sa.Column('setting_value', sa.String(), nullable=True),
        )


def downgrade() -> None:
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    tables = inspector.get_table_names()
    if 'app_settings' in tables:
        op.drop_table('app_settings')

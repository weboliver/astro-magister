"""add residence_timezone to user_persons

Revision ID: res_tz_to_persons
Revises: add_app_settings
Create Date: 2026-05-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'res_tz_to_persons'
down_revision: Union[str, None] = 'add_app_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_persons', sa.Column('residence_timezone', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_persons', 'residence_timezone')

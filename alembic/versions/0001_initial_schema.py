"""Initial schema — baseline for all existing and new tables.

Revision ID: 0001
Revises:
Create Date: 2026-04-29

This revision represents the complete schema as of the Alembic adoption.

For **new deployments**: run ``alembic upgrade head`` — this migration
creates all tables from scratch.

For **existing deployments** (database was managed via create_all +
_ensure_* helpers): mark the database as already at this revision
without running the SQL:

    alembic stamp 0001

Then future revisions will be applied incrementally.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # roles
    # ------------------------------------------------------------------
    op.create_table(
        "roles",
        sa.Column("role_id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("role_name", sa.Text(), nullable=True),
    )

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("username", sa.String(), unique=True, nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
    )

    # ------------------------------------------------------------------
    # user_profiles
    # ------------------------------------------------------------------
    op.create_table(
        "user_profiles",
        sa.Column("user_id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "role_id",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("birth_year", sa.Integer(), nullable=True),
        sa.Column("birth_month", sa.Integer(), nullable=True),
        sa.Column("birth_day", sa.Integer(), nullable=True),
        sa.Column("birth_hour", sa.Integer(), nullable=True),
        sa.Column("birth_minute", sa.Integer(), nullable=True),
        sa.Column("birth_second", sa.Integer(), nullable=True),
        sa.Column("birth_latitude", sa.Float(), nullable=True),
        sa.Column("birth_longitude", sa.Float(), nullable=True),
        sa.Column("birth_place", sa.Text(), nullable=True),
        sa.Column("birth_country", sa.Text(), nullable=True),
        sa.Column("birth_region", sa.Text(), nullable=True),
        sa.Column("birth_city", sa.Text(), nullable=True),
        sa.Column("birth_timezone", sa.Text(), nullable=True),
        sa.Column("residence_latitude", sa.Float(), nullable=True),
        sa.Column("residence_longitude", sa.Float(), nullable=True),
        sa.Column("residence_place", sa.Text(), nullable=True),
        sa.Column("residence_country", sa.Text(), nullable=True),
        sa.Column("residence_region", sa.Text(), nullable=True),
        sa.Column("residence_city", sa.Text(), nullable=True),
        sa.Column("residence_timezone", sa.Text(), nullable=True),
        sa.Column("isadmin", sa.Boolean(), nullable=True),
        sa.Column(
            "is_poweruser",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ------------------------------------------------------------------
    # user_persons
    # ------------------------------------------------------------------
    op.create_table(
        "user_persons",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "role_id",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("residence_country", sa.Text(), nullable=True),
        sa.Column("residence_region", sa.Text(), nullable=True),
        sa.Column("residence_city", sa.Text(), nullable=True),
        sa.Column("residence_latitude", sa.Float(), nullable=True),
        sa.Column("residence_longitude", sa.Float(), nullable=True),
        sa.Column("birth_year", sa.Integer(), nullable=True),
        sa.Column("birth_month", sa.Integer(), nullable=True),
        sa.Column("birth_day", sa.Integer(), nullable=True),
        sa.Column("birth_hour", sa.Integer(), nullable=True),
        sa.Column("birth_minute", sa.Integer(), nullable=True),
        sa.Column("birth_second", sa.Integer(), nullable=True),
        sa.Column("birth_country", sa.Text(), nullable=True),
        sa.Column("birth_region", sa.Text(), nullable=True),
        sa.Column("birth_city", sa.Text(), nullable=True),
        sa.Column("birth_latitude", sa.Float(), nullable=True),
        sa.Column("birth_longitude", sa.Float(), nullable=True),
    )

    # ------------------------------------------------------------------
    # refresh_tokens
    # ------------------------------------------------------------------
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(), unique=True, nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
    )

    # ------------------------------------------------------------------
    # auth_audit_logs
    # ------------------------------------------------------------------
    op.create_table(
        "auth_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column(
            "success",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("ip_address", sa.String(128), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ------------------------------------------------------------------
    # sections (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "sections",
        sa.Column("section_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("section_name", sa.String(255), unique=True, nullable=False),
        sa.Column("section_description", sa.Text(), nullable=True),
        sa.Column(
            "section_sort",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "section_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "wiki_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=True),
    )

    # ------------------------------------------------------------------
    # categories (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "categories",
        sa.Column("category_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("category_name", sa.String(255), nullable=False),
        sa.Column("category_description", sa.Text(), nullable=True),
        sa.Column(
            "category_sort",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "category_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "section_id",
            sa.Integer(),
            sa.ForeignKey("sections.section_id"),
            nullable=False,
        ),
        sa.Column(
            "parent_category_id",
            sa.Integer(),
            sa.ForeignKey("categories.category_id"),
            nullable=True,
        ),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=True),
    )

    # ------------------------------------------------------------------
    # entries (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "entries",
        sa.Column("entry_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("entry_name", sa.String(255), nullable=False),
        sa.Column("entry_short", sa.Text(), nullable=True),
        sa.Column("entry_content", sa.Text(), nullable=True),
        sa.Column("generate_text", sa.Text(), nullable=True),
        sa.Column(
            "ispublic",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "entry_number",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.category_id"),
            nullable=True,
        ),
        sa.Column("entry_generate", sa.Boolean(), nullable=True),
        sa.Column(
            "entry_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("entry_published", sa.Date(), nullable=True),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=True),
    )

    # ------------------------------------------------------------------
    # relations (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "relations",
        sa.Column("relation_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "entry_from_id",
            sa.Integer(),
            sa.ForeignKey("entries.entry_id"),
            nullable=False,
        ),
        sa.Column(
            "entry_to_id",
            sa.Integer(),
            sa.ForeignKey("entries.entry_id"),
            nullable=False,
        ),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ------------------------------------------------------------------
    # pages (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "pages",
        sa.Column("page_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("page_name", sa.String(100), unique=True, nullable=False),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=True),
    )

    # ------------------------------------------------------------------
    # page_content (wiki)
    # ------------------------------------------------------------------
    op.create_table(
        "page_content",
        sa.Column("page_content_id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "page_id",
            sa.Integer(),
            sa.ForeignKey("pages.page_id"),
            nullable=False,
        ),
        sa.Column(
            "entry_id",
            sa.Integer(),
            sa.ForeignKey("entries.entry_id"),
            nullable=False,
        ),
        sa.Column(
            "created",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ------------------------------------------------------------------
    # locations — country/region/city reference data
    # ------------------------------------------------------------------
    op.create_table(
        "country_names",
        sa.Column("code", sa.String(2), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
    )

    op.create_table(
        "world_admin_regions",
        sa.Column("alfa", sa.String(2), primary_key=True, nullable=False),
        sa.Column("code", sa.String(2), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
    )

    op.create_table(
        "usa_states",
        sa.Column("alfa", sa.String(2), primary_key=True, nullable=False),
        sa.Column("code", sa.String(2), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
    )

    op.create_table(
        "usa_admin_regions",
        sa.Column("alfa", sa.String(2), primary_key=True, nullable=False),
        sa.Column("state", sa.String(2), primary_key=True, nullable=False),
        sa.Column("code", sa.String(3), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
    )

    op.create_table(
        "zone_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("alfa", sa.String(2), nullable=False),
        sa.Column("zones", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
    )

    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("source_table", sa.String(16), nullable=False),
        sa.Column("cc", sa.String(2), nullable=True),
        sa.Column("ac", sa.String(3), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("region_code", sa.String(3), nullable=True),
        sa.Column("city", sa.Text(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("latitude_text", sa.String(16), nullable=True),
        sa.Column("longitude_text", sa.String(16), nullable=True),
    )


def downgrade() -> None:
    # Drop tables in reverse dependency order.
    op.drop_table("locations")
    op.drop_table("zone_entries")
    op.drop_table("usa_admin_regions")
    op.drop_table("usa_states")
    op.drop_table("world_admin_regions")
    op.drop_table("country_names")
    op.drop_table("page_content")
    op.drop_table("pages")
    op.drop_table("relations")
    op.drop_table("entries")
    op.drop_table("categories")
    op.drop_table("sections")
    op.drop_table("auth_audit_logs")
    op.drop_table("refresh_tokens")
    op.drop_table("user_persons")
    op.drop_table("user_profiles")
    op.drop_table("users")
    op.drop_table("roles")

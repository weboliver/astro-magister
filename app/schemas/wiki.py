from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

from app.services import wiki_covers
from app.services.wiki import HOME_CARD_LIMIT


# Hex colour pattern from the house form (app/routers/theme.py): format alone is not
# enough, the value must also be one of the palette presets (V5).
_HEX_COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')


class SectionBase(BaseModel):
    """Wiki section base schema."""

    section_name: str = Field(..., max_length=255)
    section_description: Optional[str] = None
    section_sort: int = 0
    section_active: bool = True
    wiki_active: bool = True


class SectionCreate(SectionBase):
    """Wiki section creation schema."""
    pass


class SectionUpdate(BaseModel):
    """Wiki section update schema."""

    section_name: Optional[str] = Field(None, max_length=255)
    section_description: Optional[str] = None
    section_sort: Optional[int] = None
    section_active: Optional[bool] = None
    wiki_active: Optional[bool] = None


class SectionOut(SectionBase):
    """Wiki section output schema."""

    section_id: int
    created: datetime
    updated: Optional[datetime] = None


class CategoryBase(BaseModel):
    """Wiki category base schema."""

    category_name: str = Field(..., max_length=255)
    category_description: Optional[str] = None
    category_sort: int = 0
    category_active: bool = True
    section_id: int
    parent_category_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    """Wiki category creation schema."""
    pass


class CategoryUpdate(BaseModel):
    """Wiki category update schema."""

    category_name: Optional[str] = Field(None, max_length=255)
    category_description: Optional[str] = None
    category_sort: Optional[int] = None
    category_active: Optional[bool] = None
    section_id: Optional[int] = None
    parent_category_id: Optional[int] = None


class CategoryOut(CategoryBase):
    """Wiki category output schema."""

    category_id: int
    created: datetime
    updated: Optional[datetime] = None


class _CoverSelectionInput(BaseModel):
    """Input-side validation of the cover selection (IMG-01, D-03, V5).

    Deliberately a mixin only for ``EntryCreate``/``EntryUpdate``: ``EntryOut`` inherits
    ``EntryBase``, and a validator there would run on every read path. A glyph or preset
    removed from the palette later must degrade to "no image", not turn every
    ``GET /wiki/entries`` carrying that entry into a validation error.
    """

    cover_glyph: Optional[str] = None
    cover_bg: Optional[str] = None
    cover_fg: Optional[str] = None

    @field_validator('cover_glyph', 'cover_bg', 'cover_fg', mode='before')
    @classmethod
    def empty_string_is_unset(cls, value):
        """Treat an empty form field as "not set" so three blank fields cannot 422."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator('cover_glyph')
    @classmethod
    def glyph_must_be_whitelisted(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if value not in wiki_covers.GLYPHS:
            raise ValueError(f'unknown cover glyph: {value!r}')
        return value

    @field_validator('cover_bg')
    @classmethod
    def bg_must_be_preset(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError(f'not a 6-digit hex colour: {value!r}')
        if wiki_covers.bg_key_for_hex(value) is None:
            raise ValueError(f'not a background preset: {value!r}')
        return value

    @field_validator('cover_fg')
    @classmethod
    def fg_must_be_preset(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError(f'not a 6-digit hex colour: {value!r}')
        if wiki_covers.fg_key_for_hex(value) is None:
            raise ValueError(f'not a glyph-colour preset: {value!r}')
        return value

    @model_validator(mode='after')
    def pair_must_be_allowed(self):
        """Reject a background/glyph pair the grouped palette does not allow."""
        if self.cover_bg and self.cover_fg:
            bg_key = wiki_covers.bg_key_for_hex(self.cover_bg)
            fg_key = wiki_covers.fg_key_for_hex(self.cover_fg)
            if bg_key is None or fg_key is None or not wiki_covers.is_allowed_pair(bg_key, fg_key):
                raise ValueError('cover_bg and cover_fg are not an allowed preset pair')
        return self


class EntryBase(BaseModel):
    """Wiki entry base schema."""

    entry_name: str = Field(..., max_length=255)
    slug: Optional[str] = Field(None, max_length=511)
    entry_short: Optional[str] = None
    entry_content: Optional[str] = None
    generate_text: Optional[str] = None
    ispublic: bool = False
    entry_number: int = 0
    category_id: Optional[int] = None
    entry_generate: Optional[bool] = None
    entry_active: bool = True
    entry_published: Optional[date] = None
    # Plain fields, no validators: EntryOut inherits them and must stay permissive.
    cover_glyph: Optional[str] = None
    cover_bg: Optional[str] = None
    cover_fg: Optional[str] = None
    # Homepage curation (HOME-04). ``home_featured`` is a plain, non-nullable ``bool``:
    # ``create_entry`` applies every key of ``model_dump()`` and a ``None`` would land in
    # a NOT NULL column, turning every ``POST /wiki/entries`` into a 500 (REVIEW finding 1).
    home_featured: bool = False
    home_order: Optional[int] = Field(None, ge=1)


_HOME_ORDER_WRITE_ERROR = (
    'home_order is set only through PUT /wiki/home-order; '
    'omit it or send null'
)


class EntryCreate(EntryBase, _CoverSelectionInput):
    """Wiki entry creation schema.

    ``home_order`` may only be omitted or ``null``: ``PUT /wiki/home-order`` is the single
    writer of positions, so the dense 1..n guarantee (D-09) cannot be bypassed here.
    """

    @field_validator('home_order', mode='before')
    @classmethod
    def home_order_is_not_writable(cls, value):
        if value is not None:
            raise ValueError(_HOME_ORDER_WRITE_ERROR)
        return value


class EntryUpdate(_CoverSelectionInput):
    """Wiki entry update schema.

    Every field is optional. The cover selection is validated like on create, with one
    extra rule enforced in the router: a payload that names only one or two of the three
    cover fields is rejected instead of being read as "remove the image".
    """

    entry_name: Optional[str] = Field(None, max_length=255)
    entry_short: Optional[str] = None
    entry_content: Optional[str] = None
    generate_text: Optional[str] = None
    ispublic: Optional[bool] = None
    entry_number: Optional[int] = None
    category_id: Optional[int] = None
    entry_generate: Optional[bool] = None
    entry_active: Optional[bool] = None
    entry_published: Optional[date] = None
    # Omitted = unchanged, ``null`` = rejected: the column is NOT NULL and "unset" would
    # be an ambiguous state (D-11 — the mark is either on or off).
    home_featured: Optional[bool] = None
    # Only ``null`` (clear the position) is accepted; positions are written exclusively
    # by ``PUT /wiki/home-order`` so no two entries can share one (D-09, REVIEW WR-01).
    # Unordered marks sort last.
    home_order: Optional[int] = Field(None, ge=1)

    @field_validator('home_order', mode='before')
    @classmethod
    def home_order_is_not_writable(cls, value):
        """Reject a concrete position with 422; ``null`` stays legal for "unmark"."""
        if value is not None:
            raise ValueError(_HOME_ORDER_WRITE_ERROR)
        return value

    @field_validator('home_featured', mode='before')
    @classmethod
    def home_featured_must_not_be_null(cls, value):
        """Reject an explicit ``home_featured: null`` with 422.

        ``mode='before'`` validators only run for fields that are present in the payload,
        so an omitted field stays "unchanged" while an explicit ``null`` is a 422.
        """
        if value is None:
            raise ValueError('home_featured must not be null; omit the field to keep its value')
        return value


class EntryOut(EntryBase):
    """Wiki entry output schema."""

    entry_id: int
    slug: Optional[str] = None
    created: datetime
    updated: Optional[datetime] = None

    @computed_field
    @property
    def cover_url(self) -> Optional[str]:
        """Server-derived cover URL — every endpoint with this model ships it.

        The URL is recomputed on each read from the stored parameters, so a client can
        neither supply a hash nor build a path, and a ``COVER_RENDER_VERSION`` bump
        changes the URL of existing entries immediately (D-07).
        """
        return wiki_covers.cover_url_for(self.cover_glyph, self.cover_bg, self.cover_fg)

    @computed_field
    @property
    def cover_alt(self) -> Optional[str]:
        """German accessible name of the cover glyph, e.g. ``'Symbol Saturn'`` (O-1/D-15).

        Derived from the whitelist (``GLYPHS``), never supplied by a client, so both
        codebases — the React app and the JavaScript-free Astro page — can use the value
        directly as ``alt``. ``None`` means the caller renders ``alt=""``.
        """
        return wiki_covers.cover_alt_for(self.cover_glyph)


class HomeOrderIn(BaseModel):
    """Payload of ``PUT /wiki/home-order`` — the full homepage order (HOME-04, D-09).

    Form errors (too many ids, duplicates) are 422 here; the set-equality check against
    the marked entries lives in the service and answers 400.
    """

    order: list[int]

    @field_validator('order')
    @classmethod
    def order_must_be_short_and_unique(cls, value: list[int]) -> list[int]:
        if len(value) > HOME_CARD_LIMIT:
            raise ValueError(f'at most {HOME_CARD_LIMIT} entries can be curated')
        if len(set(value)) != len(value):
            raise ValueError('the order must not contain duplicate entry ids')
        return value


class CoverBulkApplyIn(BaseModel):
    """Payload of ``POST /wiki/cover-bulk-apply`` — one category (IMG-07).

    ``ge=1`` rejects 0 and negative ids with a 422 before any query runs; an unknown but
    syntactically valid id answers 404 from the service.
    """

    category_id: int = Field(..., ge=1)


class HomeSelectionItemOut(BaseModel):
    """One row of the admin curation list (HOME-04, D-11).

    Carries visibility as *fields* instead of filtering: a marked entry that is private
    or inactive still appears, so the CMS can label it instead of letting it vanish.
    """

    entry_id: int
    entry_name: str
    entry_short: Optional[str] = None
    category_name: Optional[str] = None
    home_order: Optional[int] = None
    ispublic: bool
    entry_active: bool
    wiki_active: bool
    cover_url: Optional[str] = None


class BuildEntryOut(BaseModel):
    """The documented field set of ``GET /wiki/build-entries`` (SEO-12, T-39-09).

    Mirrors ``app.services.wiki.BUILD_ENTRY_FIELDS`` exactly. Anything not listed here is
    cut from the public response — ``generate_text``, ``entry_generate`` and the
    cover/curation columns stay internal.

    ``cover_url``/``cover_alt`` are plain optional fields, not computed ones: the model has
    no ``cover_glyph`` to derive from — the service projection computes both values
    (D-19 + O-1). Only these two derived values may cross the boundary, never the stored
    cover parameters.
    """

    entry_id: int
    slug: Optional[str] = None
    entry_name: str
    entry_short: Optional[str] = None
    entry_content: Optional[str] = None
    entry_number: int = 0
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    section_name: Optional[str] = None
    wiki_active: bool = False
    created: Optional[datetime] = None
    updated: Optional[datetime] = None
    cover_url: Optional[str] = None
    cover_alt: Optional[str] = None


class HomeCardOut(BaseModel):
    """One homepage card (HOME-03) — card fields only, never ``entry_content``.

    ``cover_url`` is a server value derived from the stored cover parameters (D-15: an
    entry without an image gets ``null``, no default image). ``entry_published`` is part
    of the contract for the "new" badge (HOME-06, Phase 41).

    ``section_id``/``section_name``/``category_id`` carry the values of the joined
    section/category row so the homepage can link to the filtered wiki (D-04). They are
    *values the projection must supply*, not keys this model invents: a missing optional
    field would be filled with ``None`` here without any error.
    """

    entry_id: int
    slug: Optional[str] = None
    entry_name: str
    entry_short: Optional[str] = None
    category_name: Optional[str] = None
    entry_published: Optional[date] = None
    cover_url: Optional[str] = None
    section_id: Optional[int] = Field(
        default=None,
        description='ID des Bereichs für den Filter-Link (/wiki?bereich=<id>).',
    )
    section_name: Optional[str] = Field(
        default=None,
        description='Name des Bereichs für die Meta-Zeile der Startseitenliste.',
    )
    category_id: Optional[int] = Field(
        default=None,
        description='ID der Kategorie für den Filter-Link (/wiki?kategorie=<id>).',
    )


class RelationBase(BaseModel):
    """Wiki relation base schema."""
    entry_from_id: int
    entry_to_id: int


class RelationCreate(RelationBase):
    """Wiki relation creation schema."""
    pass


class RelationUpdate(BaseModel):
    """Wiki relation update schema."""

    entry_from_id: Optional[int] = None
    entry_to_id: Optional[int] = None


class RelationOut(RelationBase):
    """Wiki relation output schema."""

    relation_id: int
    created: datetime


class PageBase(BaseModel):
    """Wiki page base schema."""

    page_name: str = Field(..., max_length=100)


class PageCreate(PageBase):
    """Wiki page creation schema."""
    pass


class PageUpdate(BaseModel):
    """Wiki page update schema."""

    page_name: Optional[str] = Field(None, max_length=100)


class PageOut(PageBase):
    """Wiki page output schema."""

    page_id: int
    created: datetime
    updated: Optional[datetime] = None


class PageContentBase(BaseModel):
    """Wiki page content base schema."""

    page_id: int
    entry_id: int


class PageContentCreate(PageContentBase):
    """Wiki page content creation schema."""
    pass


class PageContentUpdate(BaseModel):
    """Wiki page content update schema."""

    page_id: Optional[int] = None
    entry_id: Optional[int] = None


class PageContentOut(PageContentBase):
    """Wiki page content output schema."""

    page_content_id: int
    created: datetime
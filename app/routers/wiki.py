from __future__ import annotations

import functools
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.exc import IntegrityError

from app.routers.auth import require_admin_user, _get_user_from_request
from app.schemas.wiki import (
    BuildEntryOut,
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    CoverBulkApplyIn,
    EntryCreate,
    EntryOut,
    EntryUpdate,
    HomeCardOut,
    HomeOrderIn,
    HomeSelectionItemOut,
    PageContentCreate,
    PageContentOut,
    PageContentUpdate,
    PageCreate,
    PageOut,
    PageUpdate,
    RelationCreate,
    RelationOut,
    RelationUpdate,
    SectionCreate,
    SectionOut,
    SectionUpdate,
)
from app.services import wiki as wiki_service
from app.services import wiki_covers
from app.db.models.wiki import Entry as WikiEntry
from app.db.session import get_session


router = APIRouter(tags=['wiki'])
public_router = router  # kept for compatibility; all wiki routes are now public

_COVER_FIELDS = ('cover_glyph', 'cover_bg', 'cover_fg')

# Bound of the preview byte cache (T-39-13). The full set would be 23 glyphs x 50 allowed
# colour pairs x 2 variants ~ 2 300 entries (~20 MB) in each of the four uvicorn workers;
# 96 entries are ~0.8 MB and cover every tile the picker loads plus the live preview.
_PREVIEW_CACHE_MAX = 96


@functools.lru_cache(maxsize=_PREVIEW_CACHE_MAX)
def _preview_bytes(glyph: str, bg_key: str, fg_key: str, variant: str) -> bytes:
    """Render — and cache — the WebP bytes of one *validated* preview selection.

    ``functools.lru_cache`` rather than a hand-written ``OrderedDict``: this route is a plain
    ``def`` function, so Starlette runs it in a threadpool where ``move_to_end``/``popitem`` on
    a shared dict is not atomic (REVIEW finding 11). The key holds preset **keys** only, never
    raw hex from the request, so the cache cannot be filled with arbitrary values.
    """
    background = wiki_covers.bg_preset(bg_key)
    foreground = wiki_covers.fg_preset(fg_key)
    return wiki_covers.render_cover(
        glyph, background['hex'], foreground['hex'], tile=variant == 'tile'
    )



def optional_user(request: Request) -> Optional[dict]:
    """Return the session user, or ``None`` when the request is anonymous (D-14).

    D-14 needs an **optional** session: the mandatory auth dependency raises 401 and
    would break the public wiki. This is a thin wrapper around the existing private
    helper — the auth module keeps its own API unchanged.
    """
    return _get_user_from_request(request)


def _apply_cover_params(data: dict) -> dict:
    """Validate the cover selection, canonicalise it and render the image (D-08).

    The order of the branches is binding. A payload that names only one or two of the
    three cover fields is rejected *before* any ``None`` is interpreted as "remove the
    image" — otherwise ``PUT {cover_bg, cover_fg}`` (no glyph) would silently delete the
    stored cover of the entry.

    Raises:
        KeyError: for a partial selection, an unknown preset or an unallowed pair.
            The callers translate it into a 422, never into the generic 500 path.
    """
    provided = {field for field in _COVER_FIELDS if field in data}
    if not provided:
        return data

    if provided != set(_COVER_FIELDS):
        raise KeyError('cover selection must name all three fields')

    values = [data[field] for field in _COVER_FIELDS]
    if all(value is None for value in values):
        # "Remove the picture": the old file stays reachable (D-07), nothing is deleted.
        return {**data, 'cover_glyph': None, 'cover_bg': None, 'cover_fg': None}

    if any(value is None for value in values):
        raise KeyError('cover selection must not mix set and unset fields')

    bg_key = wiki_covers.bg_key_for_hex(data['cover_bg'])
    fg_key = wiki_covers.fg_key_for_hex(data['cover_fg'])
    if bg_key is None or fg_key is None:
        raise KeyError('unknown cover colour preset')

    # Preset keys, not raw hex: the palette's spelling wins, so a client sending
    # '#141b2b' stores '#141B2B'.
    params = wiki_covers.cover_params_from_keys(data['cover_glyph'], bg_key, fg_key)
    # Synchronous render: the request answers only once the file exists (D-08).
    wiki_covers.ensure_cover(params['cover_glyph'], params['cover_bg'], params['cover_fg'])
    return {**data, **params}


def _invalid_cover_selection(exc: KeyError) -> HTTPException:
    """422 for an invalid cover selection (not the generic write-error 500)."""
    return HTTPException(status_code=422, detail='Ungültige Bildauswahl')


def _handle_write_error(exc: Exception):
    """Handle database write errors and convert to appropriate HTTP exceptions.

    Args:
        exc: The exception that occurred.

    Raises:
        HTTPException: With appropriate detail message based on error type.
    """
    if isinstance(exc, IntegrityError):
        error_text = f'{exc}'.lower()
        if 'pages' in error_text and 'page_name' in error_text and 'unique' in error_text:
            raise HTTPException(status_code=400, detail='Seite existiert bereits') from exc
        raise HTTPException(status_code=400, detail='Integritätsfehler beim Speichern der Wiki-Daten') from exc
    raise HTTPException(status_code=500, detail='Could not write wiki data') from exc


@router.get('/wiki/sections', response_model=list[SectionOut])
def list_sections(active_only: bool | None = Query(default=None), wiki_active_only: bool | None = Query(default=None)):
    """List all wiki sections.

    Args:
        active_only: Filter to active sections only.
        wiki_active_only: Filter to wiki-active sections only.

    Returns:
        List of SectionOut objects.
    """
    return wiki_service.list_sections(active_only=active_only, wiki_active_only=wiki_active_only)


@router.post('/wiki/sections', response_model=SectionOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_section(payload: SectionCreate):
    """Create a new wiki section (admin only).

    Args:
        payload: SectionCreate with section data.

    Returns:
        Created SectionOut object.

    Raises:
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_section(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/sections/{section_id}', response_model=SectionOut)
def get_section(section_id: int):
    """Get a specific section by ID.

    Args:
        section_id: ID of section to retrieve.

    Returns:
        SectionOut object.

    Raises:
        HTTPException: If section not found.
    """
    row = wiki_service.get_section(section_id)
    if not row:
        raise HTTPException(status_code=404, detail='Section not found')
    return row


@router.put('/wiki/sections/{section_id}', response_model=SectionOut, dependencies=[Depends(require_admin_user)])
def update_section(section_id: int, payload: SectionUpdate):
    """Update a section (admin only).

    Args:
        section_id: ID of section to update.
        payload: SectionUpdate with fields to update.

    Returns:
        Updated SectionOut object.

    Raises:
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_section(section_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Section not found')
    return row


@router.delete('/wiki/sections/{section_id}', dependencies=[Depends(require_admin_user)])
def delete_section(section_id: int):
    """Delete a section (admin only).

    Args:
        section_id: ID of section to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If section not found.
    """
    if not wiki_service.delete_section(section_id):
        raise HTTPException(status_code=404, detail='Section not found')
    return {'status': 'ok'}


@router.get('/wiki/categories', response_model=list[CategoryOut])
def list_categories(
    section_id: int | None = Query(default=None),
    parent_category_id: int | None = Query(default=None),
    active_only: bool | None = Query(default=None),
):
    """List wiki categories with optional filters.

    Args:
        section_id: Filter by section ID.
        parent_category_id: Filter by parent category.
        active_only: Filter to active categories only.

    Returns:
        List of CategoryOut objects.
    """
    return wiki_service.list_categories(
        section_id=section_id,
        parent_category_id=parent_category_id,
        active_only=active_only,
    )


@router.post('/wiki/categories', response_model=CategoryOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_category(payload: CategoryCreate):
    """Create a new wiki category (admin only).

    Args:
        payload: CategoryCreate with category data.

    Returns:
        Created CategoryOut object.

    Raises:
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_category(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/categories/{category_id}', response_model=CategoryOut)
def get_category(category_id: int):
    """Get a specific category by ID.

    Args:
        category_id: ID of category to retrieve.

    Returns:
        CategoryOut object.

    Raises:
        HTTPException: If category not found.
    """
    row = wiki_service.get_category(category_id)
    if not row:
        raise HTTPException(status_code=404, detail='Category not found')
    return row


@router.put('/wiki/categories/{category_id}', response_model=CategoryOut, dependencies=[Depends(require_admin_user)])
def update_category(category_id: int, payload: CategoryUpdate):
    """Update a category (admin only).

    Args:
        category_id: ID of category to update.
        payload: CategoryUpdate with fields to update.

    Returns:
        Updated CategoryOut object.

    Raises:
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_category(category_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Category not found')
    return row


@router.delete('/wiki/categories/{category_id}', dependencies=[Depends(require_admin_user)])
def delete_category(category_id: int):
    """Delete a category (admin only).

    Args:
        category_id: ID of category to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If category not found.
    """
    if not wiki_service.delete_category(category_id):
        raise HTTPException(status_code=404, detail='Category not found')
    return {'status': 'ok'}


@router.get('/wiki/entries', response_model=list[EntryOut])
def list_entries(
    category_id: int | None = Query(default=None),
    section_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    active_only: bool | None = Query(default=None),
    wiki_active_only: bool | None = Query(default=None),
    ispublic: bool | None = Query(default=None),
    not_public: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Optional[dict] = Depends(optional_user),
):
    """List wiki entries with optional filters.

    Anonymous callers only see public, active entries (D-14); a session keeps the full
    view, including non-public entries. The ``limit`` ceiling stays at 100 on purpose —
    the static build uses ``/wiki/build-entries`` instead of raising it.

    Args:
        category_id: Filter by category ID.
        section_id: Filter by section ID.
        q: Search query.
        active_only: Filter to active entries only.
        wiki_active_only: Filter to wiki-active entries only.
        ispublic: Filter the ``ispublic`` column alone (``true``/``false``). Not a second
            definition of "public" — that is ``public_entry_criteria()``.
        not_public: Entries that are *not* public-and-active, i.e. invisible to anonymous
            readers; the negation of ``public_entry_criteria()``. It narrows the view and
            never widens it.
        limit: Maximum number of results to return.
        offset: Number of results to skip for pagination.
        user: Session user, ``None`` for anonymous requests.

    Returns:
        List of EntryOut objects.
    """
    return wiki_service.list_entries(
        category_id=category_id,
        section_id=section_id,
        q=q,
        active_only=active_only,
        wiki_active_only=wiki_active_only,
        ispublic=ispublic,
        not_public=not_public,
        public_only=user is None,
        limit=limit,
        offset=offset,
    )


@router.post('/wiki/entries', response_model=EntryOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_entry(payload: EntryCreate):
    """Create a new wiki entry (admin only).

    Args:
        payload: EntryCreate with entry data.

    Returns:
        Created EntryOut object.

    Raises:
        HTTPException: On write error or an invalid cover selection.
    """
    try:
        data = _apply_cover_params(payload.model_dump())
    except KeyError as exc:
        raise _invalid_cover_selection(exc) from exc
    try:
        return wiki_service.create_entry(data)
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/by-slug/{slug}', response_model=EntryOut)
def get_entry_by_slug_route(slug: str, user: Optional[dict] = Depends(optional_user)):
    """Get a wiki entry by its URL slug.

    Declared before the two-segment category/slug route on purpose: both routes carry two path
    segments after ``/wiki`` and Starlette matches in declaration order, so that handler would
    otherwise swallow this path and answer a silent 404.

    Anonymous callers get a 404 for a non-public entry (D-14); a session keeps the old view.

    Args:
        slug: Unique entry slug (``<name>-<entry_id>``).
        user: Session user, ``None`` for anonymous requests.

    Returns:
        EntryOut object.

    Raises:
        HTTPException: If no public entry carries this slug.
    """
    entry = wiki_service.get_entry_by_slug(slug, public_only=user is None)
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    return entry


@router.get('/wiki/entries/{entry_id}', response_model=EntryOut)
def get_entry(entry_id: int, user: Optional[dict] = Depends(optional_user)):
    """Get a specific entry by ID.

    Anonymous callers get a 404 for a non-public or inactive entry (D-14), exactly like
    the slug routes; a session keeps the old view.

    Args:
        entry_id: ID of entry to retrieve.
        user: Session user, ``None`` for anonymous requests.

    Returns:
        EntryOut object.

    Raises:
        HTTPException: If entry not found (or not public for an anonymous caller).
    """
    row = wiki_service.get_entry(entry_id, public_only=user is None)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.put('/wiki/entries/{entry_id}', response_model=EntryOut, dependencies=[Depends(require_admin_user)])
def update_entry(entry_id: int, payload: EntryUpdate):
    """Update an entry (admin only).

    Args:
        entry_id: ID of entry to update.
        payload: EntryUpdate with fields to update.

    Returns:
        Updated EntryOut object.

    Raises:
        HTTPException: On error, an invalid cover selection or not found.
    """
    try:
        data = _apply_cover_params(payload.model_dump(exclude_unset=True))
    except KeyError as exc:
        raise _invalid_cover_selection(exc) from exc
    try:
        row = wiki_service.update_entry(entry_id, data)
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.get('/wiki/{category_slug}/{entry_slug}', response_model=EntryOut)
def get_entry_by_slug(category_slug: str, entry_slug: str, user: Optional[dict] = Depends(optional_user)):
    """Get an entry by its category slug and entry slug.

    Anonymous callers only reach public, active entries (D-14); the category-slug check is
    unchanged.

    Args:
        category_slug: URL slug of the category.
        entry_slug: URL slug of the entry.
        user: Session user, ``None`` for anonymous requests.

    Returns:
        EntryOut object.

    Raises:
        HTTPException: If entry not found or slug mismatch.
    """
    entry = wiki_service.get_entry_by_slug(entry_slug, public_only=user is None)
    if not entry:
        raise HTTPException(status_code=404, detail='Entry not found')
    cat_name = entry.get('category_id') and wiki_service.get_category(entry.get('category_id'))
    if cat_name:
        cat_slug = re.sub(r'[^a-z0-9]+', '-', cat_name['category_name'].lower()).strip('-')
        if cat_slug != category_slug:
            raise HTTPException(status_code=404, detail='Entry not found')
    return entry


@router.post('/wiki/entries/{entry_id}/generate-text', response_model=EntryOut, dependencies=[Depends(require_admin_user)])
async def generate_entry_text(entry_id: int):
    """Generate or update entry content using AI (admin only).

    Args:
        entry_id: ID of entry to generate text for.

    Returns:
        EntryOut with generated content.

    Raises:
        HTTPException: On write error or not found.
    """
    try:
        row = await wiki_service.generate_entry_content(entry_id)
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.delete('/wiki/entries/{entry_id}', dependencies=[Depends(require_admin_user)])
def delete_entry(entry_id: int):
    """Delete an entry (admin only).

    Args:
        entry_id: ID of entry to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If entry not found.
    """
    if not wiki_service.delete_entry(entry_id):
        raise HTTPException(status_code=404, detail='Entry not found')
    return {'status': 'ok'}


@router.get('/wiki/relations', response_model=list[RelationOut])
def list_relations(entry_from_id: int | None = Query(default=None), entry_to_id: int | None = Query(default=None)):
    """List wiki relations with optional filters.

    Args:
        entry_from_id: Filter by source entry ID.
        entry_to_id: Filter by target entry ID.

    Returns:
        List of RelationOut objects.
    """
    return wiki_service.list_relations(entry_from_id=entry_from_id, entry_to_id=entry_to_id)


@router.post('/wiki/relations', response_model=RelationOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_relation(payload: RelationCreate):
    """Create a new wiki relation (admin only).

    Args:
        payload: RelationCreate with relation data.

    Returns:
        Created RelationOut object.

    Raises:
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_relation(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/relations/{relation_id}', response_model=RelationOut)
def get_relation(relation_id: int):
    """Get a specific relation by ID.

    Args:
        relation_id: ID of relation to retrieve.

    Returns:
        RelationOut object.

    Raises:
        HTTPException: If relation not found.
    """
    row = wiki_service.get_relation(relation_id)
    if not row:
        raise HTTPException(status_code=404, detail='Relation not found')
    return row


@router.put('/wiki/relations/{relation_id}', response_model=RelationOut, dependencies=[Depends(require_admin_user)])
def update_relation(relation_id: int, payload: RelationUpdate):
    """Update a relation (admin only).

    Args:
        relation_id: ID of relation to update.
        payload: RelationUpdate with fields to update.

    Returns:
        Updated RelationOut object.

    Raises:
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_relation(relation_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Relation not found')
    return row


@router.delete('/wiki/relations/{relation_id}', dependencies=[Depends(require_admin_user)])
def delete_relation(relation_id: int):
    """Delete a relation (admin only).

    Args:
        relation_id: ID of relation to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If relation not found.
    """
    if not wiki_service.delete_relation(relation_id):
        raise HTTPException(status_code=404, detail='Relation not found')
    return {'status': 'ok'}


@router.get('/wiki/pages', response_model=list[PageOut])
def list_pages():
    """List all wiki pages.

    Returns:
        List of PageOut objects.
    """
    return wiki_service.list_pages()


@router.get('/wiki/page-entries', response_model=list[EntryOut])
def list_page_entries(
    page_name: str = Query(..., min_length=1),
    user: Optional[dict] = Depends(optional_user),
):
    """List entries associated with a specific page.

    Anonymous callers (legal pages, the static wiki build) only receive public, active
    entries (D-14); a session keeps the old view.

    Args:
        page_name: Name of the page to get entries for.
        user: Session user, ``None`` for anonymous requests.

    Returns:
        List of EntryOut objects.
    """
    return wiki_service.list_page_entries(page_name, public_only=user is None)


@router.post('/wiki/pages', response_model=PageOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_page(payload: PageCreate):
    """Create a new wiki page (admin only).

    Args:
        payload: PageCreate with page data.

    Returns:
        Created PageOut object.

    Raises:
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_page(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/pages/{page_id}', response_model=PageOut)
def get_page(page_id: int):
    """Get a specific page by ID.

    Args:
        page_id: ID of page to retrieve.

    Returns:
        PageOut object.

    Raises:
        HTTPException: If page not found.
    """
    row = wiki_service.get_page(page_id)
    if not row:
        raise HTTPException(status_code=404, detail='Page not found')
    return row


@router.put('/wiki/pages/{page_id}', response_model=PageOut, dependencies=[Depends(require_admin_user)])
def update_page(page_id: int, payload: PageUpdate):
    """Update a page (admin only).

    Args:
        page_id: ID of page to update.
        payload: PageUpdate with fields to update.

    Returns:
        Updated PageOut object.

    Raises:
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_page(page_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Page not found')
    return row


@router.delete('/wiki/pages/{page_id}', dependencies=[Depends(require_admin_user)])
def delete_page(page_id: int):
    """Delete a page (admin only).

    Args:
        page_id: ID of page to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If page not found.
    """
    if not wiki_service.delete_page(page_id):
        raise HTTPException(status_code=404, detail='Page not found')
    return {'status': 'ok'}


@router.get('/wiki/page-content', response_model=list[PageContentOut])
def list_page_contents(page_id: int | None = Query(default=None), entry_id: int | None = Query(default=None)):
    """List page content entries with optional filters.

    Args:
        page_id: Filter by page ID.
        entry_id: Filter by entry ID.

    Returns:
        List of PageContentOut objects.
    """
    return wiki_service.list_page_contents(page_id=page_id, entry_id=entry_id)


@router.post('/wiki/page-content', response_model=PageContentOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_page_content(payload: PageContentCreate):
    """Create new page content (admin only).

    Args:
        payload: PageContentCreate with content data.

    Returns:
        Created PageContentOut object.

    Raises:
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_page_content(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/page-content/{page_content_id}', response_model=PageContentOut)
def get_page_content(page_content_id: int):
    """Get specific page content by ID.

    Args:
        page_content_id: ID of page content to retrieve.

    Returns:
        PageContentOut object.

    Raises:
        HTTPException: If page content not found.
    """
    row = wiki_service.get_page_content(page_content_id)
    if not row:
        raise HTTPException(status_code=404, detail='Page content not found')
    return row


@router.put('/wiki/page-content/{page_content_id}', response_model=PageContentOut, dependencies=[Depends(require_admin_user)])
def update_page_content(page_content_id: int, payload: PageContentUpdate):
    """Update page content (admin only).

    Args:
        page_content_id: ID of page content to update.
        payload: PageContentUpdate with fields to update.

    Returns:
        Updated PageContentOut object.

    Raises:
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_page_content(page_content_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Page content not found')
    return row


@router.post('/wiki/entries/refresh-slugs', response_model=dict, dependencies=[Depends(require_admin_user)])
def refresh_all_slugs():
    """Refresh slugs for all wiki entries missing them (admin only).

    Returns:
        Dict with updated count.

    Raises:
        HTTPException: On database error.
    """
    session = get_session()
    try:
        rows = session.query(WikiEntry).filter(WikiEntry.slug.is_(None)).all()
        for row in rows:
            base = re.sub(r'[^a-z0-9]+', '-', row.entry_name.lower()).strip('-')
            row.slug = f"{base}-{row.entry_id}"
            session.add(row)
        session.commit()
        return {'updated': len(rows)}
    except Exception as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        session.close()


@router.delete('/wiki/page-content/{page_content_id}', dependencies=[Depends(require_admin_user)])
def delete_page_content(page_content_id: int):
    """Delete page content (admin only).

    Args:
        page_content_id: ID of page content to delete.

    Returns:
        Dict with status 'ok'.

    Raises:
        HTTPException: If page content not found.
    """
    if not wiki_service.delete_page_content(page_content_id):
        raise HTTPException(status_code=404, detail='Page content not found')
    return {'status': 'ok'}


@router.get('/wiki/home-cards', response_model=list[HomeCardOut])
def list_home_cards(limit: int = Query(default=12, ge=1, le=12)):
    """Curated homepage cards — public (HOME-03).

    Only marked, public, active entries whose section is wiki-active and whose title is
    not a legal-page title: HOME-02 links every card to ``/astro-wiki/<slug>/``, and the
    static site builds no page for anything else (REVIEW finding 8). Card fields only —
    no ``entry_content``, no generated text. At most twelve rows; the service clamps a
    second time.

    Args:
        limit: Maximum number of cards (1..12).

    Returns:
        List of HomeCardOut objects in the curated order; unordered marks sort last.
    """
    return wiki_service.home_cards(limit=limit)


@router.get('/wiki/home-selection', response_model=list[HomeSelectionItemOut], dependencies=[Depends(require_admin_user)])
def list_home_selection():
    """Admin curation list: every marked entry, complete (HOME-04, D-11).

    Admin-only because the answer also carries private and inactive marked entries — the
    CMS labels them instead of letting them disappear silently.

    No ``limit`` parameter on purpose: an incomplete list would make the next drag & drop
    send a partial set to ``PUT /wiki/home-order`` and hand out duplicate ``home_order``
    values.

    Returns:
        List of HomeSelectionItemOut objects ordered by ``home_order`` (unordered last).
    """
    return wiki_service.home_selection()


@router.get('/wiki/build-entries', response_model=list[BuildEntryOut])
def build_entries_route():
    """Source set for the static wiki build — public, no cap (SEO-12).

    Public because ``wiki-builder`` fetches it unauthenticated (RESEARCH §G-4). The
    ``response_model`` is exactly the documented field set, so ``generate_text``,
    ``entry_generate`` and the cover/curation columns never leave the API (T-39-09).

    Returns:
        List of BuildEntryOut objects; the Astro pages apply their own section filters.
    """
    return wiki_service.build_entries()


# ── CMS cover endpoints (IMG-02, IMG-07) ────────────────────────────────────
# All four paths carry exactly **one** segment after /wiki, so none of them can be swallowed
# by the two-segment ``/wiki/{category_slug}/{entry_slug}`` route declared above — the same
# ordering reasoning as ``by-slug``, but here the path shape alone already rules it out.

@router.get('/wiki/cover-options', dependencies=[Depends(require_admin_user)])
def cover_options_route():
    """Glyph tiles, colour presets and the allowed pairs (IMG-02, V5) — admin only.

    The CMS renders what it receives: the 23 glyphen in display order (Widder … Fische, then
    Sonne … Pluto) with German names and family, the 8 background presets and the 8 symbol
    colours grouped by the backgrounds they are allowed on.

    Returns:
        Dict with ``glyphs``, ``backgrounds``, ``glyph_colors`` (each carrying
        ``allowed_for``), ``default_background`` and ``default_glyph_color``.
    """
    return wiki_covers.cover_options()


@router.get('/wiki/cover-preview', dependencies=[Depends(require_admin_user)])
def cover_preview_route(
    glyph: str = Query(...),
    bg: str = Query(...),
    fg: str = Query(...),
    variant: Literal['full', 'tile'] = Query(default='full'),
):
    """Live preview of an unsaved selection as WebP bytes — admin only (IMG-02, §F-3).

    Writes **nothing** to disk: before the save there is no file, so this is the only way to
    show the finished image. Hex values from the request never reach the renderer — they are
    mapped onto preset keys first, so a manipulated request cannot paint arbitrary colours
    (T-39-14). ``variant=tile`` returns the same composition at 200x105.

    Args:
        glyph: Glyph key from ``GET /wiki/cover-options``.
        bg: Background preset hex.
        fg: Symbol-colour preset hex.
        variant: ``full`` (400x210) or ``tile`` (200x105).

    Returns:
        Response with ``image/webp`` bytes and ``Cache-Control: private, max-age=60``.

    Raises:
        HTTPException: 422 for an unknown glyph, a hex outside the presets or a pair the
            palette does not allow.
    """
    bg_key = wiki_covers.bg_key_for_hex(bg)
    fg_key = wiki_covers.fg_key_for_hex(fg)
    if (
        glyph not in wiki_covers.GLYPHS
        or bg_key is None
        or fg_key is None
        or not wiki_covers.is_allowed_pair(bg_key, fg_key)
    ):
        raise HTTPException(status_code=422, detail='Ungültige Bildauswahl')

    data = _preview_bytes(glyph, bg_key, fg_key, variant)
    # Exactly one Cache-Control header: private (it hangs on the admin session), short-lived
    # (the answer follows query parameters, it is not content-addressed). No public/immutable.
    return Response(
        content=data,
        media_type='image/webp',
        headers={'Cache-Control': 'private, max-age=60'},
    )


@router.get('/wiki/cover-suggestion', dependencies=[Depends(require_admin_user)])
def cover_suggestion_route(
    name: str = Query(default=''),
    category_id: int | None = Query(default=None),
):
    """Deterministic glyph suggestion from title and category — admin only (IMG-07, D-04).

    Args:
        name: Entry title the editor currently shows.
        category_id: Category of the entry, if one is selected.

    Returns:
        Dict with ``glyph`` (key or ``None``) and the German ``name`` of that glyph.
    """
    category_name = None
    if category_id is not None:
        category = wiki_service.get_category(category_id)
        category_name = category['category_name'] if category else None

    glyph = wiki_covers.suggest_glyph(name, category_name)
    return {
        'glyph': glyph,
        'name': wiki_covers.GLYPHS[glyph]['name'] if glyph else None,
    }


@router.post('/wiki/cover-bulk-apply', dependencies=[Depends(require_admin_user)])
def cover_bulk_apply_route(payload: CoverBulkApplyIn):
    """Apply the suggested glyph to a category's entries without an image — admin only.

    Entries that already carry an image are never touched (D-04: no forced suggestion) and
    at most 100 rows change per call; the answer carries the counters plus the new content
    stamp, so the CMS can show the rebuild hint without a second request (D-08, D-12).

    Args:
        payload: CoverBulkApplyIn with the category id.

    Returns:
        Dict with ``checked``, ``updated``, ``skipped``, ``remaining`` and ``stamp``.

    Raises:
        HTTPException: 404 for an unknown category, 500 through the shared write-error path.
    """
    try:
        result = wiki_service.apply_cover_bulk(payload.category_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail='Category not found') from exc
    except Exception as exc:
        _handle_write_error(exc)
    return {**result, 'stamp': wiki_service.content_stamp()}


@router.put('/wiki/home-order', dependencies=[Depends(require_admin_user)])
def set_home_order_route(payload: HomeOrderIn):
    """Store the homepage order as a dense 1..n sequence (HOME-04, D-09).

    The list must name exactly the marked entries; anything else is a 400 and nothing is
    written — so the server, not CMS discipline, rules out duplicate ``home_order``
    values (REVIEW finding 9).

    Args:
        payload: HomeOrderIn with the complete order.

    Returns:
        Dict with the renumbered count and the new content stamp.

    Raises:
        HTTPException: 400 when the list does not match the marked entries.
    """
    try:
        updated = wiki_service.set_home_order(payload.order)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Ungültige Reihenfolge') from exc
    return {'updated': updated, 'stamp': wiki_service.content_stamp()}


@router.get('/wiki/content-stamp', dependencies=[Depends(require_admin_user)])
def content_stamp_route():
    """Change stamp for the CMS rebuild hint (D-12) — admin only.

    Returns:
        Dict with ``stamp`` as an ISO-8601 string, or ``None`` while no entry exists.
    """
    return {'stamp': wiki_service.content_stamp()}


@router.post('/wiki/build', dependencies=[Depends(require_admin_user)])
def trigger_astro_build():
    """Trigger an Astro build via the wiki builder service (admin only).

    Returns:
        Build result data from wiki builder.

    Raises:
        HTTPException: If build server unreachable or build fails.
    """
    import urllib.request
    import json
    try:
        req = urllib.request.Request('http://wiki-builder:9000/build', method='POST')
        with urllib.request.urlopen(req, timeout=130) as resp:
            data = json.loads(resp.read())
            return data
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f'Build server unreachable: {e}')
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
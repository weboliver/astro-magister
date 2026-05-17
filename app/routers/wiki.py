from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError

from app.routers.auth import require_admin_user
from app.schemas.wiki import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    EntryCreate,
    EntryOut,
    EntryUpdate,
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
from app.db.models.wiki import Entry as WikiEntry
from app.db.session import get_session


router = APIRouter(tags=['wiki'])
public_router = router  # kept for compatibility; all wiki routes are now public


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
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List wiki entries with optional filters.

    Args:
        category_id: Filter by category ID.
        section_id: Filter by section ID.
        q: Search query.
        active_only: Filter to active entries only.
        wiki_active_only: Filter to wiki-active entries only.
        limit: Maximum number of results to return.
        offset: Number of results to skip for pagination.

    Returns:
        List of EntryOut objects.
    """
    return wiki_service.list_entries(
        category_id=category_id,
        section_id=section_id,
        q=q,
        active_only=active_only,
        wiki_active_only=wiki_active_only,
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
        HTTPException: On write error.
    """
    try:
        return wiki_service.create_entry(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/wiki/entries/{entry_id}', response_model=EntryOut)
def get_entry(entry_id: int):
    """Get a specific entry by ID.

    Args:
        entry_id: ID of entry to retrieve.

    Returns:
        EntryOut object.

    Raises:
        HTTPException: If entry not found.
    """
    row = wiki_service.get_entry(entry_id)
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
        HTTPException: On error or not found.
    """
    try:
        row = wiki_service.update_entry(entry_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.get('/wiki/{category_slug}/{entry_slug}', response_model=EntryOut)
def get_entry_by_slug(category_slug: str, entry_slug: str):
    """Get an entry by its category slug and entry slug.

    Args:
        category_slug: URL slug of the category.
        entry_slug: URL slug of the entry.

    Returns:
        EntryOut object.

    Raises:
        HTTPException: If entry not found or slug mismatch.
    """
    entry = wiki_service.get_entry_by_slug(entry_slug)
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
def list_page_entries(page_name: str = Query(..., min_length=1)):
    """List entries associated with a specific page.

    Args:
        page_name: Name of the page to get entries for.

    Returns:
        List of EntryOut objects.
    """
    return wiki_service.list_page_entries(page_name)


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
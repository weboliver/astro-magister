from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError

from app.routers.auth import require_admin_user, require_authenticated_user
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


router = APIRouter(tags=['wiki'], dependencies=[Depends(require_authenticated_user)])
public_router = APIRouter(tags=['wiki-public'])


def _handle_write_error(exc: Exception):
    if isinstance(exc, IntegrityError):
        error_text = f'{exc}'.lower()
        if 'pages' in error_text and 'page_name' in error_text and 'unique' in error_text:
            raise HTTPException(status_code=400, detail='Seite existiert bereits') from exc
        raise HTTPException(status_code=400, detail='Integritätsfehler beim Speichern der Wiki-Daten') from exc
    raise HTTPException(status_code=500, detail='Could not write wiki data') from exc


@router.get('/auth/wiki/sections', response_model=list[SectionOut])
def list_sections(active_only: bool | None = Query(default=None), wiki_active_only: bool | None = Query(default=None)):
    return wiki_service.list_sections(active_only=active_only, wiki_active_only=wiki_active_only)


@router.post('/auth/wiki/sections', response_model=SectionOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_section(payload: SectionCreate):
    try:
        return wiki_service.create_section(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/sections/{section_id}', response_model=SectionOut)
def get_section(section_id: int):
    row = wiki_service.get_section(section_id)
    if not row:
        raise HTTPException(status_code=404, detail='Section not found')
    return row


@router.put('/auth/wiki/sections/{section_id}', response_model=SectionOut, dependencies=[Depends(require_admin_user)])
def update_section(section_id: int, payload: SectionUpdate):
    try:
        row = wiki_service.update_section(section_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Section not found')
    return row


@router.delete('/auth/wiki/sections/{section_id}', dependencies=[Depends(require_admin_user)])
def delete_section(section_id: int):
    if not wiki_service.delete_section(section_id):
        raise HTTPException(status_code=404, detail='Section not found')
    return {'status': 'ok'}


@router.get('/auth/wiki/categories', response_model=list[CategoryOut])
def list_categories(
    section_id: int | None = Query(default=None),
    parent_category_id: int | None = Query(default=None),
    active_only: bool | None = Query(default=None),
):
    return wiki_service.list_categories(
        section_id=section_id,
        parent_category_id=parent_category_id,
        active_only=active_only,
    )


@router.post('/auth/wiki/categories', response_model=CategoryOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_category(payload: CategoryCreate):
    try:
        return wiki_service.create_category(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/categories/{category_id}', response_model=CategoryOut)
def get_category(category_id: int):
    row = wiki_service.get_category(category_id)
    if not row:
        raise HTTPException(status_code=404, detail='Category not found')
    return row


@router.put('/auth/wiki/categories/{category_id}', response_model=CategoryOut, dependencies=[Depends(require_admin_user)])
def update_category(category_id: int, payload: CategoryUpdate):
    try:
        row = wiki_service.update_category(category_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Category not found')
    return row


@router.delete('/auth/wiki/categories/{category_id}', dependencies=[Depends(require_admin_user)])
def delete_category(category_id: int):
    if not wiki_service.delete_category(category_id):
        raise HTTPException(status_code=404, detail='Category not found')
    return {'status': 'ok'}


@router.get('/auth/wiki/entries', response_model=list[EntryOut])
def list_entries(
    category_id: int | None = Query(default=None),
    section_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    active_only: bool | None = Query(default=None),
    wiki_active_only: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    return wiki_service.list_entries(
        category_id=category_id,
        section_id=section_id,
        q=q,
        active_only=active_only,
        wiki_active_only=wiki_active_only,
        limit=limit,
        offset=offset,
    )


@router.post('/auth/wiki/entries', response_model=EntryOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_entry(payload: EntryCreate):
    try:
        return wiki_service.create_entry(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/entries/{entry_id}', response_model=EntryOut)
def get_entry(entry_id: int):
    row = wiki_service.get_entry(entry_id)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.put('/auth/wiki/entries/{entry_id}', response_model=EntryOut, dependencies=[Depends(require_admin_user)])
def update_entry(entry_id: int, payload: EntryUpdate):
    try:
        row = wiki_service.update_entry(entry_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.post('/auth/wiki/entries/{entry_id}/generate-text', response_model=EntryOut, dependencies=[Depends(require_admin_user)])
async def generate_entry_text(entry_id: int):
    try:
        row = await wiki_service.generate_entry_content(entry_id)
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Entry not found')
    return row


@router.delete('/auth/wiki/entries/{entry_id}', dependencies=[Depends(require_admin_user)])
def delete_entry(entry_id: int):
    if not wiki_service.delete_entry(entry_id):
        raise HTTPException(status_code=404, detail='Entry not found')
    return {'status': 'ok'}


@router.get('/auth/wiki/relations', response_model=list[RelationOut])
def list_relations(entry_from_id: int | None = Query(default=None), entry_to_id: int | None = Query(default=None)):
    return wiki_service.list_relations(entry_from_id=entry_from_id, entry_to_id=entry_to_id)


@router.post('/auth/wiki/relations', response_model=RelationOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_relation(payload: RelationCreate):
    try:
        return wiki_service.create_relation(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/relations/{relation_id}', response_model=RelationOut)
def get_relation(relation_id: int):
    row = wiki_service.get_relation(relation_id)
    if not row:
        raise HTTPException(status_code=404, detail='Relation not found')
    return row


@router.put('/auth/wiki/relations/{relation_id}', response_model=RelationOut, dependencies=[Depends(require_admin_user)])
def update_relation(relation_id: int, payload: RelationUpdate):
    try:
        row = wiki_service.update_relation(relation_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Relation not found')
    return row


@router.delete('/auth/wiki/relations/{relation_id}', dependencies=[Depends(require_admin_user)])
def delete_relation(relation_id: int):
    if not wiki_service.delete_relation(relation_id):
        raise HTTPException(status_code=404, detail='Relation not found')
    return {'status': 'ok'}


@router.get('/auth/wiki/pages', response_model=list[PageOut])
def list_pages():
    return wiki_service.list_pages()


@router.get('/auth/wiki/page-entries', response_model=list[EntryOut])
def list_page_entries(page_name: str = Query(..., min_length=1)):
    return wiki_service.list_page_entries(page_name)


@public_router.get('/wiki/page-entries', response_model=list[EntryOut])
def list_public_page_entries(page_name: str = Query(..., min_length=1)):
    rows = wiki_service.list_public_page_entries(page_name)
    if not rows:
        raise HTTPException(status_code=404, detail='Public wiki page not found')
    return rows


@router.post('/auth/wiki/pages', response_model=PageOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_page(payload: PageCreate):
    try:
        return wiki_service.create_page(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/pages/{page_id}', response_model=PageOut)
def get_page(page_id: int):
    row = wiki_service.get_page(page_id)
    if not row:
        raise HTTPException(status_code=404, detail='Page not found')
    return row


@router.put('/auth/wiki/pages/{page_id}', response_model=PageOut, dependencies=[Depends(require_admin_user)])
def update_page(page_id: int, payload: PageUpdate):
    try:
        row = wiki_service.update_page(page_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Page not found')
    return row


@router.delete('/auth/wiki/pages/{page_id}', dependencies=[Depends(require_admin_user)])
def delete_page(page_id: int):
    if not wiki_service.delete_page(page_id):
        raise HTTPException(status_code=404, detail='Page not found')
    return {'status': 'ok'}


@router.get('/auth/wiki/page-content', response_model=list[PageContentOut])
def list_page_contents(page_id: int | None = Query(default=None), entry_id: int | None = Query(default=None)):
    return wiki_service.list_page_contents(page_id=page_id, entry_id=entry_id)


@router.post('/auth/wiki/page-content', response_model=PageContentOut, status_code=201, dependencies=[Depends(require_admin_user)])
def create_page_content(payload: PageContentCreate):
    try:
        return wiki_service.create_page_content(payload.model_dump())
    except Exception as exc:
        _handle_write_error(exc)


@router.get('/auth/wiki/page-content/{page_content_id}', response_model=PageContentOut)
def get_page_content(page_content_id: int):
    row = wiki_service.get_page_content(page_content_id)
    if not row:
        raise HTTPException(status_code=404, detail='Page content not found')
    return row


@router.put('/auth/wiki/page-content/{page_content_id}', response_model=PageContentOut, dependencies=[Depends(require_admin_user)])
def update_page_content(page_content_id: int, payload: PageContentUpdate):
    try:
        row = wiki_service.update_page_content(page_content_id, payload.model_dump(exclude_unset=True))
    except Exception as exc:
        _handle_write_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail='Page content not found')
    return row


@router.delete('/auth/wiki/page-content/{page_content_id}', dependencies=[Depends(require_admin_user)])
def delete_page_content(page_content_id: int):
    if not wiki_service.delete_page_content(page_content_id):
        raise HTTPException(status_code=404, detail='Page content not found')
    return {'status': 'ok'}
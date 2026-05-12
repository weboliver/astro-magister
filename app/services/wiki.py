from __future__ import annotations

from typing import Optional
import logging
from sqlalchemy import func, or_

from app.db.models.wiki import Category, Entry, Page, PageContent, Relation, Section
from app.db.session import get_session
from app.services.perplexity import PerplexityClient

logger = logging.getLogger(__name__)


def _model_to_dict(instance) -> dict:
    return {column.name: getattr(instance, column.name) for column in instance.__table__.columns}


def _apply_changes(instance, data: dict, allowed_fields: list[str]):
    for field in allowed_fields:
        if field in data:
            setattr(instance, field, data[field])


SECTION_FIELDS = ['section_name', 'section_description', 'section_sort', 'section_active', 'wiki_active']
CATEGORY_FIELDS = ['category_name', 'category_description', 'category_sort', 'category_active', 'section_id', 'parent_category_id']
ENTRY_FIELDS = ['entry_name', 'entry_short', 'entry_content', 'generate_text', 'ispublic', 'entry_number', 'category_id', 'entry_generate', 'entry_active', 'entry_published']
RELATION_FIELDS = ['entry_from_id', 'entry_to_id']
PAGE_FIELDS = ['page_name']
PAGE_CONTENT_FIELDS = ['page_id', 'entry_id']


def _build_entry_generate_text(entry: Entry, category: Optional[Category], section: Optional[Section]) -> str:
    title = (entry.entry_name or '').strip()
    short_text = (entry.entry_short or '').strip()
    category_name = (category.category_name if category else '') or 'Unbekannt'
    section_name = (section.section_name if section else '') or 'Unbekannt'

    lines = [
        'Erstelle für eine deutschsprachige Wiki-Huber-Astrologie Seite einen Beitrag.',
        f'Titel des Beitrags: {title}',
        f'Bereich: {section_name}',
        f'Kategorie: {category_name}',
    ]
    if short_text:
        lines.append(f'Vorhandener Inhalt: {short_text}')
    lines.extend([
        'Anforderungen:',
        '- Schreibe klar, präzise und sachlich auf Deutsch.',
        '- Liefere direkt den finalen Inhalt für den Text ohne Meta-Kommentare.',
        '- Strukturiere den Text mit kurzen Abschnitten und sinnvollen Überschriften.',
        '- Berücksichtige Titel, Bereich und Kategorie im Inhalt sichtbar und konsistent.',
        '- Falls Annahmen nötig sind, wähle plausible, allgemeinverständliche Formulierungen.',
    ])
    return '\n'.join(lines)


def list_sections(active_only: Optional[bool] = None, wiki_active_only: Optional[bool] = None) -> list[dict]:
    session = get_session()
    try:
        query = session.query(Section)
        if active_only is not None:
            query = query.filter(Section.section_active == active_only)
        if wiki_active_only is not None:
            query = query.filter(Section.wiki_active == wiki_active_only)
        rows = query.order_by(Section.section_sort, Section.section_name).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_section(section_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Section).filter(Section.section_id == section_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_section(data: dict) -> dict:
    session = get_session()
    try:
        row = Section()
        _apply_changes(row, data, SECTION_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_section(section_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Section).filter(Section.section_id == section_id).first()
        if not row:
            return None
        _apply_changes(row, data, SECTION_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_section(section_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(Section).filter(Section.section_id == section_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_categories(section_id: Optional[int] = None, parent_category_id: Optional[int] = None, active_only: Optional[bool] = None) -> list[dict]:
    session = get_session()
    try:
        query = session.query(Category)
        if section_id is not None:
            query = query.filter(Category.section_id == section_id)
        if parent_category_id is not None:
            query = query.filter(Category.parent_category_id == parent_category_id)
        if active_only is not None:
            query = query.filter(Category.category_active == active_only)
        rows = query.order_by(Category.category_sort, Category.category_name).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_category(category_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Category).filter(Category.category_id == category_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_category(data: dict) -> dict:
    session = get_session()
    try:
        row = Category()
        _apply_changes(row, data, CATEGORY_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_category(category_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Category).filter(Category.category_id == category_id).first()
        if not row:
            return None
        _apply_changes(row, data, CATEGORY_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_category(category_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(Category).filter(Category.category_id == category_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_entries(
    category_id: Optional[int] = None,
    section_id: Optional[int] = None,
    q: Optional[str] = None,
    active_only: Optional[bool] = None,
    wiki_active_only: Optional[bool] = None,
    limit: Optional[int] = None,
    offset: int = 0,
) -> list[dict]:
    session = get_session()
    try:
        query = session.query(Entry)
        needs_section_join = section_id is not None or wiki_active_only is not None
        if needs_section_join:
            query = query.join(Category, Entry.category_id == Category.category_id)
            query = query.join(Section, Category.section_id == Section.section_id)
        if category_id is not None:
            query = query.filter(Entry.category_id == category_id)
        if section_id is not None:
            query = query.filter(Category.section_id == section_id)
        if wiki_active_only is not None:
            query = query.filter(Section.wiki_active == wiki_active_only)
        if q:
            needle = f"%{q.strip().lower()}%"
            query = query.filter(
                or_(
                    func.lower(Entry.entry_name).like(needle),
                    func.lower(func.coalesce(Entry.entry_short, '')).like(needle),
                    func.lower(func.coalesce(Entry.entry_content, '')).like(needle),
                )
            )
        if active_only is not None:
            query = query.filter(Entry.entry_active == active_only)
        query = query.order_by(Entry.entry_number, Entry.entry_name)
        if offset:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)
        rows = query.all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_entry(entry_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_entry(data: dict) -> dict:
    session = get_session()
    try:
        row = Entry()
        _apply_changes(row, data, ENTRY_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_entry(entry_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        if not row:
            return None
        _apply_changes(row, data, ENTRY_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def generate_entry_generate_text(entry_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        if not row:
            return None
        category = None
        section = None
        if row.category_id is not None:
            category = session.query(Category).filter(Category.category_id == row.category_id).first()
            if category:
                section = session.query(Section).filter(Section.section_id == category.section_id).first()
        row.generate_text = _build_entry_generate_text(row, category, section)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def generate_entry_content(entry_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        if not row:
            return None
        category = None
        section = None
        if row.category_id is not None:
            category = session.query(Category).filter(Category.category_id == row.category_id).first()
            if category:
                section = session.query(Section).filter(Section.section_id == category.section_id).first()

        prompt_text = (row.generate_text or '').strip()
        if not prompt_text:
            prompt_text = _build_entry_generate_text(row, category, section)
            row.generate_text = prompt_text
            session.add(row)
            session.commit()
            session.refresh(row)
    finally:
        session.close()

    perplexity_client = PerplexityClient(role_type="Fortgeschritten")
    chunks: list[str] = []
    async for chunk in perplexity_client.send_summary_stream(prompt_text, system_prompt='entry'):
        if chunk:
            chunks.append(chunk)
    generated_content = ''.join(chunks).strip()

    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        if not row:
            return None
        row.generate_text = prompt_text
        row.entry_content = generated_content or row.entry_content
        row.entry_generate = True
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_entry(entry_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(Entry).filter(Entry.entry_id == entry_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_relations(entry_from_id: Optional[int] = None, entry_to_id: Optional[int] = None) -> list[dict]:
    session = get_session()
    try:
        query = session.query(Relation)
        if entry_from_id is not None:
            query = query.filter(Relation.entry_from_id == entry_from_id)
        if entry_to_id is not None:
            query = query.filter(Relation.entry_to_id == entry_to_id)
        rows = query.order_by(Relation.relation_id).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_relation(relation_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Relation).filter(Relation.relation_id == relation_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_relation(data: dict) -> dict:
    session = get_session()
    try:
        row = Relation()
        _apply_changes(row, data, RELATION_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_relation(relation_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Relation).filter(Relation.relation_id == relation_id).first()
        if not row:
            return None
        _apply_changes(row, data, RELATION_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_relation(relation_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(Relation).filter(Relation.relation_id == relation_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_pages() -> list[dict]:
    session = get_session()
    try:
        rows = session.query(Page).order_by(Page.page_name).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_page(page_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Page).filter(Page.page_id == page_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def list_page_entries(page_name: str) -> list[dict]:
    normalized_name = (page_name or '').strip().lower()
    if not normalized_name:
        return []

    session = get_session()
    try:
        rows = (
            session.query(Entry)
            .join(PageContent, PageContent.entry_id == Entry.entry_id)
            .join(Page, Page.page_id == PageContent.page_id)
            .filter(func.lower(Page.page_name) == normalized_name)
            .order_by(Entry.entry_number, Entry.entry_name)
            .all()
        )
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()

def list_public_page_entries(page_name: str) -> list[dict]:
    normalized_name = (page_name or '').strip().lower()
    if not normalized_name:
        return []

    session = get_session()
    try:
        rows = (
            session.query(Entry)
            .join(PageContent, PageContent.entry_id == Entry.entry_id)
            .join(Page, Page.page_id == PageContent.page_id)
            .filter(func.lower(Page.page_name) == normalized_name)
            .filter(Entry.ispublic == True)
            .order_by(Entry.entry_number, Entry.entry_name)
            .all()
        )
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def create_page(data: dict) -> dict:
    session = get_session()
    try:
        row = Page()
        _apply_changes(row, data, PAGE_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_page(page_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(Page).filter(Page.page_id == page_id).first()
        if not row:
            return None
        _apply_changes(row, data, PAGE_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_page(page_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(Page).filter(Page.page_id == page_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_page_contents(page_id: Optional[int] = None, entry_id: Optional[int] = None) -> list[dict]:
    session = get_session()
    try:
        query = session.query(PageContent)
        if page_id is not None:
            query = query.filter(PageContent.page_id == page_id)
        if entry_id is not None:
            query = query.filter(PageContent.entry_id == entry_id)
        rows = query.order_by(PageContent.page_content_id).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_page_content(page_content_id: int) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(PageContent).filter(PageContent.page_content_id == page_content_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_page_content(data: dict) -> dict:
    session = get_session()
    try:
        row = PageContent()
        _apply_changes(row, data, PAGE_CONTENT_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_page_content(page_content_id: int, data: dict) -> Optional[dict]:
    session = get_session()
    try:
        row = session.query(PageContent).filter(PageContent.page_content_id == page_content_id).first()
        if not row:
            return None
        _apply_changes(row, data, PAGE_CONTENT_FIELDS)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _model_to_dict(row)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_page_content(page_content_id: int) -> bool:
    session = get_session()
    try:
        rows = session.query(PageContent).filter(PageContent.page_content_id == page_content_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()
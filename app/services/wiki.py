from __future__ import annotations

from typing import Optional
import logging
from sqlalchemy import and_, func, or_

from app.db.models.wiki import Category, Entry, Page, PageContent, Relation, Section
from app.db.session import get_session
from app.services import wiki_covers
from app.services.perplexity import PerplexityClient

logger = logging.getLogger(__name__)


import re


def _slugify(name: str, entry_id: int) -> str:
    """Create a URL-safe slug from entry name and ID.

    Args:
        name: The entry name to slugify.
        entry_id: The entry ID to append.

    Returns:
        Slug string (e.g., "my-entry-123").
    """
    base = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f"{base}-{entry_id}"


def _model_to_dict(instance) -> dict:
    """Convert a SQLAlchemy model instance to a dictionary.

    Args:
        instance: SQLAlchemy model instance.

    Returns:
        Dict with column names as keys.
    """
    d = {column.name: getattr(instance, column.name) for column in instance.__table__.columns}
    if 'slug' not in d and hasattr(instance, 'entry_name') and hasattr(instance, 'entry_id'):
        d['slug'] = _slugify(instance.entry_name, instance.entry_id)
    return d


def _apply_changes(instance, data: dict, allowed_fields: list[str]):
    """Apply changes from a dict to a model instance for allowed fields.

    Args:
        instance: SQLAlchemy model instance.
        data: Dict with fields to update.
        allowed_fields: List of field names that can be updated.
    """
    for field in allowed_fields:
        if field in data:
            setattr(instance, field, data[field])


SECTION_FIELDS = ['section_name', 'section_description', 'section_sort', 'section_active', 'wiki_active']
CATEGORY_FIELDS = ['category_name', 'category_description', 'category_sort', 'category_active', 'section_id', 'parent_category_id']
ENTRY_FIELDS = ['entry_name', 'entry_short', 'entry_content', 'generate_text', 'ispublic', 'entry_number', 'category_id', 'entry_generate', 'entry_active', 'entry_published', 'cover_glyph', 'cover_bg', 'cover_fg', 'home_featured', 'home_order']
RELATION_FIELDS = ['entry_from_id', 'entry_to_id']
PAGE_FIELDS = ['page_name']
PAGE_CONTENT_FIELDS = ['page_id', 'entry_id']

# The legal-page titles are not articles: they have no entry of their own on
# /astro-wiki/ (they are hand-written .astro pages), so every reader that links to an
# entry URL has to skip them. One set, not three (D-13, REVIEW finding 8).
PUBLIC_TITLE_EXCLUDE = {'Datenschutz', 'Impressum', 'Kontakt'}

# The homepage shows at most twelve cards (D-10): the CMS enforces it and the endpoint
# clamps to it a second time.
HOME_CARD_LIMIT = 12

# Bulk cover suggestion: how many entries one call may change (Pitfall 11, T-39-15). The cap
# limits *changes* — and with them the render load — not the candidates that get checked.
COVER_BULK_LIMIT = 100

# Exactly what the static wiki build may read from the API (SEO-12, T-39-09). Projected
# explicitly, otherwise ``_model_to_dict`` would hand every public caller all columns —
# ``generate_text``, ``entry_generate``, the cover parameters and the curation flags.
# ``created`` belongs in it because the build derives ``datePublished`` from it (D-13) —
# it is the creation stamp, not an internal column.
BUILD_ENTRY_FIELDS = (
    'entry_id',
    'slug',
    'entry_name',
    'entry_short',
    'entry_content',
    'entry_number',
    'category_id',
    'category_name',
    'section_name',
    'wiki_active',
    'created',
    'updated',
    # Derived values only (D-19 + O-1, T-39-09): the cover *parameters* stay internal, the URL
    # and the German alt text are computed by ``public_wiki_entries()``.
    'cover_url',
    'cover_alt',
)


def _build_entry_generate_text(entry: Entry, category: Optional[Category], section: Optional[Section]) -> str:
    """Build prompt text for AI content generation for an entry.

    Args:
        entry: Entry model instance.
        category: Optional Category model.
        section: Optional Section model.

    Returns:
        Prompt string for AI text generation.
    """
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
    """List wiki sections with optional filters.

    Args:
        active_only: Filter to active sections only.
        wiki_active_only: Filter to wiki-active sections only.

    Returns:
        List of section dicts.
    """
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
    """Get a section by ID.

    Args:
        section_id: The section ID to retrieve.

    Returns:
        Section dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Section).filter(Section.section_id == section_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_section(data: dict) -> dict:
    """Create a new wiki section.

    Args:
        data: Dict with section fields.

    Returns:
        Created section dict.

    Raises:
        Exception: On database error.
    """
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
    """Update a wiki section.

    Args:
        section_id: The section ID to update.
        data: Dict with fields to update.

    Returns:
        Updated section dict or None if not found.
    """
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
    """Delete a wiki section.

    Args:
        section_id: The section ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(Section).filter(Section.section_id == section_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_categories(section_id: Optional[int] = None, parent_category_id: Optional[int] = None, active_only: Optional[bool] = None) -> list[dict]:
    """List wiki categories with optional filters.

    Args:
        section_id: Filter by section ID.
        parent_category_id: Filter by parent category ID.
        active_only: Filter to active categories only.

    Returns:
        List of category dicts.
    """
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
    """Get a category by ID.

    Args:
        category_id: The category ID to retrieve.

    Returns:
        Category dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Category).filter(Category.category_id == category_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_category(data: dict) -> dict:
    """Create a new wiki category.

    Args:
        data: Dict with category fields.

    Returns:
        Created category dict.

    Raises:
        Exception: On database error.
    """
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
    """Update a wiki category.

    Args:
        category_id: The category ID to update.
        data: Dict with fields to update.

    Returns:
        Updated category dict or None if not found.
    """
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
    """Delete a wiki category.

    Args:
        category_id: The category ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(Category).filter(Category.category_id == category_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def public_entry_criteria() -> tuple:
    """The single definition of a public wiki entry (HOME-03, SEO-12).

    ``ispublic`` **and** ``entry_active``; section scoping, the legal-page titles and
    the homepage curation are composable filters the callers add. This function is the
    only place where those two columns are formulated as a filter — a second predicate
    anywhere else would recreate the four divergent truths this phase removes (D-13).
    """
    return (Entry.ispublic.is_(True), Entry.entry_active.is_(True))


def public_wiki_entries() -> list[dict]:
    """Every public, active entry with its category and section names.

    The shared base set for the sitemap, the static build and anything else that needs
    "the public wiki". Ordering is deterministic (``entry_number``, ``entry_name``);
    before this change the sitemap query had no ``ORDER BY`` at all.

    Returns:
        List of entry dicts, each extended with ``category_name``, ``section_name``,
        ``wiki_active`` (``None``/``False`` when the entry has no category or section) and
        the two derived cover values ``cover_url``/``cover_alt`` (D-19 + O-1). The cover
        *parameters* are never part of the result (T-39-09).
    """
    session = get_session()
    try:
        rows = (
            session.query(Entry, Category, Section)
            .outerjoin(Category, Entry.category_id == Category.category_id)
            .outerjoin(Section, Category.section_id == Section.section_id)
            .filter(*public_entry_criteria())
            .order_by(Entry.entry_number, Entry.entry_name)
            .all()
        )
        entries = []
        for entry, category, section in rows:
            item = _model_to_dict(entry)
            item['category_name'] = category.category_name if category else None
            item['section_name'] = section.section_name if section else None
            item['wiki_active'] = bool(section.wiki_active) if section else False
            # Derived at read time, never stored: the static build has no JavaScript to
            # derive a URL or a German accessible name (O-1).
            item['cover_url'] = wiki_covers.cover_url_for(
                entry.cover_glyph, entry.cover_bg, entry.cover_fg
            )
            item['cover_alt'] = wiki_covers.cover_alt_for(entry.cover_glyph)
            entries.append(item)
        return entries
    finally:
        session.close()


def home_cards(limit: int = HOME_CARD_LIMIT) -> list[dict]:
    """Curated cards for the homepage (HOME-03), at most ``HOME_CARD_LIMIT`` of them.

    Card fields only — no ``entry_content``, no ``generate_text``: the homepage needs a
    teaser, not the article.

    Three composable filters on top of ``public_entry_criteria()``:

    * ``home_featured`` — the mark alone is *not* enough; the entry must also be public
      and active (D-11, "marked ∧ public ∧ active").
    * ``Section.wiki_active`` and ``PUBLIC_TITLE_EXCLUDE`` — HOME-02 links every card to
      ``/astro-wiki/<slug>/``, and the static site only builds pages for wiki-active
      sections without the legal-page titles. A card without a page would be a dead
      link (REVIEW finding 8).

    Deliberately **no** condition on ``home_order``: the mark is the contract, the order
    is only its sorting. An ``IS NOT NULL`` filter would drop exactly the state an aborted
    second CMS call leaves behind (``PUT {home_featured: true}`` without the following
    ``PUT /wiki/home-order``) and silently remove the card from homepage and preview
    (D-11). Unordered marks therefore sort last via ``nulls_last()``.

    ``section_id``/``section_name``/``category_id`` are **values of the joined row**, not
    model defaults: the homepage uses them as filter links (D-04). FastAPI would fill a
    missing optional field with ``None``, so the section tuple must really be selected —
    a key-set assertion alone would stay green on a broken projection.
    """
    session = get_session()
    try:
        rows = (
            session.query(Entry, Category, Section)
            .outerjoin(Category, Entry.category_id == Category.category_id)
            .outerjoin(Section, Category.section_id == Section.section_id)
            .filter(*public_entry_criteria())
            .filter(Entry.home_featured.is_(True))
            .filter(Section.wiki_active.is_(True))
            .filter(Entry.entry_name.notin_(PUBLIC_TITLE_EXCLUDE))
            .order_by(Entry.home_order.asc().nulls_last(), Entry.entry_id)
            .limit(max(1, min(limit, HOME_CARD_LIMIT)))
            .all()
        )
        return [
            {
                'entry_id': entry.entry_id,
                'slug': entry.slug,
                'entry_name': entry.entry_name,
                'entry_short': entry.entry_short,
                'category_name': category.category_name if category else None,
                # Homepage "new" badge (HOME-06) — already part of the contract so
                # Phase 41 does not have to change HomeCardOut.
                'entry_published': entry.entry_published,
                'cover_url': wiki_covers.cover_url_for(
                    entry.cover_glyph, entry.cover_bg, entry.cover_fg
                ),
                # Filter targets for the D-04 links (/wiki?bereich=…, /wiki?kategorie=…).
                'section_id': section.section_id if section else None,
                'section_name': section.section_name if section else None,
                'category_id': category.category_id if category else None,
            }
            for entry, category, section in rows
        ]
    finally:
        session.close()


def home_selection() -> list[dict]:
    """Every marked entry, complete — the admin curation list (HOME-04, D-11).

    Filtered on ``home_featured`` only. Private or inactive entries stay in the list with
    ``ispublic``/``entry_active`` as *fields*, so the CMS can label them ("does not appear
    on the homepage") instead of letting them vanish silently (D-11).

    No ``limit`` parameter on purpose: the 100-row cap of ``/wiki/entries`` is exactly
    what made a drag & drop send a partial list to ``PUT /wiki/home-order`` and hand out
    duplicate ``home_order`` values.
    """
    session = get_session()
    try:
        rows = (
            session.query(Entry, Category, Section)
            .outerjoin(Category, Entry.category_id == Category.category_id)
            .outerjoin(Section, Category.section_id == Section.section_id)
            .filter(Entry.home_featured.is_(True))
            .order_by(Entry.home_order.asc().nulls_last(), Entry.entry_id)
            .all()
        )
        return [
            {
                'entry_id': entry.entry_id,
                'entry_name': entry.entry_name,
                'entry_short': entry.entry_short,
                'category_name': category.category_name if category else None,
                'home_order': entry.home_order,
                'ispublic': entry.ispublic,
                'entry_active': entry.entry_active,
                'wiki_active': bool(section.wiki_active) if section else False,
                'cover_url': wiki_covers.cover_url_for(
                    entry.cover_glyph, entry.cover_bg, entry.cover_fg
                ),
            }
            for entry, category, section in rows
        ]
    finally:
        session.close()


def build_entries() -> list[dict]:
    """Source set for the static wiki build (SEO-12) — no cap, no section lock.

    Every public, active entry without the legal-page titles, projected onto
    ``BUILD_ENTRY_FIELDS``. The Astro pages apply their own section/``wiki_active``
    filters; this function must not, or the legal pages would disappear from the build.

    There is no ``limit`` parameter: the 100-row cap of ``/wiki/entries`` is the article
    loss this endpoint exists to remove.
    """
    return [
        {field: row.get(field) for field in BUILD_ENTRY_FIELDS}
        for row in public_wiki_entries()
        if row['entry_name'] not in PUBLIC_TITLE_EXCLUDE
    ]


def set_home_order(entry_ids: list[int]) -> int:
    """Store the homepage order as a dense 1..n sequence (D-09).

    The list must name **exactly** the set of marked entries. Only set equality makes
    duplicate ``home_order`` values impossible on the server: a subset would leave the
    remaining marks on their old numbers, and an extra id has no mark to order.

    Args:
        entry_ids: Entry ids in the desired homepage order (at most ``HOME_CARD_LIMIT``).

    Returns:
        Number of renumbered entries.

    Raises:
        ValueError: for more than twelve ids, duplicate ids, or a set that does not match
            the marked entries exactly (unknown, unmarked, missing or additional ids).
    """
    ids = list(entry_ids)
    if len(ids) > HOME_CARD_LIMIT:
        raise ValueError(f'at most {HOME_CARD_LIMIT} entries can be curated, got {len(ids)}')
    if len(set(ids)) != len(ids):
        raise ValueError('the order must not contain duplicate entry ids')

    session = get_session()
    try:
        marked = {
            row.entry_id
            for row in session.query(Entry.entry_id).filter(Entry.home_featured.is_(True)).all()
        }
        if set(ids) != marked:
            missing = sorted(marked - set(ids))
            extra = sorted(set(ids) - marked)
            raise ValueError(
                'the order must name exactly the curated entries '
                f'(missing={missing}, extra={extra})'
            )

        for position, entry_id in enumerate(ids, start=1):
            session.query(Entry).filter(Entry.entry_id == entry_id).update({'home_order': position})
        session.commit()
        return len(ids)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def content_stamp() -> Optional[str]:
    """Newest change over *all* entries as an ISO-8601 string, or ``None`` when empty.

    Feeds the CMS rebuild hint (D-12, 39-05): the client stores the last acknowledged
    value, so the server must deliver a *value*, not a boolean.

    No ``WHERE`` clause on purpose. A filter such as ``cover_glyph IS NOT NULL OR
    home_featured`` would lose exactly the row where an image or a mark was **removed**,
    and the hint would stay silent for the change it exists for.

    ``coalesce(updated, created)`` because ``Entry.updated`` is nullable and an INSERT
    with a cover never sets it. Over-triggering (a pure text edit on a private entry moves
    the stamp too) is accepted: the hint is a reminder, not a security property, and a
    redundant hint is harmless.
    """
    session = get_session()
    try:
        value = session.query(func.max(func.coalesce(Entry.updated, Entry.created))).scalar()
    finally:
        session.close()
    return value.isoformat() if value is not None else None


def apply_cover_bulk(category_id: int, limit: int = COVER_BULK_LIMIT) -> dict:
    """Give every entry of one category without an image its suggested glyph (IMG-07, D-04).

    Only rows with ``cover_glyph IS NULL`` are candidates, so an existing image is never
    overwritten (T-39-17). An entry whose title and category produce no suggestion stays
    without an image and counts in ``skipped`` — there is no forced suggestion.

    The cap sits on ``updated``, not on the candidate query (REVIEW finding 10): the
    suggestion is a pure string function and costs nothing, while a ``LIMIT`` on the
    candidates would make every call re-check the same hundred suggestion-less rows at the
    start of a big category and never reach the hits behind them. Entries with a suggestion
    above the cap are counted in ``remaining``; a second call continues where the first
    stopped, which makes the action idempotent.

    Rendering is synchronous and **before** the ``commit`` (D-08): the request answers only
    once every file exists, and ``ensure_cover`` renders each distinct combination once — with
    the default pair at most 23 images, however many rows changed.

    Args:
        category_id: Category whose entries get a suggestion.
        limit: Maximum number of rows to change in this call (clamped to 100).

    Returns:
        Dict with ``checked``, ``updated``, ``skipped`` and ``remaining``.

    Raises:
        ValueError: when the category does not exist.
    """
    category = get_category(category_id)
    if not category:
        raise ValueError(f'category {category_id} not found')
    category_name = category['category_name']

    cap = max(0, min(int(limit), COVER_BULK_LIMIT))
    session = get_session()
    try:
        candidates = (
            session.query(Entry)
            .filter(Entry.category_id == category_id, Entry.cover_glyph.is_(None))
            .order_by(Entry.entry_id)
            .all()
        )

        updated = 0
        skipped = 0
        remaining = 0
        combinations: set[tuple[str, str, str]] = set()

        for entry in candidates:
            glyph_key = wiki_covers.suggest_glyph(entry.entry_name, category_name)
            if glyph_key is None:
                skipped += 1
                continue
            if updated >= cap:
                remaining += 1
                continue

            params = wiki_covers.cover_params_from_keys(
                glyph_key, wiki_covers.DEFAULT_BG_KEY, wiki_covers.DEFAULT_FG_KEY
            )
            entry.cover_glyph = params['cover_glyph']
            entry.cover_bg = params['cover_bg']
            entry.cover_fg = params['cover_fg']
            session.add(entry)
            updated += 1
            combinations.add((params['cover_glyph'], params['cover_bg'], params['cover_fg']))

        # One render per distinct combination, and only then the commit — the response must
        # not promise an image that is not on disk yet (D-08).
        for glyph_key, bg_hex, fg_hex in combinations:
            wiki_covers.ensure_cover(glyph_key, bg_hex, fg_hex)

        session.commit()
        return {
            'checked': len(candidates),
            'updated': updated,
            'skipped': skipped,
            'remaining': remaining,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_entries(
    category_id: Optional[int] = None,
    section_id: Optional[int] = None,
    q: Optional[str] = None,
    active_only: Optional[bool] = None,
    wiki_active_only: Optional[bool] = None,
    public_only: bool = False,
    ispublic: Optional[bool] = None,
    not_public: bool = False,
    limit: Optional[int] = None,
    offset: int = 0,
) -> list[dict]:
    """List wiki entries with optional filters.

    Args:
        category_id: Filter by category ID.
        section_id: Filter by section ID.
        q: Search query for entry name, short, or content.
        active_only: Tri-state on ``Entry.entry_active``: ``None`` applies no restriction,
            ``True`` keeps only active entries and ``False`` keeps **only inactive** ones
            (the admin tab's "Aktiv: Nein").
        wiki_active_only: Filter to wiki-active entries only.
        public_only: Apply ``public_entry_criteria()`` (D-14: anonymous readers only see
            public, active entries). Defaults to ``False`` so no existing caller silently
            changes its visibility.
        ispublic: Filter the ``ispublic`` column on its own. This is *not* a second
            definition of "public" — that lives in ``public_entry_criteria()``, which
            additionally requires ``entry_active`` (see D-13).
        not_public: Keep only entries that are *not* public **and** active — the
            complement of ``public_entry_criteria()``. It narrows, never widens: combined
            with ``public_only`` the two conditions cannot both hold, so the result is
            empty. That is intentional and covered by a test.
        limit: Maximum number of results.
        offset: Number of results to skip.

    Returns:
        List of entry dicts.
    """
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
        if public_only:
            query = query.filter(*public_entry_criteria())
        if ispublic is not None:
            query = query.filter(Entry.ispublic.is_(ispublic))
        if not_public:
            # Die Kurzwahl ist die Negation der geteilten Definition, nicht ihre
            # Nachbildung: kein zweites Tupel, keine inline formulierte Konjunktion über
            # `ispublic` und `entry_active` (D-13).
            query = query.filter(~and_(*public_entry_criteria()))
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


def get_entry(entry_id: int, public_only: bool = False) -> Optional[dict]:
    """Get an entry by ID.

    Args:
        entry_id: The entry ID to retrieve.
        public_only: Restrict the lookup to public, active entries (D-14: an anonymous
            reader must get ``None`` for a non-public entry). Defaults to ``False`` so
            internal callers keep their current view.

    Returns:
        Entry dict or None if not found.
    """
    session = get_session()
    try:
        query = session.query(Entry).filter(Entry.entry_id == entry_id)
        if public_only:
            query = query.filter(*public_entry_criteria())
        row = query.first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def _category_slugify(name: str) -> str:
    """Create a URL-safe slug from a category name.

    Args:
        name: The category name to slugify.

    Returns:
        Slug string.
    """
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def get_entry_by_slug(slug: str, public_only: bool = False) -> Optional[dict]:
    """Get an entry by its slug.

    Args:
        slug: The entry slug to look up.
        public_only: Restrict the lookup to public, active entries (D-14: an anonymous
            reader must get ``None`` for a non-public entry). Defaults to ``False`` so
            internal callers keep their current view.

    Returns:
        Entry dict or None if not found.
    """
    session = get_session()
    try:
        query = session.query(Entry).filter(Entry.slug == slug)
        if public_only:
            query = query.filter(*public_entry_criteria())
        row = query.first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_entry(data: dict) -> dict:
    """Create a new wiki entry.

    Args:
        data: Dict with entry fields.

    Returns:
        Created entry dict.

    Raises:
        Exception: On database error.
    """
    session = get_session()
    try:
        row = Entry()
        _apply_changes(row, data, ENTRY_FIELDS)
        session.add(row)
        session.flush()
        row.slug = _slugify(row.entry_name, row.entry_id)
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
    """Update a wiki entry.

    Args:
        entry_id: The entry ID to update.
        data: Dict with fields to update.

    Returns:
        Updated entry dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Entry).filter(Entry.entry_id == entry_id).first()
        if not row:
            return None
        if data.get('home_featured') is False:
            # Unmarking always drops the position, so a stale number can never collide
            # with the dense sequence ``set_home_order`` maintains (D-09).
            data = {**data, 'home_order': None}
        _apply_changes(row, data, ENTRY_FIELDS)
        if 'entry_name' in data:
            row.slug = _slugify(row.entry_name, row.entry_id)
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
    """Generate the AI prompt text for an entry.

    Args:
        entry_id: The entry ID to generate text for.

    Returns:
        Updated entry dict with generate_text field, or None if not found.
    """
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
    """Generate entry content using AI (async).

    Args:
        entry_id: The entry ID to generate content for.

    Returns:
        Updated entry dict with generated content, or None if not found.
    """
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
    """Delete a wiki entry.

    Args:
        entry_id: The entry ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(Entry).filter(Entry.entry_id == entry_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_relations(entry_from_id: Optional[int] = None, entry_to_id: Optional[int] = None) -> list[dict]:
    """List wiki relations with optional filters.

    Args:
        entry_from_id: Filter by source entry ID.
        entry_to_id: Filter by target entry ID.

    Returns:
        List of relation dicts.
    """
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
    """Get a relation by ID.

    Args:
        relation_id: The relation ID to retrieve.

    Returns:
        Relation dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Relation).filter(Relation.relation_id == relation_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_relation(data: dict) -> dict:
    """Create a new wiki relation.

    Args:
        data: Dict with relation fields.

    Returns:
        Created relation dict.

    Raises:
        Exception: On database error.
    """
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
    """Update a wiki relation.

    Args:
        relation_id: The relation ID to update.
        data: Dict with fields to update.

    Returns:
        Updated relation dict or None if not found.
    """
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
    """Delete a wiki relation.

    Args:
        relation_id: The relation ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(Relation).filter(Relation.relation_id == relation_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_pages() -> list[dict]:
    """List all wiki pages.

    Returns:
        List of page dicts ordered by name.
    """
    session = get_session()
    try:
        rows = session.query(Page).order_by(Page.page_name).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()


def get_page(page_id: int) -> Optional[dict]:
    """Get a page by ID.

    Args:
        page_id: The page ID to retrieve.

    Returns:
        Page dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(Page).filter(Page.page_id == page_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def list_page_entries(page_name: str, public_only: bool = False) -> list[dict]:
    """List entries for a specific page.

    Args:
        page_name: The page name to get entries for.
        public_only: Restrict the result to public, active entries (D-14, anonymous
            readers). Defaults to ``False`` so internal callers keep their current view.

    Returns:
        List of entry dicts for the page.
    """
    normalized_name = (page_name or '').strip().lower()
    if not normalized_name:
        return []

    session = get_session()
    try:
        query = (
            session.query(Entry)
            .join(PageContent, PageContent.entry_id == Entry.entry_id)
            .join(Page, Page.page_id == PageContent.page_id)
            .filter(func.lower(Page.page_name) == normalized_name)
        )
        if public_only:
            query = query.filter(*public_entry_criteria())
        rows = query.order_by(Entry.entry_number, Entry.entry_name).all()
        return [_model_to_dict(row) for row in rows]
    finally:
        session.close()

def create_page(data: dict) -> dict:
    """Create a new wiki page.

    Args:
        data: Dict with page fields.

    Returns:
        Created page dict.

    Raises:
        Exception: On database error.
    """
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
    """Update a wiki page.

    Args:
        page_id: The page ID to update.
        data: Dict with fields to update.

    Returns:
        Updated page dict or None if not found.
    """
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
    """Delete a wiki page.

    Args:
        page_id: The page ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(Page).filter(Page.page_id == page_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()


def list_page_contents(page_id: Optional[int] = None, entry_id: Optional[int] = None) -> list[dict]:
    """List page content entries with optional filters.

    Args:
        page_id: Filter by page ID.
        entry_id: Filter by entry ID.

    Returns:
        List of page content dicts.
    """
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
    """Get page content by ID.

    Args:
        page_content_id: The page content ID to retrieve.

    Returns:
        Page content dict or None if not found.
    """
    session = get_session()
    try:
        row = session.query(PageContent).filter(PageContent.page_content_id == page_content_id).first()
        return _model_to_dict(row) if row else None
    finally:
        session.close()


def create_page_content(data: dict) -> dict:
    """Create new page content.

    Args:
        data: Dict with page content fields.

    Returns:
        Created page content dict.

    Raises:
        Exception: On database error.
    """
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
    """Update page content.

    Args:
        page_content_id: The page content ID to update.
        data: Dict with fields to update.

    Returns:
        Updated page content dict or None if not found.
    """
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
    """Delete page content.

    Args:
        page_content_id: The page content ID to delete.

    Returns:
        True if deleted, False if not found.
    """
    session = get_session()
    try:
        rows = session.query(PageContent).filter(PageContent.page_content_id == page_content_id).delete()
        session.commit()
        return rows > 0
    finally:
        session.close()
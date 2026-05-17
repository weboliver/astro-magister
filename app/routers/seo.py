from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.db.session import get_session
from app.db.models.wiki import Entry, Category, Section
from app import config as app_config

import re


router = APIRouter(tags=['seo'])


@router.get("/sitemap.xml")
async def sitemap(request: Request):
    """Generate XML sitemap for SEO.

    Args:
        request: FastAPI Request.

    Returns:
        Response with XML sitemap content.
    """
    base_url = app_config.get_env_setting('BASE_URL') or str(request.base_url).rstrip('/')

    session = get_session()
    try:
        entries = (
            session.query(Entry, Category, Section)
            .outerjoin(Category, Entry.category_id == Category.category_id)
            .outerjoin(Section, Category.section_id == Section.section_id)
            .filter(Entry.entry_active == True)
            .all()
        )
    finally:
        session.close()

    static_urls = [
        {'loc': base_url, 'priority': '1.0', 'changefreq': 'daily'},
        {'loc': f"{base_url}/astro-wiki/", 'priority': '0.8', 'changefreq': 'weekly'},
        {'loc': f"{base_url}/astro-wiki/impressum/", 'priority': '0.5', 'changefreq': 'monthly'},
        {'loc': f"{base_url}/astro-wiki/datenschutz/", 'priority': '0.5', 'changefreq': 'monthly'},
        {'loc': f"{base_url}/astro-wiki/kontakt/", 'priority': '0.5', 'changefreq': 'monthly'},
    ]

    entry_urls = []
    hidden_titles = {'Datenschutz', 'Impressum', 'Kontakt'}
    for entry, category, section in entries:
        if not entry.ispublic:
            continue
        if entry.entry_name in hidden_titles:
            continue
        if section and section.section_name != 'Astrologie':
            continue
        entry_base = re.sub(r'[^a-z0-9]+', '-', entry.entry_name.lower()).strip('-')
        entry_slug = f"{entry_base}-{entry.entry_id}"
        entry_urls.append({
            'loc': f"{base_url}/astro-wiki/{entry_slug}/",
            'priority': '0.6',
            'changefreq': 'monthly',
            'lastmod': (entry.updated or entry.created).strftime('%Y-%m-%d') if entry.updated or entry.created else None,
        })

    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]

    for url_data in static_urls + entry_urls:
        lastmod = f"<lastmod>{url_data['lastmod']}</lastmod>" if url_data.get('lastmod') else ""
        xml_lines.append(
            f"  <url>"
            f"<loc>{url_data['loc']}</loc>"
            f"{lastmod}"
            f"<changefreq>{url_data['changefreq']}</changefreq>"
            f"<priority>{url_data['priority']}</priority>"
            f"</url>"
        )

    xml_lines.append('</urlset>')

    return Response(
        content='\n'.join(xml_lines),
        media_type='application/xml',
        headers={'Cache-Control': 'max-age=86400'},
    )
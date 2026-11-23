import re

from fastapi import APIRouter, Request
from fastapi.responses import Response

from app import config as app_config
from app.services import wiki as wiki_service


router = APIRouter(tags=['seo'])


@router.get("/sitemap.xml")
async def sitemap(request: Request):
    """Generate XML sitemap for SEO.

    The entry set is the **build set over every section**: ``wiki_active`` and a stored
    slug, on top of ``wiki_service.public_wiki_entries()`` (the shared public *and* active
    base definition, D-13), minus the legal-page titles (D-20). That is exactly the
    condition ``app/wiki/src/pages/wiki/[slug].astro`` uses to create pages, so the sitemap
    can only name URLs the static build actually has — for a second activated section just
    as for the first.

    The ``<loc>`` comes from the **stored** ``slug`` (D-19), never from a recomputation off
    ``entry_name`` + ``entry_id``: the stored slug is the address the build publishes, and
    a recomputed one could differ from it and advertise a URL that does not exist.

    ``lastmod`` per entry is ``updated`` else ``created``; the five static URLs carry none,
    because an invented date is worse than none (D-21). The whole document is computed per
    request — there is no cache layer, only the ``Cache-Control`` header below (D-22).

    Args:
        request: FastAPI Request.

    Returns:
        Response with XML sitemap content.
    """
    base_url = app_config.get_env_setting('BASE_URL') or str(request.base_url).rstrip('/')
    base_url = re.sub(r'^https?://astro-magister\.de(?=[:/]|$)', 'https://www.astro-magister.de', base_url)

    entries = wiki_service.public_wiki_entries()

    static_urls = [
        {'loc': base_url, 'priority': '1.0', 'changefreq': 'daily'},
        {'loc': f"{base_url}/astro-wiki/", 'priority': '0.8', 'changefreq': 'weekly'},
        {'loc': f"{base_url}/astro-wiki/impressum/", 'priority': '0.5', 'changefreq': 'monthly'},
        {'loc': f"{base_url}/astro-wiki/datenschutz/", 'priority': '0.5', 'changefreq': 'monthly'},
        {'loc': f"{base_url}/astro-wiki/kontakt/", 'priority': '0.5', 'changefreq': 'monthly'},
    ]

    entry_urls = []
    for entry in entries:
        # Composable filters on top of the shared base definition — never a second
        # "is public" check (the base predicate already covers public *and* active).
        if entry['entry_name'] in wiki_service.PUBLIC_TITLE_EXCLUDE:
            continue
        # The build set (D-20): a non-wiki-active section has no page in the static site,
        # and an entry without a slug has no URL. Both gates must bind here, otherwise the
        # sitemap advertises addresses the build does not contain.
        if not entry.get('wiki_active'):
            continue
        if not entry.get('slug'):
            continue
        entry_slug = entry['slug']
        updated = entry.get('updated') or entry.get('created')
        entry_urls.append({
            'loc': f"{base_url}/astro-wiki/{entry_slug}/",
            'priority': '0.6',
            'changefreq': 'monthly',
            'lastmod': updated.strftime('%Y-%m-%d') if updated else None,
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

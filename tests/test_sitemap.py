import pytest


def test_sitemap_returns_valid_xml():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.get('/sitemap.xml')
    assert resp.status_code == 200
    assert resp.headers['content-type'] == 'application/xml'
    content = resp.text
    assert content.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' in content
    assert '<loc>' in content
    assert '<priority>' in content
    assert '<changefreq>' in content


def test_sitemap_includes_static_pages():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.get('/sitemap.xml')
    assert resp.status_code == 200
    assert '/wiki' in resp.text


def test_sitemap_includes_public_entries():
    from fastapi.testclient import TestClient
    from app.main import app
    from tests.support import build_authenticated_client

    client = build_authenticated_client(TestClient(app))

    section_resp = client.post('/wiki/sections', json={'section_name': f"SitemapTest-{__import__('uuid').uuid4().hex[:8]}"})
    assert section_resp.status_code == 201
    section_id = section_resp.json()['section_id']

    cat_resp = client.post('/wiki/categories', json={
        'category_name': f"SitemapCat-{__import__('uuid').uuid4().hex[:8]}",
        'section_id': section_id,
        'category_active': True,
    })
    assert cat_resp.status_code == 201
    cat_id = cat_resp.json()['category_id']

    entry_resp = client.post('/wiki/entries', json={
        'entry_name': f"SitemapEntry-{__import__('uuid').uuid4().hex[:8]}",
        'category_id': cat_id,
        'entry_active': True,
        'ispublic': True,
    })
    assert entry_resp.status_code == 201

    sitemap_resp = client.get('/sitemap.xml')
    assert sitemap_resp.status_code == 200
    sitemap_text = sitemap_resp.text
    entry_slug = entry_resp.json()['slug']
    assert entry_slug in sitemap_text
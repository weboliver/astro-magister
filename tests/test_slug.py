import pytest
import re
import uuid
from tests.support import build_authenticated_client, grant_poweruser
from fastapi.testclient import TestClient


app = __import__('app.main', fromlist=['app']).app
client = build_authenticated_client(TestClient(app))


def _slugify(name: str, entry_id: int) -> str:
    base = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f"{base}-{entry_id}"


def _create_section(name: str = None):
    name = name or f"SlugTestSection-{uuid.uuid4().hex[:8]}"
    resp = client.post('/wiki/sections', json={'section_name': name})
    assert resp.status_code == 201, resp.text
    return resp.json()['section_id']


def _create_category(name: str, section_id: int):
    resp = client.post('/wiki/categories', json={
        'category_name': name,
        'section_id': section_id,
        'category_active': True,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()['category_id']


def _create_entry(name: str, category_id: int, ispublic: bool = True):
    resp = client.post('/wiki/entries', json={
        'entry_name': name,
        'category_id': category_id,
        'entry_active': True,
        'ispublic': ispublic,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _category_slug(name: str, category_id: int) -> str:
    import re
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


class TestSlugGeneration:
    """Integration tests for wiki entry slugs (SEO-03, SEO-05).

    These tests define the expected behavior:
    - Entry.slug field (slug = entry_name-{entry_id})
    - GET /wiki/{category_slug}/{entry_slug} returns the entry
    - Slug updates when entry_name changes
    - Special characters in names are slugified
    """

    def test_entry_gets_slug_on_creation(self):
        section_id = _create_section()
        cat_id = _create_category(f"SlugTestCat-{uuid.uuid4().hex[:8]}", section_id)
        entry = _create_entry("Mars Qualität", cat_id)
        assert 'slug' in entry, f"Entry response missing 'slug' field: {entry.keys()}"
        assert entry['slug'] == _slugify("Mars Qualität", entry['entry_id'])

    def test_entry_slug_changes_on_name_update(self):
        section_id = _create_section()
        cat_id = _create_category(f"SlugTestCat-{uuid.uuid4().hex[:8]}", section_id)
        entry = _create_entry("Sonne im Widder", cat_id)
        old_slug = entry['slug']

        resp = client.put(f"/wiki/entries/{entry['entry_id']}", json={'entry_name': 'Sonne im Stier'})
        assert resp.status_code == 200, resp.text
        updated = resp.json()
        assert 'slug' in updated, f"Entry response missing 'slug' field: {updated.keys()}"
        assert updated['slug'] == _slugify("Sonne im Stier", entry['entry_id'])
        assert updated['slug'] != old_slug

    def test_entry_lookup_by_slug_returns_entry(self):
        section_id = _create_section()
        cat_name = f"SlugTestCat-{uuid.uuid4().hex[:8]}"
        cat_id = _create_category(cat_name, section_id)
        entry = _create_entry("Pluto Konjunktion", cat_id)
        slug = entry['slug']
        cat_slug = _category_slug(cat_name, cat_id)

        resp = client.get(f"/wiki/{cat_slug}/{slug}")
        assert resp.status_code == 200, resp.text
        assert resp.json()['entry_id'] == entry['entry_id']

    def test_entry_lookup_by_slug_not_found_returns_404(self):
        resp = client.get(f"/wiki/astrologie/does-not-exist-{uuid.uuid4().hex[:8]}")
        assert resp.status_code == 404

    def test_special_characters_in_name_are_slugified(self):
        section_id = _create_section()
        cat_id = _create_category(f"SlugTestCat-{uuid.uuid4().hex[:8]}", section_id)
        entry = _create_entry("Sonne / Mond & Sterne (Astrologisch)", cat_id)
        assert 'slug' in entry, f"Entry response missing 'slug' field: {entry.keys()}"
        slug = entry['slug']
        assert '/' not in slug
        assert '&' not in slug
        assert '(' not in slug
        assert ' ' not in slug
        assert '--' not in slug
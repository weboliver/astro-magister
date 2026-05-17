from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Dict
from sqlalchemy import func

from app.db.session import get_session
from app.db.models.locations import CountryName, WorldAdminRegion, Location, UsaState
from astronex.countries import COUNTRY_TRANSLATIONS
from app.routers.auth import require_authenticated_user

router = APIRouter(tags=["locations"], dependencies=[Depends(require_authenticated_user)])

SUPPORTED_COUNTRY_LANGS = {"es": 0, "en": 1, "de": 2, "ca": 3}


def _extract_lang(request: Request, lang: str | None) -> str:
    """Extract language code from query param or Accept-Language header.

    Args:
        request: FastAPI Request to read headers.
        lang: Optional language code from query param.

    Returns:
        Language code (de, en, es, or ca).
    """
    if lang:
        value = str(lang).strip().lower()
        if value in SUPPORTED_COUNTRY_LANGS:
            return value

    header = request.headers.get('accept-language', '')
    if header:
        tokens = [t.strip().split(';', 1)[0].strip().lower() for t in header.split(',') if t.strip()]
        for token in tokens:
            base = token.split('-', 1)[0]
            if base in SUPPORTED_COUNTRY_LANGS:
                return base

    # Default for this deployment: German names.
    return 'de'


def _translate_country_name(name: str, lang: str) -> str:
    """Translate country name to requested language.

    Args:
        name: Original country name.
        lang: Target language code.

    Returns:
        Translated country name.
    """
    if not name:
        return name
    translations = COUNTRY_TRANSLATIONS.get(name)
    if not translations:
        return name
    index = SUPPORTED_COUNTRY_LANGS.get(lang, SUPPORTED_COUNTRY_LANGS['de'])
    if index < len(translations):
        return translations[index]
    return translations[0] if translations else name

@router.get('/locations/countries')
def list_countries(request: Request, lang: str = Query(None, description="Language code: de|en|es|ca")):
    """List all available countries with localized names.

    Args:
        request: FastAPI Request to detect language from headers.
        lang: Optional language code override (de|en|es|ca).

    Returns:
        List of dicts with 'name' and 'code' for each country.

    Raises:
        HTTPException: On database error.
    """
    session = get_session()
    try:
        selected_lang = _extract_lang(request, lang)
        usa_state_codes = {
            (code or '').upper()
            for (code,) in session.query(UsaState.alfa).all()
            if code
        }
        rows = session.query(CountryName).order_by(CountryName.name.asc()).all()
        countries_by_code = {}
        for row in rows:
            code = (row.code or '').upper()
            raw_name = (row.name or code).strip()
            if not code:
                continue
            # Exclude US state codes that leaked into country list (AK, DC, ...).
            if code != 'US' and code in usa_state_codes:
                continue
            # Exclude synthetic fallback entries where name equals code (e.g. "DE" as name).
            if raw_name.upper() == code:
                continue
            countries_by_code[code] = _translate_country_name(raw_name, selected_lang)

        res = [
            {'name': name, 'code': code}
            for code, name in countries_by_code.items()
        ]
        return sorted(res, key=lambda x: x['name'] or '')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@router.get('/locations/regions')
def list_regions(country: str = Query(..., description="Country code e.g. 'DE'")):
    """List regions (admin states/provinces) for a country.

    Args:
        country: Country code (e.g., 'DE', 'US', 'FR').

    Returns:
        List of dicts with 'name' and 'code' for each region.

    Raises:
        HTTPException: On missing country or database error.
    """
    session = get_session()
    try:
        if not country:
            raise HTTPException(status_code=400, detail='country required')
        country_code = str(country).upper()
        usa_state_codes = {
            (code or '').upper()
            for (code,) in session.query(UsaState.alfa).all()
            if code
        }
        # If legacy/synthetic state-code countries are passed, normalize to US.
        if country_code in usa_state_codes:
            country_code = 'US'

        rows = (
            session.query(WorldAdminRegion)
            .filter(WorldAdminRegion.alfa == country_code)
            .order_by(WorldAdminRegion.name.asc())
            .all()
        )

        country_name_row = session.query(CountryName).filter(CountryName.code == country_code).first()
        country_name_variants = set()
        if country_name_row and country_name_row.name:
            base = str(country_name_row.name).strip()
            if base:
                country_name_variants.add(base.lower())
                translated = COUNTRY_TRANSLATIONS.get(base)
                if translated:
                    for entry in translated:
                        if entry:
                            country_name_variants.add(str(entry).strip().lower())

        res = []
        for row in rows:
            name = (row.name or '').strip()
            code = (row.code or '').strip()
            if not name or not code:
                continue
            # Ignore country-level placeholders that appear as a "region".
            if code in {'00', '0'}:
                continue
            if name.lower() in country_name_variants:
                continue
            res.append({'name': name, 'code': code})
        return sorted(res, key=lambda x: x['name'] or '')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@router.get('/locations/cities')
def list_cities(country: str = Query(..., description="Country code/table name"), region: str = Query(None, description="Region code (AC)")):
    """List cities in a country, optionally filtered by region.

    Args:
        country: Country code/table name (e.g., 'DE', 'US').
        region: Optional region code to filter cities.

    Returns:
        List of dicts with 'city' and 'code' for each city.

    Raises:
        HTTPException: On missing country or database error.
    """
    session = get_session()
    try:
        if not country:
            raise HTTPException(status_code=400, detail='country required')
        country_code = str(country).upper()
        if region:
            rows = (
                session.query(Location)
                .filter(Location.country_code == country_code, Location.region_code == region)
                .order_by(func.lower(Location.city))
                .all()
            )
            res = [{'city': row.city, 'code': row.region_code} for row in rows]
            return sorted(res, key=lambda x: x['city'] or '')
        else:
            rows = (
                session.query(Location)
                .filter(Location.country_code == country_code)
                .order_by(func.lower(Location.city))
                .all()
            )
            res = [{'city': row.city, 'code': row.region_code} for row in rows]
            return sorted(res, key=lambda x: x['city'] or '')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

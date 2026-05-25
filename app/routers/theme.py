"""
Theme settings endpoints for admin per-sign color customization.

Provides GET, PUT, and POST restore endpoints for zodiac theme settings
stored as JSON blobs in the app_settings table.
All endpoints are admin-only via require_admin_user.
"""

import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.db.models.settings import AppSetting
from app.db.session import get_session
from app.routers.auth import require_admin_user

router = APIRouter(prefix="/auth/admin", tags=["theme"])
public_router = APIRouter(prefix="/theme", tags=["theme-public"])

# ── Default theme values (matches ZODIAC_DEFAULTS from zodiacColors.js) ──
# Each sign has exactly 4 editable color fields: accent, panel, accentSoft, shadow.
# bodyGradient is NOT stored — always sourced from the frontend defaults.
_THEME_DEFAULTS = {
    0: {  # Aries — Fire
        "accent": "#8B1A1A",
        "panel": "#FEF5F5",
        "accentSoft": "#FDE8E8",
        "shadow": "0 18px 40px rgba(139,26,26,0.10)",
    },
    1: {  # Taurus — Earth
        "accent": "#7A5C2C",
        "panel": "#F8F5F0",
        "accentSoft": "#F0EBE0",
        "shadow": "0 18px 40px rgba(122,92,44,0.10)",
    },
    2: {  # Gemini — Air
        "accent": "#5A7A2C",
        "panel": "#F6F9F0",
        "accentSoft": "#ECF2E0",
        "shadow": "0 18px 40px rgba(90,122,44,0.10)",
    },
    3: {  # Cancer — Water
        "accent": "#4A6FA5",
        "panel": "#F5F8FC",
        "accentSoft": "#E8F0F8",
        "shadow": "0 18px 40px rgba(74,111,165,0.10)",
    },
    4: {  # Leo — Fire
        "accent": "#B84C2B",
        "panel": "#FEF9F5",
        "accentSoft": "#FDEEE6",
        "shadow": "0 18px 40px rgba(184,76,43,0.10)",
    },
    5: {  # Virgo — Earth
        "accent": "#6B5B3D",
        "panel": "#F6F3ED",
        "accentSoft": "#EDE8DE",
        "shadow": "0 18px 40px rgba(107,91,61,0.10)",
    },
    6: {  # Libra — Air
        "accent": "#7A8B6A",
        "panel": "#F5F7F2",
        "accentSoft": "#EAEFE5",
        "shadow": "0 18px 40px rgba(122,139,106,0.10)",
    },
    7: {  # Scorpio — Water
        "accent": "#2C3E6B",
        "panel": "#F0F3F8",
        "accentSoft": "#E0E6F2",
        "shadow": "0 18px 40px rgba(44,62,107,0.10)",
    },
    8: {  # Sagittarius — Fire
        "accent": "#6C3483",
        "panel": "#FBF5FE",
        "accentSoft": "#F5E8FA",
        "shadow": "0 18px 40px rgba(108,52,131,0.10)",
    },
    9: {  # Capricorn — Earth
        "accent": "#4A4238",
        "panel": "#F0EDE8",
        "accentSoft": "#E5E0D8",
        "shadow": "0 18px 40px rgba(74,66,56,0.10)",
    },
    10: {  # Aquarius — Air
        "accent": "#1A6B6B",
        "panel": "#F0F8F8",
        "accentSoft": "#E0F2F2",
        "shadow": "0 18px 40px rgba(26,107,107,0.10)",
    },
    11: {  # Pisces — Water
        "accent": "#1A6B5A",
        "panel": "#F0F8F5",
        "accentSoft": "#E0F2EC",
        "shadow": "0 18px 40px rgba(26,107,90,0.10)",
    },
}

# Required field names in each sign's palette
_REQUIRED_FIELDS = {"accent", "panel", "accentSoft", "shadow"}

# Hex color validation regex (6-char hex)
import re as _re
_HEX_COLOR_RE = _re.compile(r"^#[0-9a-fA-F]{6}$")


def _get_default_theme():
    """Return a deep copy of the default 12-sign theme."""
    return json.loads(json.dumps(_THEME_DEFAULTS))


def _validate_theme_payload(data):
    """Validate a theme dict.

    Must have exactly 12 keys (0-11 or "0"-"11"), each with exactly 4
    color fields. Raises HTTPException(422) on failure.

    Accepts both int keys (direct Python dict) and string keys (from json.loads).
    """
    # Normalize keys to int
    try:
        normalized = {int(k): v for k, v in data.items()}
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="Theme-Daten müssen numerische Schlüssel (0-11) für jedes Sternzeichen enthalten.",
        )

    # Must have exactly 12 keys
    if len(normalized) != 12:
        raise HTTPException(
            status_code=422,
            detail="Theme muss exakt 12 Einträge enthalten (ein Eintrag pro Sternzeichen).",
        )

    # Check all 12 sign indices are present
    for i in range(12):
        if i not in normalized:
            raise HTTPException(
                status_code=422,
                detail=f"Sternzeichen {i} fehlt in den Theme-Daten.",
            )

    # Validate each sign's palette
    for sign_idx, palette in normalized.items():
        if not isinstance(palette, dict):
            raise HTTPException(
                status_code=422,
                detail=f"Sternzeichen {sign_idx}: Farbwerte müssen ein Objekt sein.",
            )

        if set(palette.keys()) != _REQUIRED_FIELDS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Sternzeichen {sign_idx}: Farbobjekt muss exakt 4 Felder enthalten: "
                    f"accent, panel, accentSoft, shadow."
                ),
            )

        # Validate hex color fields
        for field in ["accent", "panel", "accentSoft"]:
            value = palette.get(field, "")
            if not isinstance(value, str) or not _HEX_COLOR_RE.match(value):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Sternzeichen {sign_idx}: '{field}' muss ein gültiger Hex-Farbcode "
                        f"sein (z.B. #FF5733). Erhalten: {repr(value)}"
                    ),
                )

        # shadow must be a string
        if not isinstance(palette.get("shadow", ""), str):
            raise HTTPException(
                status_code=422,
                detail=f"Sternzeichen {sign_idx}: 'shadow' muss ein String sein.",
            )

    return normalized


@router.get("/theme-settings")
def get_theme_settings(user=Depends(require_admin_user)):
    """Get current zodiac theme settings (admin only).

    Returns the current 12-sign theme, the archived previous version
    (if any), and the theme enabled flag.
    """
    session = get_session()
    try:
        # Load active theme
        row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()
        theme = json.loads(row.setting_value) if row else _get_default_theme()

        # Load archive
        archive_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_archive"
        ).first()
        archive = json.loads(archive_row.setting_value) if archive_row else None

        # Load enabled flag
        enabled_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_enabled"
        ).first()
        if enabled_row:
            enabled = enabled_row.setting_value.lower() == "true"
        else:
            enabled = True
    finally:
        session.close()

    return {"theme": theme, "archive": archive, "enabled": enabled}


@router.put("/theme-settings")
def update_theme_settings(payload: dict, user=Depends(require_admin_user)):
    """Update zodiac theme settings (admin only).

    Archives the current theme before saving the new one.
    Expects JSON body with 'theme' (12-sign dict) and 'enabled' (boolean).
    """
    theme_data = payload.get("theme")
    if theme_data is None:
        raise HTTPException(
            status_code=422,
            detail="Request-Body muss ein 'theme'-Objekt enthalten.",
        )

    # Validate the theme payload (raises 422 on failure)
    _validate_theme_payload(theme_data)

    enabled = payload.get("enabled", True)
    archived_with_timestamp = None

    session = get_session()
    try:
        # Archive step: if current theme exists, save it to archive with timestamp
        current_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()

        if current_row and current_row.setting_value:
            try:
                archived_data = json.loads(current_row.setting_value)
                archived_data["saved_at"] = datetime.now(timezone.utc).isoformat()
                archived_json = json.dumps(archived_data)
            except json.JSONDecodeError:
                # If current value is corrupt, create minimal archive
                archived_data = {
                    "saved_at": datetime.now(timezone.utc).isoformat(),
                    "_error": "previous theme could not be decoded",
                }
                archived_json = json.dumps(archived_data)

            archived_with_timestamp = archived_data

            # Upsert archive
            archive_row = session.query(AppSetting).filter(
                AppSetting.setting_name == "zodiac_theme_archive"
            ).first()
            if archive_row:
                archive_row.setting_value = archived_json
            else:
                archive_row = AppSetting(
                    setting_name="zodiac_theme_archive",
                    setting_value=archived_json,
                )
                session.add(archive_row)

        # Save new theme
        if current_row:
            current_row.setting_value = json.dumps(theme_data)
        else:
            new_row = AppSetting(
                setting_name="zodiac_theme",
                setting_value=json.dumps(theme_data),
            )
            session.add(new_row)

        # Save enabled flag
        enabled_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_enabled"
        ).first()
        enabled_value = "true" if enabled else "false"
        if enabled_row:
            enabled_row.setting_value = enabled_value
        else:
            enabled_row = AppSetting(
                setting_name="zodiac_theme_enabled",
                setting_value=enabled_value,
            )
            session.add(enabled_row)

        session.commit()

        # Regenerate glyph PNGs with new accent colors (Phase 32)
        try:
            from app.services.glyph_renderer import regenerate_all_glyphs
            glyph_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "static", "glyphs",
            )
            accent_only = {int(k): v["accent"] for k, v in theme_data.items()}
            regenerate_all_glyphs(glyph_dir, accent_only, force=True)
        except Exception:
            # Non-fatal — theme was saved successfully, glyphs will
            # regenerate on the next glyph request
            pass

    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Theme-Einstellungen konnten nicht gespeichert werden: {e}",
        )
    finally:
        session.close()

    # Refresh glyph cache in background (non-blocking)
    from threading import Thread
    def _refresh():
        try:
            from app.routers.glyphs import refresh_glyph_cache
            refresh_glyph_cache()
        except Exception:
            pass
    Thread(target=_refresh, daemon=True).start()

    return {
        "theme": theme_data,
        "archive": archived_with_timestamp,
        "enabled": enabled,
    }


@router.post("/theme-settings/restore")
def restore_theme_settings(user=Depends(require_admin_user)):
    """Restore the previous zodiac theme version from archive (admin only).

    Copies the archive entry back to the active theme. The archive is
    preserved for potential re-restore. Returns 404 if no archive exists.
    """
    session = get_session()
    try:
        # Load archive
        archive_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_archive"
        ).first()

        if not archive_row or not archive_row.setting_value:
            raise HTTPException(
                status_code=404,
                detail="Keine vorherige Version vorhanden.",
            )

        # Parse archive
        try:
            archive_data = json.loads(archive_row.setting_value)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=404,
                detail="Keine vorherige Version vorhanden.",
            )

        # Strip saved_at from the data to restore
        restored_theme = {k: v for k, v in archive_data.items() if k != "saved_at"}

        # Validate the restored theme
        _validate_theme_payload(restored_theme)

        # Save as active theme
        theme_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()
        if theme_row:
            theme_row.setting_value = json.dumps(restored_theme)
        else:
            theme_row = AppSetting(
                setting_name="zodiac_theme",
                setting_value=json.dumps(restored_theme),
            )
            session.add(theme_row)

        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Theme konnte nicht wiederhergestellt werden: {e}",
        )
    finally:
        session.close()

    from threading import Thread
    def _refresh():
        try:
            from app.routers.glyphs import refresh_glyph_cache
            refresh_glyph_cache()
        except Exception:
            pass
    Thread(target=_refresh, daemon=True).start()

    return {
        "theme": restored_theme,
        "archive": archive_data,
        "message": "Theme wiederhergestellt.",
    }


# ── Public endpoint (no auth required) ──────────────────────────

@public_router.get("/settings")
def get_public_theme_settings():
    """Return the saved theme palette + enabled flag for the public-facing site."""
    return get_theme_settings_internal()


def get_theme_settings_internal():
    """Shared helper — returns theme, archive, enabled without auth check."""
    session = get_session()
    try:
        row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme"
        ).first()
        theme = _THEME_DEFAULTS if not (row and row.setting_value) else _parse_theme_json(row.setting_value)

        archive_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_archive"
        ).first()
        archive = None
        if archive_row and archive_row.setting_value:
            try:
                archive = json.loads(archive_row.setting_value)
            except (json.JSONDecodeError, TypeError):
                pass

        enabled_row = session.query(AppSetting).filter(
            AppSetting.setting_name == "zodiac_theme_enabled"
        ).first()
        enabled = True
        if enabled_row and enabled_row.setting_value is not None:
            enabled = enabled_row.setting_value is True or str(enabled_row.setting_value).lower() in ("true", "1")

    finally:
        session.close()

    return {"theme": theme, "archive": archive, "enabled": enabled}


def _parse_theme_json(raw: str) -> dict:
    """Parse a stored theme JSON string into an int-keyed dict of dicts."""
    parsed = json.loads(raw)
    result = {}
    for k, v in parsed.items():
        result[int(k)] = v
    return result

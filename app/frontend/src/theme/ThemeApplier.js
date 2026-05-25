/**
 * ThemeApplier.js — sign lookup and CSS variable application utility
 *
 * Phase 30: Dynamic Theme Core
 * Provides getSignIndex(date) for zodiac sign detection and
 * applyTheme(signIndex, palette) for CSS custom property application.
 * Uses direct DOM setProperty() calls — no React state, no Context provider.
 */

import { SIGN_DATE_BOUNDARIES, ZODIAC_DEFAULTS } from "./zodiacColors.js";

/**
 * Check if the admin has enabled zodiac theming.
 * Reads from localStorage (set by AdminThemeTab on save).
 * Defaults to true if not set (matches backend default).
 *
 * @returns {boolean}
 */
export function isZodiacThemeEnabled() {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('zodiacThemeEnabled');
  if (stored === null) return true;
  return stored === 'true';
}

/**
 * Determine the zodiac sign index (0-11) for a given date.
 * Uses fixed date boundaries from SIGN_DATE_BOUNDARIES.
 *
 * @param {Date} [date=new Date()] - The date to look up (defaults to now)
 * @returns {number} Sign index 0 (Aries) through 11 (Pisces)
 */
export function getSignIndex(date = new Date()) {
  const month = date.getMonth() + 1; // 0-indexed → 1-indexed
  const day = date.getDate();

  for (const boundary of SIGN_DATE_BOUNDARIES) {
    const [sm, sd] = boundary.start;
    const [em, ed] = boundary.end;
    let inRange = false;

    if (sm <= em) {
      // Normal range (e.g., Aries Mar 21 – Apr 19)
      inRange =
        (month > sm || (month === sm && day >= sd)) &&
        (month < em || (month === em && day <= ed));
    } else {
      // Year-spanning range (e.g., Capricorn Dec 22 – Jan 19)
      inRange =
        (month > sm || (month === sm && day >= sd)) ||
        (month < em || (month === em && day <= ed));
    }

    if (inRange) {
      return boundary.sign;
    }
  }

  // Fallback — should never happen with complete 12-entry coverage
  return 0;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function lightenPanel(hex) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * 0.3);
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}

function darkenPanel(hex) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c * 0.95);
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}

function buildBodyGradient(accentSoft, panel) {
  const { r, g, b } = hexToRgb(accentSoft);
  return (
    `radial-gradient(circle at top right, rgba(${r},${g},${b},0.7), transparent 28%),` +
    ` linear-gradient(180deg, ${panel} 0%, ${lightenPanel(panel)} 44%, ${darkenPanel(panel)} 100%)`
  );
}

function getSavedPalette(signIndex) {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem('zodiacTheme')
  if (!raw) return null
  try {
    const theme = JSON.parse(raw)
    const entry = theme[String(signIndex)]
    if (entry && entry.accent && entry.panel && entry.accentSoft && entry.shadow) {
      return entry
    }
  } catch (_) {
    /* ignore parse errors */
  }
  return null
}

let _themeFetchPromise = null

export function loadSavedTheme() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (localStorage.getItem('zodiacTheme')) return Promise.resolve()
  if (_themeFetchPromise) return _themeFetchPromise

  _themeFetchPromise = fetch('/theme/settings')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
    .then(data => {
      if (data && data.theme) {
        localStorage.setItem('zodiacTheme', JSON.stringify(data.theme))
        if (typeof data.enabled !== 'undefined') {
          localStorage.setItem('zodiacThemeEnabled', data.enabled ? 'true' : 'false')
        }
      }
    })
    .catch(() => { /* server unavailable */ })

  return _themeFetchPromise
}

/**
 * Apply zodiac theme colors to the document root.
 * Sets five CSS custom properties and the body background.
 * Idempotent — safe to call multiple times with the same values.
 *
 * @param {number} signIndex - Sign index 0-11
 * @param {Object} [palette] - Custom palette (defaults to ZODIAC_DEFAULTS[signIndex])
 *   palette may include optional bodyGradient; if omitted, computed from accentSoft + panel
 */
export function applyTheme(signIndex, palette) {
  const saved = !palette ? getSavedPalette(signIndex) : null
  const p = palette || saved || ZODIAC_DEFAULTS[signIndex];

  document.documentElement.style.setProperty("--admin-accent", p.accent);
  document.documentElement.style.setProperty("--admin-panel", p.panel);
  document.documentElement.style.setProperty("--admin-accent-soft", p.accentSoft);
  document.documentElement.style.setProperty("--admin-shadow", p.shadow);

  const gradient = p.bodyGradient || buildBodyGradient(p.accentSoft, p.panel);
  document.body.style.background = gradient;

  const { r, g, b } = hexToRgb(p.accent);
  document.documentElement.style.setProperty("--admin-accent-r", r);
  document.documentElement.style.setProperty("--admin-accent-g", g);
  document.documentElement.style.setProperty("--admin-accent-b", b);
}

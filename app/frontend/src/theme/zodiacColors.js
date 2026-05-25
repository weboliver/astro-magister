/**
 * zodiacColors.js — 12-sign default palette with fixed date boundaries
 *
 * Phase 30: Dynamic Theme Core
 * Provides SIGN_DATE_BOUNDARIES for sign lookup and ZODIAC_DEFAULTS for per-sign CSS variables.
 * Sign index convention: 0=Aries through 11=Pisces (consistent with zodiac_names.py).
 */

/**
 * Fixed date boundaries for zodiac sign lookup.
 * Each entry maps a date range to a sign index (0-11).
 * Months are 1-indexed (Jan=1). Boundaries are inclusive on both start and end.
 * ±1 day accuracy on cusp boundary days.
 */
export const SIGN_DATE_BOUNDARIES = [
  { start: [3, 21], end: [4, 19], sign: 0 },   // Aries:       Mar 21 – Apr 19
  { start: [4, 20], end: [5, 20], sign: 1 },   // Taurus:      Apr 20 – May 20
  { start: [5, 21], end: [6, 20], sign: 2 },   // Gemini:      May 21 – Jun 20
  { start: [6, 21], end: [7, 22], sign: 3 },   // Cancer:      Jun 21 – Jul 22
  { start: [7, 23], end: [8, 22], sign: 4 },   // Leo:         Jul 23 – Aug 22
  { start: [8, 23], end: [9, 22], sign: 5 },   // Virgo:       Aug 23 – Sep 22
  { start: [9, 23], end: [10, 22], sign: 6 },  // Libra:       Sep 23 – Oct 22
  { start: [10, 23], end: [11, 21], sign: 7 }, // Scorpio:     Oct 23 – Nov 21
  { start: [11, 22], end: [12, 21], sign: 8 }, // Sagittarius: Nov 22 – Dec 21
  { start: [12, 22], end: [1, 19], sign: 9 },  // Capricorn:   Dec 22 – Jan 19 (year-spanning)
  { start: [1, 20], end: [2, 18], sign: 10 },  // Aquarius:    Jan 20 – Feb 18
  { start: [2, 19], end: [3, 20], sign: 11 },  // Pisces:      Feb 19 – Mar 20
];

/**
 * Default zodiac color palette — one entry per sign (0-11).
 * Each entry has: accent, panel, accentSoft, shadow, body gradient.
 * Colors grouped by astrological element:
 *   Fire (0,4,8), Water (3,7,11), Air (2,6,10), Earth (1,5,9)
 */
export const ZODIAC_DEFAULTS = {
  // ── Fire Signs (reddish family) ──
  0: {
    // Aries — Mar 21 – Apr 19
    accent: "#8B1A1A",
    panel: "#FEF5F5",
    accentSoft: "#FDE8E8",
    shadow: "0 18px 40px rgba(139,26,26,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(253,232,232,0.7), transparent 28%), linear-gradient(180deg, #fef5f5 0%, #fefbfb 44%, #fdf5f5 100%)",
  },
  4: {
    // Leo — Jul 23 – Aug 22
    accent: "#B84C2B",
    panel: "#FEF9F5",
    accentSoft: "#FDEEE6",
    shadow: "0 18px 40px rgba(184,76,43,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(253,238,230,0.7), transparent 28%), linear-gradient(180deg, #fef9f5 0%, #fefbfb 44%, #fef5f5 100%)",
  },
  8: {
    // Sagittarius — Nov 22 – Dec 21
    accent: "#6C3483",
    panel: "#FBF5FE",
    accentSoft: "#F5E8FA",
    shadow: "0 18px 40px rgba(108,52,131,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(245,232,250,0.7), transparent 28%), linear-gradient(180deg, #fbf5fe 0%, #fefbfb 44%, #fef5fe 100%)",
  },

  // ── Water Signs (blueish family) ──
  3: {
    // Cancer — Jun 21 – Jul 22
    accent: "#4A6FA5",
    panel: "#F5F8FC",
    accentSoft: "#E8F0F8",
    shadow: "0 18px 40px rgba(74,111,165,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(232,240,248,0.7), transparent 28%), linear-gradient(180deg, #f5f8fc 0%, #f8fbfc 44%, #f0f4f9 100%)",
  },
  7: {
    // Scorpio — Oct 23 – Nov 21
    accent: "#2C3E6B",
    panel: "#F0F3F8",
    accentSoft: "#E0E6F2",
    shadow: "0 18px 40px rgba(44,62,107,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(224,230,242,0.7), transparent 28%), linear-gradient(180deg, #f0f3f8 0%, #f8fafc 44%, #eef2f8 100%)",
  },
  11: {
    // Pisces — Feb 19 – Mar 20
    accent: "#1A6B5A",
    panel: "#F0F8F5",
    accentSoft: "#E0F2EC",
    shadow: "0 18px 40px rgba(26,107,90,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(224,242,236,0.7), transparent 28%), linear-gradient(180deg, #f0f8f5 0%, #f8fcfb 44%, #edf5f2 100%)",
  },

  // ── Air Signs (greenish family) ──
  2: {
    // Gemini — May 21 – Jun 20
    accent: "#5A7A2C",
    panel: "#F6F9F0",
    accentSoft: "#ECF2E0",
    shadow: "0 18px 40px rgba(90,122,44,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(236,242,224,0.7), transparent 28%), linear-gradient(180deg, #f6f9f0 0%, #fbfcf8 44%, #f2f6ec 100%)",
  },
  6: {
    // Libra — Sep 23 – Oct 22
    accent: "#7A8B6A",
    panel: "#F5F7F2",
    accentSoft: "#EAEFE5",
    shadow: "0 18px 40px rgba(122,139,106,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(234,239,229,0.7), transparent 28%), linear-gradient(180deg, #f5f7f2 0%, #fbfcf9 44%, #f2f5ef 100%)",
  },
  10: {
    // Aquarius — Jan 20 – Feb 18
    accent: "#1A6B6B",
    panel: "#F0F8F8",
    accentSoft: "#E0F2F2",
    shadow: "0 18px 40px rgba(26,107,107,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(224,242,242,0.7), transparent 28%), linear-gradient(180deg, #f0f8f8 0%, #f8fcfc 44%, #edf5f5 100%)",
  },

  // ── Earth Signs (brownish family) ──
  1: {
    // Taurus — Apr 20 – May 20
    accent: "#7A5C2C",
    panel: "#F8F5F0",
    accentSoft: "#F0EBE0",
    shadow: "0 18px 40px rgba(122,92,44,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(240,235,224,0.7), transparent 28%), linear-gradient(180deg, #f8f5f0 0%, #fbfaf8 44%, #f5f2ec 100%)",
  },
  5: {
    // Virgo — Aug 23 – Sep 22
    accent: "#6B5B3D",
    panel: "#F6F3ED",
    accentSoft: "#EDE8DE",
    shadow: "0 18px 40px rgba(107,91,61,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(237,232,222,0.7), transparent 28%), linear-gradient(180deg, #f6f3ed 0%, #fbfaf7 44%, #f3f0ea 100%)",
  },
  9: {
    // Capricorn — Dec 22 – Jan 19
    accent: "#4A4238",
    panel: "#F0EDE8",
    accentSoft: "#E5E0D8",
    shadow: "0 18px 40px rgba(74,66,56,0.10)",
    bodyGradient: "radial-gradient(circle at top right, rgba(229,224,216,0.7), transparent 28%), linear-gradient(180deg, #f0ede8 0%, #faf8f5 44%, #edeae5 100%)",
  },
};

/**
 * German zodiac sign names in sign-index order (0=Aries through 11=Pisces).
 * Used by AdminThemeTab for sign card labels and the sign override dropdown.
 */
export const zodiacNames = [
  "Widder",
  "Stier",
  "Zwillinge",
  "Krebs",
  "Löwe",
  "Jungfrau",
  "Waage",
  "Skorpion",
  "Schütze",
  "Steinbock",
  "Wassermann",
  "Fische",
];

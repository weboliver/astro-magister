/**
 * covers — die eine Standardbild-URL der statischen Wiki-Codebasis (D-14).
 *
 * Quelle der Wahrheit ist `app.services.wiki_covers.default_cover_url()`: das Standardbild ist
 * keine committete Datei, sondern eine gewöhnliche Auswahl aus der Cover-Whitelist (Symbol
 * „Sonne", Hintergrund-Preset „Schiefer", Symbolfarbe „Elfenbein"). Der Dateiname ist deshalb
 * inhaltsadressiert — ein Hash über Glyph, Preset-Hex-Werte, Layout und Renderer-Version — und
 * darf ein Jahr lang `immutable` gecacht werden.
 *
 * Derselbe Wert steht in `app/frontend/src/services/covers.js`. Die Astro-Seite kann die
 * React-Datei nicht importieren, deshalb gibt es zwei Dateien mit **einem** Hash: eine Änderung
 * am Standardbild zieht beide mit. Die Bilddatei selbst liegt nie im Repo (das
 * Cover-Verzeichnis ist gitignoriert); sie entsteht beim ersten Abruf über den
 * Render-on-miss-Pfad von `/static/wiki-covers/`.
 *
 * Kein `fetch`, keine Konsole, kein Semikolon: das Modul exportiert nur die Konstante.
 *
 * @module covers
 */

/**
 * Standardbild für Einträge ohne eigenes Cover (statische Übersicht und Artikelkopf).
 * @type {string}
 */
export const DEFAULT_COVER_URL = '/static/wiki-covers/08becb2c363dbdcffec65e613dc6e409.webp'

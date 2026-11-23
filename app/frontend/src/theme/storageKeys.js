/**
 * storageKeys.js — `localStorage`-Schlüssel des Themes an einer Stelle
 *
 * Den Merker des Personenzeichens brauchen zwei Seiten mit **derselben** Zeichenkette: das
 * Anti-Flash-Skript in `index.html` (Literal, kann kein Modul importieren), `theme/personSign.js`
 * (schreiben) und `services/api.js` (löschen, sobald die Sitzung endet). `api.js` darf
 * `personSign.js` nicht importieren: der Pfad `api → personSign → ThemeApplier → api` wäre ein
 * Zyklus. Dieses Modul importiert nichts und ist deshalb von beiden Seiten gefahrlos lesbar.
 */

/**
 * Merker für das zuletzt angewandte personen- bzw. profilabgeleitete Zeichen.
 * Inhalt: `'0'` … `'11'`. Das Tageszeichen steht dort nie.
 * @type {string}
 */
export const THEME_SIGN_STORAGE_KEY = 'astronex_theme_sign'

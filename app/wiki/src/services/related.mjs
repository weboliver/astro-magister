/**
 * related — die eine „verwandt"-Regel der statischen Wiki-Codebasis (D-16).
 *
 * „Verwandt" heißt **gleiche Kategorie** (Geschwister), maximal 5, und niemals eine fremde
 * Kategorie als Auffüllung. Hat eine Kategorie keine weiteren öffentlichen Artikel, liefert
 * die Funktion eine leere Liste — die Seite lässt die Sektion dann ganz weg, statt ein leeres
 * Gerüst zu rendern.
 *
 * Die Regel steht als **reine Funktion** hier und nicht im Template, weil D-17 die Liste zur
 * Build-Zeit verlangt: `getStaticPaths()` hat bereits alle Einträge und gibt jedem Seitenaufruf
 * seine Geschwister mit. Eine reine Funktion ist ohne echte Daten prüfbar — die
 * Verifikation ruft sie mit einer synthetischen Menge auf.
 *
 * Kein `fetch`, keine Konsole, kein Semikolon: das Modul exportiert eine Funktion und
 * verändert die übergebene Menge nicht.
 *
 * @module related
 */

/**
 * Geschwistereinträge eines Wiki-Artikels.
 * @param {Array<Record<string, any>>} buildSet - die öffentliche Build-Menge (D-20)
 * @param {Record<string, any>} entry - der Eintrag, für den Geschwister gesucht werden
 * @param {number} [limit=5] - Deckel; D-16 nennt fünf
 * @returns {Array<Record<string, any>>} gleiche Kategorie, ohne den Eintrag selbst,
 *   nach `entry_number` (Fallback 0) und dann `entry_name` sortiert; leer bei fehlender Kategorie
 */
export function relatedEntries(buildSet, entry, limit = 5) {
  // Ohne Kategorie gibt es keine Geschwister. Ein `undefined === undefined`-Vergleich würde
  // sonst alle kategorielosen Einträge füreinander als „verwandt" erklären.
  if (entry.category_id === null || entry.category_id === undefined) return []

  return buildSet
    .filter(
      other =>
        other.category_id === entry.category_id &&
        other.entry_id !== entry.entry_id &&
        other.slug
    )
    .sort((a, b) => {
      const byNumber = (a.entry_number || 0) - (b.entry_number || 0)
      if (byNumber !== 0) return byNumber
      return String(a.entry_name || '').localeCompare(String(b.entry_name || ''), 'de')
    })
    .slice(0, limit)
}

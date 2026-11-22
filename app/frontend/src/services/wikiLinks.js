/**
 * wikiLinks.js - Begriffsliste fuer die Anzeige-Verlinkung der KI-Auswertung.
 *
 * Quelle ist der bestehende oeffentliche Endpunkt `GET /wiki/build-entries`: er liefert
 * `entry_name` und `slug` fuer jeden oeffentlichen Eintrag und ist damit die einzige erlaubte
 * Slug-Quelle — kein im Client gebauter Slug. Der Abruf laeuft genau einmal je
 * Seitenlebensdauer und ohne Token-Refresh (`includeAuth=false`), weil anonyme Besucher die
 * Auswertung ebenfalls sehen duerfen.
 *
 * @module wikiLinks
 */

import { get } from './api'

/**
 * Der eine laufende Abruf. Absichtlich nie zurueckgesetzt: ein Fehlschlag wird innerhalb
 * derselben Seitenlebensdauer nicht erneut versucht (kein Retry-Mechanismus), ein spaeterer
 * Seitenaufbau legt das Modul neu an und versucht es erneut.
 */
let promise = null

/**
 * Laedt die oeffentliche Eintragsliste einmalig und memoisiert sie.
 *
 * Projiziert die Antwort auf `{ name, slug }` und ignoriert `entry_content` (heute ~49 KB, das
 * der Linker nie braucht). Ein Fehlschlag liefert `[]`: kein Link ist besser als eine kaputte
 * Seite, und der gerenderte Text bleibt unveraendert.
 *
 * @returns {Promise<Array<{name: string, slug: string}>>} Begriffe, nie `null`
 */
export function loadWikiLinks(){
  if (!promise){
    promise = get('/wiki/build-entries', false)
      .then((response) => {
        if (!response.ok){
          console.warn(`[wikiLinks] Eintragsliste konnte nicht geladen werden (${response.status})`)
          return []
        }
        return response.json()
      })
      .then((rows) => (Array.isArray(rows)
        ? rows
          .filter((entry) => entry && entry.entry_name && entry.slug)
          .map((entry) => ({ name: entry.entry_name, slug: entry.slug }))
        : []))
      .catch((err) => {
        console.warn('[wikiLinks] Eintragsliste konnte nicht geladen werden:', err)
        return []
      })
  }
  return promise
}

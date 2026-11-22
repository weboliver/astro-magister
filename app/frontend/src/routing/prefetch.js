/**
 * prefetch - lädt den JS-Chunk einer Seite vor
 * @module prefetch
 * @description Lädt ausschließlich den JS-Chunk einer Seite über `pages[key].load()`. Bewusst
 *              kein Router-`lazy()`: den ChunkLoadError-Vertrag trägt allein `routes.jsx`.
 *              Keine Netzwerk-Anfrage, keine Konsolenausgabe — ein fehlgeschlagener Prefetch ist
 *              still und berührt die Chunk-Recovery nicht. Der Merker hält nur **erfolgreich
 *              angeforderte** Chunks: nach einem Fehlschlag darf der nächste Hover es erneut
 *              versuchen.
 */

import { pages } from './pages'

/** Schlüssel, deren Chunk im laufenden Dokument bereits angefordert wurde. */
const loaded = new Set()

/**
 * Prefetch ist bei Datensparsamkeit und langsamen Netzen aus. Fehlt die
 * `connection`-Angabe (Firefox, Safari), ist Prefetch erlaubt.
 * @returns {boolean} Darf vorgeladen werden?
 */
export function prefetchAllowed() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null
  if (!connection) return true
  if (connection.saveData === true) return false
  return !['slow-2g', '2g', '3g'].includes(connection.effectiveType)
}

/**
 * Fordert den Chunk einer Seite an. Unbekannte Schlüssel und Seiten ohne Loader sind kein Fehler.
 *
 * Der Merker wird **vor** dem Aufruf gesetzt (zwei parallele Anfragen desselben Chunks sind
 * unnötig) und bei einem Fehlschlag wieder entfernt: ein Netzwerkaussetzer oder ein kalter
 * CDN-Eintrag darf die Vorladung nicht für die restliche Dokumentlebensdauer abschalten.
 * @param {string} key - Schlüssel aus `pages`
 * @returns {void}
 */
export function prefetchPage(key) {
  if (!prefetchAllowed()) return
  if (!pages[key] || typeof pages[key].load !== 'function') return
  if (loaded.has(key)) return
  loaded.add(key)
  pages[key].load().catch(() => {
    // Der Chunk ist nicht geladen — der nächste Hover/Fokus versucht es erneut. Die Fehlerbehandlung
    // der echten Navigation bleibt bei `routes.jsx`; hier wird nichts geloggt und nichts geworfen.
    loaded.delete(key)
  })
}

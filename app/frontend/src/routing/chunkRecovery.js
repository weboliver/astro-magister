/**
 * chunkRecovery - Schleifenschutz und Helfer für einen fehlenden Seiten-Chunk
 * @module chunkRecovery
 * @description Nach einem Deploy fehlt im Browser-Cache ein Seiten-Chunk. Die App darf dann
 *              **genau einmal** neu laden und muss beim zweiten Fehlschlag eine bedienbare
 *              Fehleransicht zeigen statt einer weißen Seite.
 *
 *              Beide Kanäle münden in **einen** Reload-Eigentümer, damit es nur einen Merker und
 *              einen Aufruf dieses Helfers gibt: `toRoute().lazy` und der
 *              `vite:preloadError`-Handler in `main.jsx` werfen nur, ausschließlich die
 *              Route-`ErrorBoundary` (`ChunkErrorBoundary.jsx`) ruft `recoverFromChunkError()`
 *              auf und zeigt während des Reloads den Ladehinweis.
 *
 *              Der Merker liegt pro **Route** in `sessionStorage`; der Schlüssel ist der
 *              Routen-Pfad aus `pages` (`page.path`, etwa `/wiki/:slug`), **niemals**
 *              `window.location.pathname`: react-router schreibt die Adresse erst **nach** dem
 *              Auflösen der `lazy`-Promise, während einer client-seitigen Navigation zeigt sie
 *              deshalb noch den alten Pfad — die erfolgreiche neue Seite löschte sonst den
 *              Merker der kaputten alten und der Endlos-Reload begänne von vorn.
 *
 *              Der **Musterschlüssel** (`/wiki/:slug`) ist statt des konkreten Pfads gewählt:
 *              benutzergewählte Segmente (Slugs, IDs) landen damit weder im `sessionStorage` noch
 *              in der Fehlermeldung oder Konsole. Ein kaputter `/admin`-Chunk reißt `/wiki`
 *              weiterhin nicht mit.
 *
 *              Fehlt der Storage (Privatmodus, Quota), wird bewusst **nicht** neu geladen — ohne
 *              Schleifenschutz kein Reload.
 */

/** Schlüssel-Präfix des Schleifenschutzes; der Routen-Pfad wird angehängt. */
const KEY_PREFIX = 'astronex-chunk-reload:'

/**
 * Meldungen, mit denen Browser ein fehlgeschlagenes `import()` quittieren.
 *
 * Die letzte Variante (`MIME type of "text/html"`) deckt den wahrscheinlichsten
 * Produktionsfall ab: antwortet der SPA-Fallback mit `200 text/html` statt `404`, lehnt der
 * Browser das Modul wegen des MIME-Typs ab.
 */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w.-]+ failed|ChunkLoadError|MIME type of "text\/html"/i

/**
 * Fehler eines fehlenden Seiten-Chunks, der den Routen-Schlüssel mitführt.
 *
 * Die Meldung trifft bewusst den `CHUNK_ERROR`-Regex, damit `isChunkLoadError()` ihn erkennt —
 * auch dann, wenn im Produktions-Bundle kein Browser-Fehlerobjekt mehr vorliegt, weil Vites
 * `__vitePreload` nach `event.preventDefault()` mit `undefined` auflöst.
 */
export class ChunkLoadError extends Error {
  /**
   * @param {string} chunkKey - Routen-Pfad aus `pages` (`page.path`)
   * @param {unknown} [cause] - Ursprünglicher Ladefehler, falls vorhanden
   */
  constructor(chunkKey, cause) {
    super('Failed to fetch dynamically imported module: ' + chunkKey)
    this.name = 'ChunkLoadError'
    // Routen-Schlüssel für den Schleifenschutz — die Boundary liest ihn aus dem Fehler, damit
    // Setzen und Löschen nie auseinanderlaufen.
    this.chunkKey = chunkKey
    this.cause = cause
  }
}

/**
 * Erkennt, ob ein Fehler ein fehlgeschlagenes Nachladen eines Chunks ist.
 * @param {unknown} error - Fehlerobjekt, Fehlermeldung oder beliebiger Wert
 * @returns {boolean} true, wenn die Meldung auf einen Chunk-Ladefehler passt
 */
export function isChunkLoadError(error) {
  const message = typeof error === 'string' ? error : error?.message || ''
  return CHUNK_ERROR.test(message)
}

/**
 * Ein Schlüssel ist nur dann brauchbar, wenn er ein nicht-leerer String ist.
 *
 * Beide Speicher-Helfer behandeln einen fehlenden Schlüssel als „nichts tun“ — sie fallen
 * ausdrücklich **nicht** auf die aktuelle Adresse zurück.
 * @param {unknown} chunkKey - Zu prüfender Routen-Schlüssel
 * @returns {boolean} true, wenn der Schlüssel verwendbar ist
 */
function hasChunkKey(chunkKey) {
  return typeof chunkKey === 'string' && chunkKey.length > 0
}

/**
 * Startet höchstens einen Reload pro Routen-Schlüssel.
 * @param {string} chunkKey - Routen-Pfad aus `pages` (`page.path`; kein Pfad-Default)
 * @returns {boolean} true, wenn der Reload tatsächlich gestartet wurde
 */
export function recoverFromChunkError(chunkKey) {
  if (!hasChunkKey(chunkKey)) return false
  const key = KEY_PREFIX + chunkKey
  try {
    // Merker schon gesetzt: diese Route hat es bereits einmal versucht → kein zweiter Reload
    // (sonst entstünde bei dauerhaft fehlendem Chunk eine Endlosschleife).
    if (sessionStorage.getItem(key)) return false
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // Kein nutzbarer `sessionStorage` (Privatmodus, Quota): ohne Schleifenschutz kein Reload.
    return false
  }
  window.location.reload()
  return true
}

/**
 * Löscht den Merker einer Route, sobald deren Seiten-Chunk nachweislich aufgelöst ist.
 * @param {string} chunkKey - Routen-Pfad aus `pages` (`page.path`; kein Pfad-Default)
 * @returns {void}
 */
export function clearChunkReloadMark(chunkKey) {
  if (!hasChunkKey(chunkKey)) return
  try {
    sessionStorage.removeItem(KEY_PREFIX + chunkKey)
  } catch {
    // Storage nicht verfügbar: es gibt dann auch keinen Merker, der zu löschen wäre.
  }
}

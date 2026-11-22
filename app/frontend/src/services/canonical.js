/**
 * canonical — die eine Canonical-Host-Aussage des Frontends.
 *
 * Der Canonical darf niemals aus der Laufzeit-Adresse des Browserfensters oder aus einer
 * Request-Angabe gebildet werden: im Dev-Stack zeigte das auf `https://localhost`, und eine
 * App-Route ist keine Aussage über die öffentliche Adresse. Der Host steht deshalb genau
 * einmal hier. Dieselbe Aussage steht an zwei weiteren Stellen: `site` in
 * `app/wiki/astro.config.mjs` liest **diese** Konstante direkt, und
 * `NGINX_CANONICAL_HOST` in `.env` trägt denselben Wert byte-gleich. Drei Bezugnahmen, ein
 * Wert — eine Domain-Änderung zieht alle drei Stellen mit.
 *
 * Das Modul bleibt frei von React- und Browser-Importen, weil der Astro-Build es zur
 * Build-Zeit importiert (wie schon `theme/zodiacColors.js`).
 *
 * Kein `fetch`, keine Konsole, kein Semikolon: das Modul liefert nur Werte und reine
 * Zuordnungsfunktionen.
 *
 * @module canonical
 */

/**
 * Öffentlicher Host der Seite — die eine Host-Aussage im Frontend.
 * @type {string}
 */
export const CANONICAL_ORIGIN = 'https://www.astro-magister.de'

/**
 * Kanonische Adresse der App-Wiki-Übersicht: sie zeigt auf das **statische** Wiki.
 * @type {string}
 */
export const WIKI_OVERVIEW_CANONICAL = CANONICAL_ORIGIN + '/astro-wiki/'

/**
 * Rückfall-Canonical — derselbe Wert wie das statische `index.html`.
 * @type {string}
 */
export const DEFAULT_CANONICAL = CANONICAL_ORIGIN + '/'

/**
 * Die `@id` des Organization-Knotens. Der statische Wiki-Build gibt sie seinen
 * `Article.publisher`-Verweisen mit; sie ist deshalb byte-gleich mit dem
 * `@id` im JSON-LD von `app/frontend/index.html`.
 * @type {string}
 */
export const ORGANIZATION_ID = CANONICAL_ORIGIN + '/#organization'

/**
 * Self-referencing Canonical einer App-Route.
 *
 * `/wiki` ist die **einzige** Zuordnung „App-Wiki → statisches Wiki": sie steht hier
 * und nicht in `Wiki.jsx`, damit die Aussage an genau einer Stelle existiert.
 *
 * Der Aufrufer übergibt den bereits normalisierten Pfad (`App.jsx`: gekürzter, auf einen
 * führenden Schrägstrich zusammengefasster `location.pathname`) — nicht `page.path`, denn das
 * ist bei `/wiki/:slug` eine Vorlage und landete als Literal im Canonical.
 * @param {string} path - normalisierter Pfad der aktiven Route
 * @returns {string} absolute Canonical-URL
 */
export function canonicalForPath(path) {
  if (path === '/') return DEFAULT_CANONICAL
  if (path === '/wiki') return WIKI_OVERVIEW_CANONICAL
  return CANONICAL_ORIGIN + path
}

/**
 * Canonical eines App-Wiki-Artikels — er zeigt auf die gebaute Seite im statischen Wiki.
 * Der Slug kommt aus der API, nie aus `entry_name` + `entry_id`.
 * Ohne Slug bleibt `null`; der Aufrufer setzt dann `DEFAULT_CANONICAL` und das statische
 * `/`-Canonical bleibt stehen, bis der Eintrag geladen ist.
 * @param {string|null|undefined} slug - `slug` des geladenen Eintrags
 * @returns {string|null} absolute Canonical-URL oder `null`
 */
export function canonicalForWikiEntry(slug) {
  if (!slug) return null
  return CANONICAL_ORIGIN + '/astro-wiki/' + slug + '/'
}

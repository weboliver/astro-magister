/**
 * wikiLinkify.js - Verlinkt Fachbegriffe beim Anzeigen einer KI-Auswertung.
 *
 * Die Verlinkung passiert ausschliesslich in der Anzeige: der gespeicherte Text bleibt
 * unveraendert, alte wie neue Auswertungen bekommen dieselben Links. Bewusst ohne jede
 * Import-Zeile, damit `node` dieses Modul ohne Vite/JSX direkt laden kann (Gate
 * `scripts/check-wiki-links.mjs`).
 *
 * @module wikiLinkify
 */

/** Elternknoten, deren Text nie verlinkt wird: Ueberschrift, bestehender Link, Code, rohes HTML. */
export const SKIP_PARENTS = new Set(['heading', 'link', 'linkReference', 'inlineCode', 'code', 'html'])

/** Kuerzere Begriffe bekommen keinen Link — „AC" oder „MC" sind als Link eine Zumutung. */
export const MIN_LENGTH = 4

/** Obergrenze je Baum: ein langer Text soll nicht zum Linkteppich werden. */
export const MAX_LINKS = 12

/** Der einzige Ort, an dem ein DB-String zu einem `href` wird — alles andere faellt auf „kein Link". */
export const SAFE_SLUG = /^[a-z0-9-]+$/

/**
 * Elternknoten, deren `text`-Kinder verlinkt werden duerfen. `strong`/`emphasis` sind bewusst
 * nicht dabei (Grenze: Text in Fettschrift bleibt unverlinkt), `paragraph`, `listItem` und
 * `tableCell` sind die drei Stellen, an denen Fliesstext in einer Auswertung steht.
 */
const LINKABLE_PARENTS = new Set(['paragraph', 'listItem', 'tableCell'])

/** Ein einzelnes Zeichen, das als Wortbestandteil gilt (`ä ö ü ß` sind `\p{L}`). */
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Prueft, ob ein Zeichen ein Wortbestandteil ist.
 *
 * @param {string} ch - Einzelnes Zeichen oder leerer String am Textrand
 * @returns {boolean} `true`, wenn links/rechts kein Wortende vorliegt
 */
function isWordChar(ch){
  return typeof ch === 'string' && ch.length > 0 && WORD_CHAR.test(ch)
}

/**
 * Sucht das erste ganzwortige Vorkommen eines Begriffs.
 *
 * Bewusst eine `indexOf`-Schleife mit Grenzpruefung statt eines Regex, das den Begriff selbst
 * einsetzt: kein untrusted Text im Muster, kein katastrophales Backtracking.
 *
 * @param {string} value - Textknoten-Inhalt
 * @param {string} term - Begriff aus der Eintragsliste
 * @returns {number} Index des Treffers, `-1` wenn keiner ganzwortig vorkommt
 */
function findWholeWord(value, term){
  let from = 0
  while (from <= value.length - term.length){
    const at = value.indexOf(term, from)
    if (at === -1) return -1
    const before = at > 0 ? value[at - 1] : ''
    const after = value[at + term.length] ?? ''
    if (!isWordChar(before) && !isWordChar(after)) return at
    from = at + 1
  }
  return -1
}

/**
 * Normalisiert die Begriffsliste: filtert Unbrauchbares, sortiert den laengsten Begriff nach vorn.
 *
 * @param {Array<{name: string, slug: string}>|null|undefined} links - Eintraege aus `/wiki/build-entries`
 * @returns {Array<{name: string, slug: string}>} Verlinkbare Begriffe, laengster zuerst
 */
export function normalizeWikiTerms(links){
  if (!Array.isArray(links)) return []
  const terms = []
  for (const entry of links){
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name : ''
    const slug = typeof entry.slug === 'string' ? entry.slug : ''
    if (name.length < MIN_LENGTH) continue
    if (!slug || !SAFE_SLUG.test(slug)) continue
    terms.push({ name, slug })
  }
  // Laengster Begriff zuerst, damit „Planetenkonstellation" nicht in „Planeten" + Rest zerfaellt.
  terms.sort((a, b) => b.name.length - a.name.length)
  return terms
}

/**
 * remark-Attacher: gibt den mdast-Transformer zurueck (die Form, die `remarkPlugins` erwartet).
 *
 * `[remarkWikiLinks, links]` ist die zulaessige Registrierung — Attacher plus Optionen. Ein
 * bereits gebauter Transformer in der Liste (`.use(remarkWikiLinks(links))`) wird von unified als
 * Attacher aufgerufen und wirft, sobald die Begriffsliste nicht leer ist; das ist der Grund, warum
 * diese Funktion nie den Transformer selbst exportiert.
 *
 * @param {Array<{name: string, slug: string}>|null|undefined} links - Oeffentliche Eintraege
 * @returns {(tree: Object) => Object} Transformer; ohne brauchbare Liste ein No-op
 */
export function remarkWikiLinks(links){
  const terms = normalizeWikiTerms(links)
  return (tree) => {
    if (terms.length === 0) return tree
    linkify(tree, terms)
    return tree
  }
}

/**
 * Laeuft ueber den mdast-Baum und ersetzt Treffer in `text`-Knoten durch `text`/`link`-Folgen.
 *
 * Bewusst ohne Weiche fuer einen fehlenden Baum: der Walker wird nur vom zurueckgegebenen
 * Transformer aufgerufen. Wird der Transformer selbst als Attacher missbraucht, bekommt er
 * `undefined` statt eines Baums und soll laut scheitern (Fall (l3) im Gate).
 *
 * @param {Object} node - Wurzelknoten (oder ein Knoten mit `children`)
 * @param {Array<{name: string, slug: string}>} terms - Normalisierte, laengste zuerst
 * @param {{count: number}} placed - Zaehler der gesetzten Links, geteilt ueber den ganzen Baum
 * @param {Set<string>} seen - Bereits verlinkte Slugs
 * @returns {void}
 */
function linkify(node, terms, placed = { count: 0 }, seen = new Set()){
  const children = node.children
  if (!Array.isArray(children)) return
  spliceChildren(children, node.type, terms, placed, seen)
}

/**
 * Verarbeitet die Kindliste eines Knotens, inklusive der Reste, die ein Treffer hinterlaesst.
 *
 * @param {Array<Object>} children - Kindliste des Elternknotens
 * @param {string} parentType - `type` des Elternknotens
 * @param {Array<{name: string, slug: string}>} terms - Normalisierte Begriffe
 * @param {{count: number}} placed - Zaehler der gesetzten Links (Geteilt ueber den ganzen Baum)
 * @param {Set<string>} seen - Bereits verlinkte Slugs
 * @returns {void}
 */
function spliceChildren(children, parentType, terms, placed, seen){
  let index = 0
  while (index < children.length){
    if (placed.count >= MAX_LINKS) return
    const child = children[index]
    if (!child || typeof child !== 'object'){
      index += 1
      continue
    }
    if (child.type === 'text'){
      if (LINKABLE_PARENTS.has(parentType)){
        const replacement = splitText(child.value, terms, placed, seen)
        if (replacement){
          children.splice(index, 1, ...replacement)
          // Ab demselben Index weiterscannen: der Text vor dem Treffer kann einen anderen
          // Begriff enthalten. Jeder Durchlauf setzt hoechstens einen weiteren Link, deshalb
          // endet die Schleife spaetestens nach `MAX_LINKS` Treffern.
          continue
        }
      }
      index += 1
      continue
    }
    if (!SKIP_PARENTS.has(child.type)) linkify(child, terms, placed, seen)
    index += 1
  }
}

/**
 * Zerlegt einen Textknoten am ersten ganzwortigen Treffer.
 *
 * @param {string} value - Inhalt des `text`-Knotens
 * @param {Array<{name: string, slug: string}>} terms - Normalisierte Begriffe
 * @param {{count: number}} placed - Link-Zaehler
 * @param {Set<string>} seen - Bereits verlinkte Slugs
 * @returns {Array<Object>|null} Ersatzknoten oder `null`, wenn nichts passt
 */
function splitText(value, terms, placed, seen){
  if (typeof value !== 'string' || value.length === 0) return null
  if (placed.count >= MAX_LINKS) return null
  for (const term of terms){
    if (seen.has(term.slug)) continue
    const at = findWholeWord(value, term.name)
    if (at === -1) continue
    seen.add(term.slug)
    placed.count += 1
    const out = []
    const before = value.slice(0, at)
    const hit = value.slice(at, at + term.name.length)
    const after = value.slice(at + term.name.length)
    if (before) out.push({ type: 'text', value: before })
    out.push({ type: 'link', url: `/wiki/${term.slug}`, children: [{ type: 'text', value: hit }] })
    if (after) out.push({ type: 'text', value: after })
    return out
  }
  return null
}

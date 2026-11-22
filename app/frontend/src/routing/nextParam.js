/**
 * nextParam - Validierung des `?next=`-Rückwegs
 * @module nextParam
 * @description Ein `next`-Ziel ist nur gültig, wenn es ein pfad-internes Ziel ist, das in der
 *              Routentabelle wirklich existiert. Alles andere (Schema, Host, `//`-Präfix,
 *              Backslash, Steuerzeichen) fällt auf den Fallback zurück — sonst entstünde ein
 *              Open Redirect.
 *
 *              Die Gültigkeitsliste kommt ausschließlich aus `pages`. Es gibt kein zweites
 *              Pfad-Array; wer eine Seite hinzufügt, macht sie damit automatisch als Rückweg
 *              gültig.
 */
import { matchPath } from 'react-router'
import { pages } from './pages'

/**
 * Login und Registrierung sind als Rückweg sinnlos: nach dem Login würde die Maske erneut
 * erscheinen. Der Ausschluss läuft über die `pages`-Schlüssel, nicht über ein zweites Pfad-Array.
 */
const EXCLUDED_KEYS = new Set(['login', 'register'])

/** Akzeptierte Ziele: alle Seitenpfade außer Login/Registrierung. */
const NEXT_PATTERNS = Object.entries(pages)
  .filter(([key]) => !EXCLUDED_KEYS.has(key))
  .map(([, page]) => page.path)

/** Maximale Länge eines akzeptierten `next`-Werts (Schutz vor aufgeblähten URLs). */
const MAX_NEXT_LENGTH = 2048

/**
 * Prüft einen rohen `?next=`-Wert.
 * @param {unknown} raw - Wert aus der Adresszeile
 * @returns {boolean} True, wenn das Ziel pfad-intern ist und in der Routentabelle existiert
 */
export function isValidNext(raw) {
  // Kein String oder leer: kein Ziel.
  if (typeof raw !== 'string' || raw.length === 0) return false
  // Überlange Werte werden nie weiterverarbeitet.
  if (raw.length > MAX_NEXT_LENGTH) return false
  // Relative Ziele sind kein sinnvoller Rückweg.
  if (!raw.startsWith('/')) return false
  // Protokoll-relativ (`//evil.example`) zeigt auf einen fremden Host.
  if (raw.startsWith('//')) return false
  // Backslash-Tricks: Browser normalisieren `\` teils zu `/`, matchPath täte das nicht.
  if (raw.includes('\\')) return false
  // Steuerzeichen (Header-/URL-Splitting-Muster).
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false

  // Query und Hash gehören nicht zum Pfad-Muster; der Pfad allein entscheidet.
  const pathOnly = raw.split(/[?#]/)[0]
  return NEXT_PATTERNS.some((pattern) => matchPath(pattern, pathOnly) !== null)
}

/**
 * Liefert `raw`, wenn es ein gültiges Ziel ist, sonst `fallback`.
 * @param {unknown} raw - Wert aus der Adresszeile
 * @param {string} [fallback='/'] - Ziel bei ungültiger Eingabe
 * @returns {string} Sicheres Navigationsziel
 */
export function safeNext(raw, fallback = '/') {
  return isValidNext(raw) ? raw : fallback
}

export default safeNext

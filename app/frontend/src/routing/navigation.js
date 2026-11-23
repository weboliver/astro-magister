/**
 * navigation - Navigationskonfiguration der Hülle (eine Liste für Desktop und Mobile)
 * @module navigation
 * @description Diese Liste ist die einzige Quelle des Menüs: Desktop-Leiste und mobiles Panel
 *              rendern dasselbe Markup, CSS entscheidet über die Darstellung. Pfade und
 *              Beschriftungen werden aus `pages` gelesen und nie neu getippt — ein Menüpunkt ist
 *              nie strenger oder lockerer als seine Route.
 *
 *              Testids entstehen erst im Renderer als `nav-${key}`; diese Datei enthält bewusst
 *              kein `data-testid`-Literal. Aktionen (Logout) leben in `actions`, nicht in
 *              `children`: `targetOf` und `isGroupActive` iterieren über `children` und würden
 *              über einen Aktionsschlüssel stolpern.
 */

import { matchPath } from 'react-router'
import { pages } from './pages'

/**
 * Die sechs Rechner in fester Reihenfolge.
 * @type {string[]}
 */
export const CALCULATOR_KEYS = ['horoscope', 'mondknoten', 'transits', 'solar', 'agepoints', 'synastrie']

/**
 * Linke Seite des Headers: Startseite, Wiki und die Gruppe „Auswertungen".
 * `end` nur bei der Startseite, damit `/` nicht jeden Pfad als aktiv markiert.
 * @type {Array<Object>}
 */
export const NAV_PRIMARY = [
  { kind: 'link', key: 'home', end: true },
  { kind: 'link', key: 'wiki' },
  { kind: 'group', key: 'group-auswertungen', label: 'Auswertungen', children: CALCULATOR_KEYS },
]

/**
 * Rechte Seite für angemeldete Nutzer: eine Disclosure-Gruppe „Konto".
 * `children` enthält ausschließlich Seitenschlüssel aus `pages`; der Logout steht in `actions`
 * und wird im Renderer innerhalb der Konto-Unterliste nach den Kindern gerendert.
 *
 * Admin steht **nicht** in der Unterliste, sondern als eigener Knopf
 * links neben „Konto" (`NAV_ACCOUNT_LINKS`) — nur für Admins, weil der Guard die Route ohnehin
 * schützt und die Unterliste für Nicht-Admins nie einen Admin-Eintrag zeigte.
 * @type {Array<Object>}
 */
export const NAV_ACCOUNT = [
  {
    kind: 'group',
    key: 'group-konto',
    label: 'Konto',
    children: ['settings'],
    actions: [{ kind: 'action', key: 'logout', label: 'Logout' }],
  },
]

/**
 * Eigenständige Knöpfe rechts, links neben der Konto-Gruppe. `adminOnly` blendet den Eintrag für
 * Nicht-Admins aus (dieselbe Sichtbarkeit, die vorher `visibleChildren` in der Unterliste regelte).
 * @type {Array<Object>}
 */
export const NAV_ACCOUNT_LINKS = [{ kind: 'link', key: 'admin', adminOnly: true }]

/**
 * Rechte Seite für anonyme Nutzer: Login und Registrieren als oberste Ebene, keine Gruppe.
 * `register` trägt ein abweichendes Label, weil `pages.register.meta.title` „Registrierung" heißt.
 * @type {Array<Object>}
 */
export const NAV_ANON = [
  { kind: 'link', key: 'login' },
  { kind: 'link', key: 'register', label: 'Registrieren' },
]

/**
 * Sichtbarer Text eines Eintrags: eigenes Label, sonst der Seitentitel aus `pages`.
 * @param {{key: string, label?: string}} entry - Eintrag der Konfiguration
 * @returns {string} Beschriftung
 */
export function labelOf(entry) {
  return entry.label || pages[entry.key].meta.title
}

/**
 * Menüziel eines Seitenschlüssels ohne Parameter-Segmente (`/admin/:tab?` → `/admin`).
 * @param {string} key - Schlüssel aus `pages`
 * @returns {string} Konkreter Pfad
 */
export function targetOf(key) {
  return pages[key].path.replace(/\/:.*$/, '')
}

/**
 * True, wenn eine der Kindrouten die aktuelle Adresse matcht — dieselbe Semantik, die `NavLink`
 * intern benutzt. Der Gruppenknopf trägt deshalb `aria-current="true"`, nicht `"page"`: er ist
 * keine Seite.
 * @param {string[]} keys - Kindrouten-Schlüssel
 * @param {string} pathname - Aktuelle Adresse
 * @returns {boolean} Gruppe aktiv
 */
export function isGroupActive(keys, pathname) {
  return keys.some((key) => matchPath(pages[key].path, pathname) !== null)
}

/**
 * Kinder einer Gruppe, gefiltert nach der Zugriffsstufe ihrer Route. Die Admin-Sichtbarkeit kommt
 * aus `pages[key].access` statt aus einem zweiten Flag — so bleibt Menü und Route deckungsgleich.
 * @param {{children?: string[]}} entry - Gruppeneintrag
 * @param {boolean} isAdmin - `profile.isadmin === true`
 * @returns {string[]} Sichtbare Kindrouten-Schlüssel
 */
export function visibleChildren(entry, isAdmin) {
  return (entry.children || []).filter((key) => pages[key].access !== 'admin' || isAdmin === true)
}

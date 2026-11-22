/**
 * App - Layout-Hülle (AppShell) für Astro-Magister
 * @component
 * @description Rendert den Skip-Link, Header (Zeichen-Badge, Menü-Button, eine Liste aus der
 *              Navigationskonfiguration), den Titelbereich, den Hauptbereich `<main id="main">`,
 *              den Footer als eigenes `contentinfo`-Landmark, die Theme-Effekte und das Logout.
 *              Die Seiten selbst kommen als `<Outlet/>` aus der Routentabelle; Titel, Description
 *              und Hüllenbreite liest die Hülle aus dem `handle` der aktiven Route.
 *
 *              Desktop und Mobile teilen sich **ein** Markup: das Panel ist immer im DOM, `data-open`
 *              ist die einzige Zustandsvariable, CSS entscheidet über Leiste oder Panel.
 *
 *              Menü-Links laden ihren Seiten-Chunk bei Fokus, nach 120 ms Hover und bei
 *              `pointerdown` vor; geladen wird ausschließlich der Chunk, nie eine API-Anfrage.
 * @hook useAuth - Server-Session (`profile`) für die Sichtbarkeit der Menüpunkte
 * @hook useLocation - Pfadwechsel für Fokus, Panel-Zustand und Titelbereich
 * @hook useMatches - `handle` der letzten Route (Titel, Description, Hüllenbreite)
 * @hook useState - Panel-Zustand, offene Gruppe
 * @hook useRef - Hauptbereich für den Programm-Fokus, Pfad-Merker gegen den Erstaufruf
 */
import React, { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router'
import { useAuth } from './contexts/AuthContext'
import { usePersonSelection } from './contexts/PersonSelectionContext'
import { apiUrl, clearStoredSession } from './services/api'
import { canonicalForPath } from './services/canonical'
import { useSeoMeta } from './hooks/useSeoMeta'
import { applyTheme, loadSavedTheme } from './theme/ThemeApplier'
import {
  readStoredSignMarker,
  signIndexForPerson,
  signMarkerFor,
  THEME_SIGN_STORAGE_KEY,
} from './theme/personSign'
import { pages } from './routing/pages'
import { prefetchPage } from './routing/prefetch'
import {
  CALCULATOR_KEYS,
  NAV_ACCOUNT,
  NAV_ACCOUNT_LINKS,
  NAV_ANON,
  NAV_PRIMARY,
  isGroupActive,
  labelOf,
  targetOf,
  visibleChildren,
} from './routing/navigation'
import { PageFrameProvider, usePageFrame } from './routing/pageFrame'

/**
 * Footer-Ziele kommen aus der Routentabelle statt aus einer zweiten Pfad-Literalliste:
 * `pages.js` bleibt die einzige Quelle für Pfad und Titel, ein Pfadwechsel erreicht den Footer mit.
 * @type {Array<{label: string, to: string}>}
 */
const FOOTER_LINKS = ['impressum', 'datenschutz', 'kontakt'].map((key) => ({
  label: labelOf({ key }),
  to: targetOf(key),
}))
const EXTERNAL_FOOTER_LINKS = [
  { label: 'Buy me a coffee', href: 'https://buymeacoffee.com/shinengakic' },
]

/**
 * Prefetch-Handler für einen Menü-Link.
 *
 * Vorgeladen wird ausschließlich der JS-Chunk der Seite (`pages[key].load()`), nie eine
 * API-Anfrage und nie ein Router-`lazy()`: den ChunkLoadError-Vertrag trägt allein `routes.jsx`.
 * Die 120 ms Verzögerung beim Überfahren mit der Maus sorgen dafür, dass ein schnelles
 * Durchstreichen der Leiste nichts lädt; Fokus und `pointerdown` (Touch/Pen) laden sofort.
 *
 * Der Hook wird unbedingt im Body der Komponente aufgerufen: eine Aufrufstelle in `.map()` oder
 * in einem bedingten Zweig wechselte die Hook-Anzahl, sobald `initialized` von `false` auf `true`
 * kippt.
 * @param {string} key - Schlüssel aus `pages`, dessen Chunk vorgeladen wird
 * @returns {{onFocus: Function, onPointerEnter: Function, onPointerLeave: Function, onPointerDown: Function}} Handler für den Link
 */
function usePrefetchHandlers(key) {
  const timer = useRef(null)

  // Kein Timer darf einen unmounteten Link überleben.
  useEffect(() => () => {
    clearTimeout(timer.current)
    timer.current = null
  }, [])

  return {
    onFocus: () => prefetchPage(key),
    onPointerEnter: (event) => {
      if (event.pointerType !== 'mouse') return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => prefetchPage(key), 120)
    },
    onPointerLeave: () => {
      clearTimeout(timer.current)
      timer.current = null
    },
    onPointerDown: () => prefetchPage(key),
  }
}

/**
 * Ein Menüpunkt als echter Link.
 *
 * Zwei getrennte Klassenverträge: oberste Ebene trägt die Pille (`app-nav-link`), ein Eintrag im
 * Untermenü nur `app-nav-sub-link`. Sonst erbten die Dropdown-Zeilen Pillenform, halbtransparenten
 * Grund und die Balkenfarbe `#f6fffc`.
 * @param {Object} props
 * @param {string} props.pageKey - Schlüssel aus `pages`; bestimmt auch das `data-testid`
 * @param {string} props.label - Sichtbarer Text
 * @param {string} [props.to] - Abweichendes Ziel (z. B. ohne Parameter-Segment)
 * @param {boolean} [props.end] - Exakter Match (nur für die Startseite)
 * @param {'top'|'sub'} [props.variant] - Darstellungsebene
 * @param {function(): void} [props.onNavigate] - Schließt Panel und Gruppen nach dem Klick
 * @param {string} [props.prefetchKey] - Abweichend vorzuladender Chunk (Standard: `pageKey`)
 * @returns {JSX.Element} Navigationseintrag
 */
function NavItem({ pageKey, label, to, end = false, variant = 'top', onNavigate, prefetchKey }) {
  const target = to || pages[pageKey].path
  const base = variant === 'sub' ? 'app-nav-sub-link' : 'app-nav-link'
  const prefetch = usePrefetchHandlers(prefetchKey || pageKey)
  return (
    <NavLink
      to={target}
      end={end}
      data-testid={`nav-${pageKey}`}
      onClick={onNavigate}
      {...prefetch}
      className={({ isActive }) => (isActive ? `${base} ${base}-active` : base)}
    >
      {label}
    </NavLink>
  )
}

/**
 * Aktion der Navigation (Logout). Aktionen leben in `actions`, nicht in `children` — die
 * Ziel-Helfer iterieren über Kindrouten-Schlüssel.
 * @param {Object} props
 * @param {{key: string, label: string}} props.action - Aktionseintrag aus der Konfiguration
 * @param {function(): void} props.onLogout - Logout-Handler der Hülle
 * @param {function(): void} [props.onNavigate] - Schließt Panel und Gruppen vor dem Logout
 * @returns {JSX.Element} Aktionsknopf
 */
function NavAction({ action, onLogout, onNavigate }) {
  function handleClick() {
    if (onNavigate) onNavigate()
    onLogout()
  }

  return (
    <button
      type="button"
      className="app-nav-link app-nav-link-logout"
      data-testid={`nav-${action.key}`}
      onClick={handleClick}
    >
      {action.label}
    </button>
  )
}

/**
 * Gesperrter Rechner-Eintrag: sichtbar gesperrt statt still verschwunden.
 *
 * Der Eintrag bleibt ein voll bedienbarer Link — kein Sperr-Attribut, kein Klick-Blocker, kein
 * ausgegrautes Label. `Link` statt `NavLink` ist tragend: ein `NavLink` setzte `aria-current`,
 * während der Nutzer auf einer ganz anderen Seite steht.
 *
 * Das Ziel entsteht aus `targetOf(entry.key)` und wird **genau einmal** mit `encodeURIComponent`
 * kodiert — `URLSearchParams` würde ein zweites Mal kodieren und `safeNext()` in
 * `Settings.jsx`/`guards.jsx` bekäme ein unbrauchbares Ziel.
 *
 * Der Sperr-Hinweis ist ein **Geschwister** des Links, kein Kind: als Kind stünde sein Text
 * im Accessible Name, `aria-describedby` wiederholte ihn als Description und Screenreader läsen
 * „Horoskop Anmelden erforderlich, Anmelden erforderlich".
 * @param {Object} props
 * @param {{key: string}} props.entry - Konfigurationseintrag des gesperrten Rechners
 * @param {'profil'|'anmeldung'} props.state - Sitzungszustand der Rechner
 * @param {function(): void} [props.onNavigate] - Schließt Panel und Gruppen nach dem Klick
 * @returns {JSX.Element} Gesperrter Navigationseintrag
 */
function LockedNavEntry({ entry, state, onNavigate }) {
  const hintId = `nav-hint-${entry.key}`
  const label = labelOf(entry)
  // Vorgeladen wird der Chunk der **tatsächlichen** Zielseite (`/settings` bzw. `/login`), nicht
  // der des gesperrten Rechners. Die Wahl fällt hier im Body, damit der Hook nicht von einer
  // Bedingung des Aufrufers abhängt.
  const prefetchKey = state === 'profil' ? 'settings' : 'login'
  const prefetch = usePrefetchHandlers(prefetchKey)

  if (state === 'profil') {
    return (
      <>
        <Link
          to={'/settings?hinweis=profil&next=' + encodeURIComponent(targetOf(entry.key))}
          className="app-nav-sub-link app-nav-sub-link-locked"
          data-testid={`nav-${entry.key}`}
          data-locked="profil"
          aria-describedby={hintId}
          onClick={onNavigate}
          {...prefetch}
        >
          <span className="app-nav-sub-label">{label}</span>
        </Link>
        <span className="app-nav-lock-hint" id={hintId}>Profil vervollständigen</span>
      </>
    )
  }

  return (
    <>
      <Link
        to={'/login?next=' + encodeURIComponent(targetOf(entry.key))}
        className="app-nav-sub-link app-nav-sub-link-locked"
        data-testid={`nav-${entry.key}`}
        data-locked="anmeldung"
        aria-describedby={hintId}
        onClick={onNavigate}
        {...prefetch}
      >
        <span className="app-nav-sub-label">{label}</span>
      </Link>
      <span className="app-nav-lock-hint" id={hintId}>Anmelden erforderlich</span>
    </>
  )
}

/**
 * Disclosure-Gruppe: ein Knopf mit `aria-expanded` und eine Unterliste, die ausschließlich über
 * `data-open` und CSS auf- und zugeht (kein `hidden`, kein `visibility:hidden`, kein `opacity:0`).
 * Der Knopf trägt `aria-current="true"`, wenn eine der Kindrouten aktiv ist — auch bei
 * geschlossener Gruppe: er ist keine Seite, deshalb nicht `"page"`.
 * @param {Object} props
 * @param {Object} props.entry - Gruppeneintrag aus der Konfiguration
 * @param {boolean} props.isAdmin - Admin-Sichtbarkeit der Kinder
 * @param {'ready'|'loading'|'profil'|'anmeldung'} props.calculatorState - Sitzungszustand der Rechner
 * @param {string|null} props.openGroup - Schlüssel der offenen Gruppe
 * @param {function(string): void} props.onToggle - Öffnen/Schließen
 * @param {function(): void} props.onLogout - Logout-Handler für Aktionen
 * @param {function(): void} [props.onNavigate] - Schließt Panel und Gruppen nach dem Klick
 * @param {function(Element|null): void} [props.buttonRef] - Ref auf den Gruppenknopf (Escape-Fokus)
 * @param {function(Event): void} [props.onGroupBlur] - Fokusverlust der Gruppe
 * @returns {JSX.Element} Gruppen-Listeneintrag
 */
function NavGroup({
  entry,
  isAdmin,
  calculatorState,
  openGroup,
  onToggle,
  onLogout,
  onNavigate,
  buttonRef,
  onGroupBlur,
}) {
  const { pathname } = useLocation()
  const active = isGroupActive(entry.children || [], pathname)
  const open = openGroup === entry.key
  const label = labelOf(entry)
  const keyClass = `app-nav-item-group app-nav-item-group-${entry.key.replace(/^group-/, '')}`
  const buttonClass = active
    ? 'app-nav-link app-nav-group-button app-nav-link-active'
    : 'app-nav-link app-nav-group-button'

  return (
    <li className={keyClass} onBlur={onGroupBlur}>
      <button
        type="button"
        className={buttonClass}
        data-testid={`nav-${entry.key}`}
        ref={buttonRef}
        aria-expanded={open}
        aria-controls={`nav-sub-${entry.key}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onToggle(entry.key)}
      >
        {label}
        <span className="app-nav-caret" aria-hidden="true">▾</span>
      </button>
      {/* Nur ≤ 960 px sichtbar: dort sind die Gruppenknöpfe ausgeblendet und die Unterliste
          erscheint als flache Liste. Reine Orientierung, deshalb nicht interaktiv. */}
      <span className="app-nav-group-heading" aria-hidden="true">{label}</span>
      <ul
        id={`nav-sub-${entry.key}`}
        className="app-nav-subgroup"
        data-open={open ? 'true' : 'false'}
        aria-label={label}
      >
        {visibleChildren(entry, isAdmin).map((childKey) => (
          <li className="app-nav-item" key={childKey}>
            {CALCULATOR_KEYS.includes(childKey) && calculatorState !== 'ready' && calculatorState !== 'loading' ? (
              <LockedNavEntry
                entry={{ key: childKey }}
                state={calculatorState}
                onNavigate={onNavigate}
              />
            ) : (
              <NavItem
                pageKey={childKey}
                label={labelOf({ key: childKey })}
                variant="sub"
                onNavigate={onNavigate}
              />
            )}
          </li>
        ))}
        {(entry.actions || []).map((action) => (
          <li className="app-nav-item" key={action.key}>
            <NavAction action={action} onLogout={onLogout} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * Titelbereich: eine `<h1>` aus dem Routen-`handle` (oder aus dem, was die Seite über
 * `usePageFrame()` hineinreicht) plus der Aktions-Slot. Auf `/` wird der Bereich nicht gerendert,
 * die Bedingung ist der Pfad, nicht ein leerer Titel.
 * @returns {JSX.Element|null} Titelbereich oder `null`
 */
function TitleArea() {
  const frame = usePageFrame()
  const location = useLocation()
  if (!frame || !frame.title) return null
  if (location.pathname === '/') return null

  return (
    <div className="app-title-area">
      <div className="app-title-text">
        <h1 className="app-page-title" data-testid="page-title">{frame.title}</h1>
        {frame.description ? <p className="app-page-subtitle">{frame.description}</p> : null}
      </div>
      {frame.actions ? <div className="app-title-actions" data-testid="page-actions">{frame.actions}</div> : null}
    </div>
  )
}

export default function App() {
  const { profile, initialized } = useAuth()
  // Die Palette folgt der global gewählten Person: `App` liegt unter dem
  // `PersonSelectionProvider` (main.jsx), deshalb ist der Hook hier zulässig. Die Ableitung selbst
  // steckt in `theme/personSign.js`, damit diese Hülle keine zweite Zeichen-Regel trägt.
  const { selectedPerson, selectedPersonId } = usePersonSelection()
  // Sitzungszustand der sechs Rechner. Ohne `initialized` gälte der Kaltstart für einen Frame als
  // „anonym" und das Menü blinkte gesperrt auf.
  const calculatorState = !initialized
    ? 'loading'
    : profile
      ? (profile.birth_year ? 'ready' : 'profil')
      : 'anmeldung'
  const location = useLocation()
  const matches = useMatches()
  const leaf = matches[matches.length - 1]
  const [menuOpen, setMenuOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState(null)
  const mainRef = useRef(null)
  // Grenze für den Außenklick ist das <nav> selbst — nicht das Panel: sonst schlösse ein Klick
  // auf den Menü-Button das Panel sofort wieder.
  const navRef = useRef(null)
  const menuButtonRef = useRef(null)
  // Ein Ref je Gruppenknopf, damit Escape den Fokus an genau den Auslöser zurückgeben kann.
  const groupButtonRefs = useRef({})
  // Zuletzt fokussierter Pfad. Ein `firstRender`-Boolean wäre im `React.StrictMode` der Dev-Umgebung
  // falsch: der Effekt läuft beim Mount zweimal, beim zweiten Lauf stünde `false` und der kalte
  // Direktaufruf bekäme doch den Fokus. Der Pfad-Merker ist in Dev und Prod gleich: gleich
  // gebliebener Pfad → kein Fokus.
  const focusedPathRef = useRef(null)
  // Zeichen, das das Anti-Flash-Skript in `index.html` vor dem ersten Paint angewandt hat: der
  // Merker, sonst `undefined` (= Datumspalette). Einmalig beim Mount gelesen — der Effekt braucht
  // ihn nur als Entscheidungsgrundlage dafür, ob die stehende Palette schon die richtige ist.
  const [bootSign] = useState(readStoredSignMarker)
  // Zuletzt **angewendetes** Zeichen — verhindert doppelte Theme-Arbeit beim StrictMode-Doppelmount
  // im Dev (der Effekt läuft dort zweimal, `applyTheme` soll trotzdem einmal wirken). Startet mit
  // `undefined`, damit der erste Lauf nach der Sitzungsklärung **immer** einmal malt: die
  // Boot-Palette ist nur dann nachweislich richtig, wenn Merker und Zeichen übereinstimmen — und
  // das entscheidet `applyTheme()` (inklusive Admin-Schalter), nicht dieser Ref.
  const appliedSignRef = useRef(undefined)
  // Zuletzt **gemerkter** Wert (`string` oder `null`) — vorbelegt mit dem Boot-Wert, denn genau
  // der steht zu Beginn im Speicher. `undefined` heißt „noch nie geprüft"; nur so räumt der erste
  // Lauf nach der Klärung einen alten Merker auch dann weg, wenn der Besucher anonym ist.
  const storedSignRef = useRef(bootSign === undefined ? undefined : String(bootSign))

  const isAdmin = profile?.isadmin === true
  const isWide = leaf?.handle?.shell === 'wide'

  // Regel der Hülle, nicht des Routers: react-router 7 ignoriert abschließende Schrägstriche beim
  // Matchen (`/wiki/` trifft `path: 'wiki'`). Damit pro Zustand genau eine Adresse existiert,
  // leitet die Hülle jeden Pfad mit Schrägstrich (außer `/`) per `replace` auf die Form ohne
  // Schrägstrich um — Query und Hash bleiben, kein Verlaufseintrag.
  // Zwei Sonderfälle deckt das Ziel ab, damit es immer ein absoluter Pfad ist:
  // `'//'` lässt nach dem Kürzen keinen Pfad übrig (`''`), und `'//foo/'` ergäbe `'//foo'` — das
  // wäre eine protokoll-relative Adresse, die React Router in `history.replaceState` gegen
  // `https://foo/` auflöst und mit `SecurityError` abbricht (leere Hülle). Führende Doppel-Schräg-
  // striche fallen deshalb auf genau einen zusammen; bleibt nichts übrig, greift die Wurzel.
  const trimmedPath = location.pathname.replace(/\/+$/, '')
  const redirectPath = trimmedPath.replace(/^\/{2,}/, '/') || '/'
  const hasTrailingSlash = location.pathname !== '/' && /\/+$/.test(location.pathname)

  // Titel und Description kommen aus dem `handle` der aktiven Route. Seiten mit
  // `dynamicTitle` (z. B. `/wiki/:slug`) setzen ihren Titel selbst — die Hülle hält sich zurück,
  // weil ihr Effekt nach dem der Seite liefe und den Artikeltitel überschriebe.
  // Das Canonical ist self-referencing aus dem **tatsächlichen** Pfad: `page.path` wäre bei
  // `/wiki/:slug` eine Vorlage und landete als Literal in der URL. `redirectPath` ist
  // bereits normalisiert (kein abschließender Schrägstrich, führende Doppelschrägstriche
  // zusammengefasst) und nie leer — kein zweiter Trim.
  useSeoMeta(leaf?.handle?.title, leaf?.handle?.description, leaf?.handle?.dynamicTitle !== true, canonicalForPath(redirectPath))

  // Fokus auf den Hauptbereich bei jedem client-seitigen Wechsel, nicht beim Erstaufruf.
  // Der Effekt hängt am Pfad, damit ein Query-Wechsel (Wiki-Filter) den Fokus nicht aus dem
  // Filterknopf reißt; `keepFocus` erlaubt Aufrufern, ihn ganz auszulassen.
  useEffect(() => {
    if (focusedPathRef.current === location.pathname) return
    const isFirstRender = focusedPathRef.current === null
    focusedPathRef.current = location.pathname
    if (isFirstRender) return
    if (location.state?.keepFocus === true) return
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  // Das Logout-Event bleibt (Entkopplung AuthContext → Hülle), navigiert aber nicht: der Guard
  // leitet geschützte Seiten allein wegen `profile === null` um.
  useEffect(() => {
    const handleLogout = () => {
      setMenuOpen(false)
      setOpenGroup(null)
    }
    window.addEventListener('astronexLogout', handleLogout)
    return () => window.removeEventListener('astronexLogout', handleLogout)
  }, [])

  // Jeder Pfadwechsel (auch Zurück/Vor im Browser) schließt Panel und Gruppen.
  useEffect(() => {
    setMenuOpen(false)
    setOpenGroup(null)
  }, [location.pathname])

  /**
   * Schließt Panel und Gruppe. Jeder Eintrag (Link wie Logout) ruft das beim Klick auf: der
   * Pfadwechsel-Effekt allein reicht nicht, denn ein Klick auf die bereits aktive Seite oder auf
   * einen Eintrag, der auf dieselbe Adresse führt, ändert den `pathname` nicht.
   */
  function closeMenus() {
    setMenuOpen(false)
    setOpenGroup(null)
  }

  // Escape schließt, was offen ist, und gibt den Fokus an den Auslöser zurück — Disclosure-Muster
  // nach APG mit linearer Tab-Reihenfolge, ohne Menü-Rollenmodell und ohne Pfeiltasten-Navigation.
  // Ohne die Rückgabe fiele der Fokus auf <body>.
  useEffect(() => {
    if (!menuOpen && !openGroup) return undefined

    function handleKeyDown(event) {
      // `'Esc'` ist der Alt-Wert von IE11/EdgeHTML für dieselbe Taste, moderne Browser melden `Escape` —
      // der Zweig kostet nichts und hält die beiden Kopien desselben Verhaltens (App + Wiki) deckungsgleich.
      if (event.key !== 'Escape' && event.key !== 'Esc') return
      const opener = openGroup ? groupButtonRefs.current[openGroup] : menuButtonRef.current
      closeMenus()
      opener?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen, openGroup])

  // Ein Zeigerdruck außerhalb von `nav.app-nav` schließt beide Ebenen. Die Grenze liegt bewusst am
  // <nav>: läge sie am Panel, schlösse der Klick auf den Menü-Button das Panel sofort wieder.
  useEffect(() => {
    if (!menuOpen && !openGroup) return undefined

    function handlePointerDown(event) {
      if (navRef.current && !navRef.current.contains(event.target)) closeMenus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen, openGroup])

  // Fokusverlust schließt die Gruppe — aber nur bei einem *vorhandenen* `relatedTarget` außerhalb
  // der Gruppe. Bei `null` fand ein Mausklick auf eine nicht fokussierbare Stelle statt (Polsterung,
  // Hinweiszeile, in WebKit sogar ein Link): ein Schließen würde das Dropdown beim `mousedown`
  // ausblenden und der `click` auf den Eintrag ginge ins Leere. Klicks außerhalb deckt der
  // Außenklick-Effekt ab, Tab-Wechsel haben immer ein `relatedTarget`.
  function handleGroupBlur(event) {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
      setOpenGroup(null)
    }
  }

  // Das Zeichen der Palette kommt aus der gewählten Person, sonst aus dem Profil, sonst aus dem Tag.
  // `loadSavedTheme()` bleibt der einzige Weg, die Admin-Palette zu holen;
  // `applyTheme()` bleibt der einzige Schreiber der `--admin-*`-Variablen (inklusive Admin-Schalter).
  // Der Effekt hängt an Person, Profil und Sitzungszustand: jede Änderung färbt neu.
  //
  // **Vor der Sitzungsklärung malt er nichts**: das Boot-Skript hat den Merker (oder das
  // Tageszeichen) bereits vor dem ersten Paint angewandt. Ein `applyTheme()` mit `pending`-Daten —
  // Person und Profil beide `null` — ersetzte die gemerkte Personenfarbe durch die Datumspalette
  // und erzeugte ein Flackern. Aus demselben Grund wird der Merker erst gepflegt, wenn die
  // Zeichenquelle feststeht.
  useEffect(() => {
    loadSavedTheme().then(() => {
      if (!initialized) return
      // Eine **gespeicherte** Personenauswahl ist noch nicht aufgelöst, weil `/auth/persons` lädt:
      // `selectedPerson` ist dann `null`, obwohl gleich die Personenfarben gelten. Würde hier das
      // Profilzeichen gemalt, sähe man beim Reload zwei Wechsel statt keinem. Die Boot-Palette ist
      // in diesem Fenster bereits das zuletzt angewandte Zeichen — stehen lassen.
      // (Schlägt `/auth/persons` dauerhaft fehl, bleibt es beim Boot-Wert; die Auswahl bleibt
      // erhalten und ein späterer `refreshPersons()` malt wieder korrekt.)
      const selectionPending =
        Boolean(profile) && selectedPersonId !== null && selectedPerson === null
      if (selectionPending) return
      const nextSignIndex = signIndexForPerson({ selectedPerson, profile })
      if (appliedSignRef.current !== nextSignIndex) {
        appliedSignRef.current = nextSignIndex
        applyTheme(nextSignIndex)
      }
      // Der Merker wird erst nach `initialized` gepflegt: vorher ist `profile` noch unbekannt und
      // das Tageszeichen der `pending`-Phase würde den nächsten Start färben.
      // `storedSignRef` trägt den Boot-Wert, damit ein unveränderter Merker nicht neu geschrieben
      // wird — und ein anonymer Besucher seinen alten Merker trotzdem loswird.
      const marker = signMarkerFor({ selectedPerson, profile })
      if (marker === storedSignRef.current) return
      storedSignRef.current = marker
      // `null` heißt: weder Person noch Profil tragen ein Geburtsjahr — dann wird der Merker
      // **gelöscht**, nicht geschrieben. Ein gemerktes Tageszeichen malte nach einem Datumswechsel
      // die gestrige Palette, bis React sie korrigiert. Ein gesperrter Speicher darf die
      // Seite nicht unthemed lassen, deshalb derselbe `try/catch` wie im Boot-Skript.
      try {
        if (marker === null) {
          localStorage.removeItem(THEME_SIGN_STORAGE_KEY)
        } else {
          localStorage.setItem(THEME_SIGN_STORAGE_KEY, marker)
        }
      } catch (_) {
        /* Speicher gesperrt — die Palette steht trotzdem. */
      }
    })
  }, [selectedPerson, selectedPersonId, profile, initialized])


  async function logout() {
    try {
      await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' })
    } catch (_) {
      // Ignore network issues during logout cleanup.
    }
    clearStoredSession()
    localStorage.removeItem('username')
    // Der Theme-Merker steckt in `clearStoredSession()` — nach dem Logout gilt wieder das
    // Tageszeichen, und kein Logout-Pfad kann die Zeile vergessen.
    window.dispatchEvent(new Event('astronexLogout'))
    // Ein frischer Router ist die einzige echte Recovery nach dem Logout.
    window.location.reload()
  }

  function toggleGroup(key) {
    setOpenGroup((current) => (current === key ? null : key))
  }

  // „Startseite" und „Wiki" sind Menüpunkte wie alle anderen: im Mobile-Panel stehen sie deshalb
  // unter der Rubrik „Allgemein" und bekommen dieselbe Zeilen-Optik wie die Untermenü-Einträge.
  // Auf dem Balken (Desktop) bleiben sie inline — die Überschrift ist per CSS nur ≤ 960 px sichtbar.
  const primaryPages = NAV_PRIMARY.filter((entry) => entry.kind !== 'group')
  const primaryGroups = NAV_PRIMARY.filter((entry) => entry.kind === 'group')

  return (
    <div>
      {/* Erstes fokussierbares Element der Seite. `preventDefault` + `focus()` statt
          Hash-Sprung: ein `#main`-Sprung erzeugte im SPA-Router einen Verlaufseintrag und eine
          Location-Änderung, die Fokus-Effekt und `ScrollRestoration` mitlesen. */}
      <a
        className="app-skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <div className="app-nav-wrap">
          <nav className="app-nav" aria-label="Hauptnavigation" ref={navRef}>
            {/* Schriftzug im Balken: mobil ist er hier mittig über dem Balken platziert, auf dem
                Desktop übernimmt das `<li className="app-nav-brand">` in der Menüliste. Rein
                dekorativ (`aria-hidden`) — der Seitenname steht im Titel und im Footer. */}
            <span className="app-nav-brand-mobile" aria-hidden="true">Astro-Magister</span>
            <button
              type="button"
              className="app-nav-menu-button"
              data-testid="nav-menu-button"
              ref={menuButtonRef}
              aria-expanded={menuOpen}
              aria-controls="nav-panel"
              aria-label="Menü"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
            </button>
            <ul
              id="nav-panel"
              data-testid="nav-panel"
              className="app-nav-panel"
              data-open={menuOpen ? 'true' : 'false'}
            >
              {primaryPages.length > 0 && (
                <li className="app-nav-item-group app-nav-item-group-allgemein">
                  <span className="app-nav-group-heading" aria-hidden="true">Allgemein</span>
                  <ul className="app-nav-inline-list" aria-label="Allgemein">
                    {primaryPages.map((entry) => (
                      <li className="app-nav-item" key={entry.key}>
                        <NavItem
                          pageKey={entry.key}
                          label={labelOf(entry)}
                          end={entry.end}
                          onNavigate={closeMenus}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {primaryGroups.map((entry) => (
                <NavGroup
                  key={entry.key}
                  entry={entry}
                  isAdmin={isAdmin}
                  calculatorState={calculatorState}
                  openGroup={openGroup}
                  onToggle={toggleGroup}
                  onLogout={logout}
                  onNavigate={closeMenus}
                  buttonRef={(el) => { groupButtonRefs.current[entry.key] = el }}
                  onGroupBlur={handleGroupBlur}
                />
              ))}
              {/* Desktop: zwischen den linken Gruppen und dem Kontobereich, über `margin:auto`
                  mittig im freien Raum. */}
              <li className="app-nav-brand" aria-hidden="true">Astro-Magister</li>
              {calculatorState === 'loading' ? (
                // Bis die Sitzung geklärt ist, steht rechts nur ein Platzhalter: `NAV_ACCOUNT`
                // würde anonyme Besucher kurz als angemeldet zeigen, `NAV_ANON` umgekehrt die
                // angemeldeten. Die Mindestbreite hält den Platz, damit die fertige Gruppe nicht
                // springt.
                <li
                  className="app-nav-item-group app-nav-item-group-konto app-nav-account-loading"
                  aria-hidden="true"
                />
              ) : profile ? (
                <>
                  {NAV_ACCOUNT_LINKS.filter((entry) => !entry.adminOnly || isAdmin).map((entry) => (
                    // Eigener Knopf links neben „Konto": `to` kommt aus `targetOf`,
                    // nicht aus `pages[key].path` — der enthält die optionale `:tab?`-Strecke.
                    <li className="app-nav-item app-nav-account-item" key={entry.key}>
                      <NavItem
                        pageKey={entry.key}
                        to={targetOf(entry.key)}
                        label={labelOf(entry)}
                        onNavigate={closeMenus}
                      />
                    </li>
                  ))}
                  <NavGroup
                    entry={NAV_ACCOUNT[0]}
                    isAdmin={isAdmin}
                    calculatorState={calculatorState}
                    openGroup={openGroup}
                    onToggle={toggleGroup}
                    onLogout={logout}
                    onNavigate={closeMenus}
                    buttonRef={(el) => { groupButtonRefs.current[NAV_ACCOUNT[0].key] = el }}
                    onGroupBlur={handleGroupBlur}
                  />
                </>
              ) : (
                // Anonym stehen Login und Registrieren auf oberster Ebene; die Überschrift
                // „Konto" ist reine Mobil-Zutat und per CSS nur ≤ 960 px sichtbar.
                <li className="app-nav-item-group app-nav-item-group-anon">
                  <span className="app-nav-group-heading" aria-hidden="true">Konto</span>
                  <ul className="app-nav-anon-list" aria-label="Konto">
                    {NAV_ANON.map((entry) => (
                      <li className="app-nav-item" key={entry.key}>
                        <NavItem
                          pageKey={entry.key}
                          label={labelOf(entry)}
                          end={entry.end}
                          onNavigate={closeMenus}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="app-content-stage" tabIndex={-1} ref={mainRef}>
        <div className={isWide ? 'app-page-shell app-page-shell-wide' : 'app-page-shell'}>
          {hasTrailingSlash ? (
            <Navigate
              to={{
                pathname: redirectPath,
                search: location.search,
                hash: location.hash,
              }}
              replace
            />
          ) : (
            <PageFrameProvider title={leaf?.handle?.title} description={leaf?.handle?.description}>
              <TitleArea />
              {isWide ? <Outlet /> : <section className="app-page-panel"><Outlet /></section>}
            </PageFrameProvider>
          )}
        </div>
      </main>
      {/* Außerhalb von `<main>`: nur so ist der Footer ein eigenes `contentinfo`-Landmark.
          Die Gruppen-Überschriften sind `<p>`, keine `<h*>`, damit die Dokumentgliederung beim
          Titelbereich bleibt. */}
      <footer className="app-footer" data-testid="site-footer">
        <div className="app-footer-groups">
          <nav className="app-footer-group" aria-labelledby="footer-legal">
            <p className="app-footer-heading" id="footer-legal">Rechtliches</p>
            <ul>
              {FOOTER_LINKS.map((link) => (
                <li key={link.to}>
                  <Link className="app-footer-link" to={link.to}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="app-footer-group" role="group" aria-labelledby="footer-support">
            <p className="app-footer-heading" id="footer-support">Unterstützen</p>
            <ul>
              {EXTERNAL_FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    className="app-footer-link"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                    <span aria-hidden="true">↗</span>
                    <span className="app-visually-hidden">(öffnet in neuem Tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="app-footer-copy">© {new Date().getFullYear()} Astro-Magister</p>
      </footer>
      <ScrollRestoration />
    </div>
  )
}

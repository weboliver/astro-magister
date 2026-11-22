/**
 * Dashboard — die öffentliche Startseite (`/`).
 *
 * Die Seite ist ausschließlich die Ausgabe von `GET /wiki/home-cards`: Titel, Bereich,
 * Kategorie, ungekürzter Kurztext und Cover kommen aus der kuratierten Kartenliste, die
 * Sichtbarkeit entscheidet der Endpunkt — hier wird nichts nachgefiltert. CMS-Freitext geht als
 * React-Textknoten ins DOM, der Artikel-Link ist ein einfaches `<a>` mit abschließendem
 * Schrägstrich (kein Router-`<Link>` für das statische Wiki).
 *
 * @component
 * @returns {JSX.Element} Startseite mit Listenlandmark
 * @hook useState - Karten, Lade- und Fehlerzustand der Liste
 * @hook useEffect - Ruft die Karten beim Mount ab, unabhängig vom Sitzungszustand
 * @hook useAuth - Liefert `profile`/`initialized` für den Sitzungsanker `data-session`
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import PersonSelector from '../components/PersonSelector'
import { pages } from '../routing/pages'
import { get } from '../services/api'
import { DEFAULT_COVER_URL } from '../services/covers'

/** Meldung der Liste im Fehlerfall — ohne Statuscode im Text. */
const LOAD_ERROR_MESSAGE = 'Beiträge konnten nicht geladen werden.'

/** Meldung der Liste, wenn der Endpunkt keine Zeile liefert. */
const EMPTY_MESSAGE = 'Zurzeit sind keine Beiträge ausgewählt.'

/**
 * Profil-Hinweis im Personenbereich.
 *
 * Du-Form, Wortlaut identisch zum Banner in `/settings?hinweis=profil`.
 */
const PROFILE_HINT_MESSAGE = 'Bitte vervollständige dein Profil, um die Rechner zu nutzen.'

/** Label der Personenauswahl auf `/` — Bestand aus `PersonSelector`, hier nur durchgereicht. */
const PERSON_LABEL = 'Person für Berechnungen'

/** Hilfetext der Personenauswahl auf `/` — Bestand aus `PersonSelector`. */
const PERSON_HELPER = 'Wähle eine gespeicherte Person oder nutze dein Profil'

/**
 * Fällt beim Bildfehler **einmalig** auf das Standardbild zurück.
 *
 * Der Merker im `dataset` ist nötig, weil der Browser `src` nach dem ersten Fehlschlag bereits
 * absolut aufgelöst hat — ein Vergleich des Attributs gegen die Konstante wäre unzuverlässig.
 * Nach dem zweiten Fehler bleibt die 200 × 105-Fläche in `--admin-panel-strong` stehen: kein
 * Text, kein Layoutsprung, keine Endlosschleife.
 * @param {Event} event - `error`-Ereignis des Zeilenbildes
 * @returns {void}
 */
function handleCoverError(event){
  const image = event.currentTarget
  if (!image || image.dataset.coverFallback === '1') return
  image.dataset.coverFallback = '1'
  image.src = DEFAULT_COVER_URL
}

/**
 * Startseite: kuratierte Liste plus Sitzungsanker.
 * @returns {JSX.Element} Gerendertes Seitenfragment
 */
export default function Dashboard(){
  const { profile, initialized } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Fokus-Ziel nach einem Wiederholungs-Abruf: ohne diese Rückgabe fiele
  // der Tastaturfokus beim Verschwinden des Retry-Knopfes auf `<body>`.
  const listRef = useRef(null)
  // Einhänge-Merker für den manuell ausgelösten zweiten Abruf. Der Mount-Abruf nutzt weiterhin eine
  // lokale Closure-Variable; beide lesen dieselbe Abschaltbedingung.
  const activeRef = useRef(true)

  /**
   * Lädt die kuratierten Karten. `isActive()` meldet, ob die Komponente noch eingehängt ist, damit
   * ein später eintreffendes Ergebnis keinen abgeräumten Zustand setzt (Muster aus `Wiki.jsx`).
   * Dieselbe Funktion ist der Wiederholungs-Abruf nach einem Fehler.
   * @param {function(): boolean} isActive - Prüft, ob das Ergebnis noch gesetzt werden darf
   * @returns {Promise<void>} erledigt, sobald Zustand oder Fehler gesetzt ist
   */
  async function load(isActive){
    setLoading(true)
    setError('')
    try{
      const resp = await get('/wiki/home-cards', false)
      if (!resp.ok) throw new Error(LOAD_ERROR_MESSAGE)
      const data = await resp.json()
      if (isActive()) setCards(Array.isArray(data) ? data : [])
    }catch{
      if (isActive()) {
        setCards([])
        setError(LOAD_ERROR_MESSAGE)
      }
    }finally{
      if (isActive()) setLoading(false)
    }
  }

  useEffect(() => {
    activeRef.current = true
    // Öffentlicher Abruf: kein Warten auf `initialized`.
    load(() => activeRef.current)
    return () => {
      activeRef.current = false
    }
    // Nur beim Mount — die Liste hängt an keinem Sitzungszustand.
  }, [])

  /**
   * Wiederholungs-Abruf nach einem Fehler.
   *
   * Setzt über `load()` zuerst `loading`, damit der Skeleton erscheint, holt die Karten erneut —
   * `load()` ruft `get('/wiki/home-cards', false)` auf, also **ohne** Auth-Retry — und setzt danach
   * den Fokus auf den Listencontainer. Scheitert der zweite Versuch, steht die Meldung wieder da.
   * @returns {Promise<void>} erledigt, sobald der zweite Abruf abgeschlossen und der Fokus gesetzt ist
   */
  async function handleRetry(){
    await load(() => activeRef.current)
    if (activeRef.current) listRef.current?.focus()
  }

  // Zeilen ohne Slug haben kein Ziel und werden nicht gerendert.
  const rows = useMemo(
    () => cards.filter((card) => Boolean(card && card.slug)),
    [cards],
  )

  /**
   * Die drei jüngsten **datierten** Zeilen der angezeigten Liste tragen „Neu".
   * Undatierte (`entry_published` null/leer) fliegen raus, bei Gleichstand gewinnt der frühere
   * Listenplatz — der Vergleich fällt auf den ursprünglichen Index zurück, damit die Rangfolge
   * stabil bleibt. Kein Vergleich mit „heute", kein Serverfeld, keine neue Abhängigkeit.
   */
  const badgeIndexes = useMemo(() => {
    const dated = rows
      .map((card, index) => ({ index, published: card.entry_published || '' }))
      .filter((row) => Boolean(row.published))
      .sort((a, b) => {
        if (a.published === b.published) return a.index - b.index
        return a.published < b.published ? 1 : -1
      })
    return new Set(dated.slice(0, 3).map((row) => row.index))
  }, [rows])

  const listState = loading ? 'loading' : (error ? 'error' : (rows.length ? 'ready' : 'empty'))

  // Ein Zustand, drei Ableitungen: der Anker `data-session` und der Kopfblock lesen dieselbe Quelle,
  // damit nie CTA und Personenbereich gleichzeitig (oder nach der Klärung keiner) erscheinen.
  const sessionState = profile ? 'authenticated' : (initialized ? 'anonymous' : 'pending')

  return (
    <div
      className="home-page"
      data-testid="dashboard"
      data-session={sessionState}
    >
      {/* Die Hülle rendert auf `/` bewusst keinen Titelbereich. Für die Dokumentgliederung
          braucht die Startseite trotzdem eine h1 — sichtbar bleibt sie nicht. */}
      <h1 className="app-visually-hidden">{pages.home.meta.title}</h1>

      {/* Genau ein Kopfblock je Sitzungszustand.
          Anonyme: ruhige CTA-Zeile, kein Fließtext, keine Überschrift — und
          ausdrücklich **keine** gesperrte Personenauswahl. */}
      {sessionState === 'anonymous' ? (
        <div className="home-cta" data-testid="home-cta">
          <Link
            to={pages.register.path}
            className="admin-primary-button"
            data-testid="home-cta-register"
          >Registrieren</Link>
          <Link
            to={pages.login.path}
            className="admin-secondary-button"
            data-testid="home-cta-login"
          >Einloggen</Link>
        </div>
      ) : null}

      {/* Eingeloggte: Profil-Hinweis nur bei unvollständigem Profil, die Personenauswahl immer.
          `PersonSelector` bleibt unverändert. */}
      {sessionState === 'authenticated' ? (
        <div className="home-personal" data-testid="home-personal">
          {!profile.birth_year ? (
            <p className="home-profile-hint" data-testid="home-profile-hint">
              {PROFILE_HINT_MESSAGE}{' '}
              <Link to="/settings?hinweis=profil">Zum Profil</Link>
            </p>
          ) : null}
          <PersonSelector label={PERSON_LABEL} helperText={PERSON_HELPER} />
        </div>
      ) : null}

      {/* Vor der Sitzungsklärung reserviert ein leerer Platzhalter die Höhe der CTA-Zeile, damit
          der Kopfblock ohne Layoutsprung erscheint (44 px Tap-Ziel-Regel). */}
      {sessionState === 'pending' ? <div className="home-head-placeholder" aria-hidden="true" /> : null}

      <section
        className="home-list"
        data-testid="home-list"
        data-state={listState}
        aria-label="Ausgewählte Beiträge"
        aria-busy={loading ? 'true' : 'false'}
        tabIndex={-1}
        ref={listRef}
      >
        {/* Laden: drei Skeleton-Zeilen im Raster einer echten Zeile statt eines
            Spinner-Textes. Für Screenreader steht der Zustand in der versteckten Statuszeile. */}
        {listState === 'loading' ? (
          <>
            <ul
              className="home-list-items home-list-skeleton"
              data-testid="home-list-skeleton"
              role="list"
              aria-hidden="true"
            >
              {[0, 1, 2].map((index) => (
                <li key={index} className="home-row home-row-skeleton" aria-hidden="true">
                  <div className="home-row-text">
                    <div className="home-skeleton-bar home-skeleton-title" />
                    <div className="home-skeleton-bar home-skeleton-meta" />
                    <div className="home-skeleton-bar home-skeleton-line" />
                    <div className="home-skeleton-bar home-skeleton-line-short" />
                  </div>
                  <div className="wiki-cover-thumb home-skeleton-cover" aria-hidden="true" />
                </li>
              ))}
            </ul>
            <p className="app-visually-hidden" role="status">Beiträge werden geladen</p>
          </>
        ) : null}
        {listState === 'ready' ? (
          <ul className="home-list-items" role="list">
            {rows.map((card, index) => {
              // Eingeloggte landen im App-Wiki beim selben Eintrag (`?artikel=`, mit beiden
              // Filterparametern wie der Kategorie-Link); Anonyme auf der öffentlichen
              // Astro-Seite, weil `/wiki` sie erst zur Anmeldung schickt.
              const inAppWiki = sessionState === 'authenticated' && Boolean(card.entry_id)
              const articleHref = inAppWiki
                ? '/wiki?' +
                  (card.section_id ? 'bereich=' + card.section_id + '&' : '') +
                  (card.category_id ? 'kategorie=' + card.category_id + '&' : '') +
                  'artikel=' + card.entry_id
                : '/astro-wiki/' + String(card.slug) + '/'
              const sectionName = card.section_name ? String(card.section_name) : ''
              const categoryName = card.category_name ? String(card.category_name) : ''
              // Der Kategorie-Link braucht **beide** Parameter, sonst fällt der Filter still weg.
              const sectionHref = sectionName && card.section_id
                ? '/wiki?bereich=' + card.section_id
                : ''
              const categoryHref = categoryName && card.category_id && card.section_id
                ? '/wiki?bereich=' + card.section_id + '&kategorie=' + card.category_id
                : ''
              return (
                <li
                  key={card.entry_id}
                  className="home-row"
                  data-testid="home-row"
                  data-entry-id={card.entry_id}
                >
                  <div className="home-row-text">
                    <h2 className="home-row-title">
                      {inAppWiki
                        ? <Link to={articleHref} data-testid="home-row-title">{card.entry_name}</Link>
                        : <a href={articleHref} data-testid="home-row-title">{card.entry_name}</a>}
                      {badgeIndexes.has(index) ? (
                        <span className="home-badge-new" data-testid="home-badge-new">Neu</span>
                      ) : null}
                    </h2>
                    {sectionName || categoryName ? (
                      <p className="home-row-meta">
                        {sectionName ? (
                          sectionHref
                            ? <Link to={sectionHref} data-testid="home-row-section">{sectionName}</Link>
                            : sectionName
                        ) : null}
                        {categoryName ? (
                          <>
                            {sectionName ? <span aria-hidden="true">·</span> : null}
                            {categoryHref
                              ? <Link to={categoryHref} data-testid="home-row-category">{categoryName}</Link>
                              : categoryName}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {card.entry_short ? <p className="home-row-short">{card.entry_short}</p> : null}
                  </div>
                  {/* Zweiter Weg zum selben Ziel, aus der Tab-Reihenfolge und dem
                      Accessibility-Baum genommen: eine Zeile = ein Tab-Stopp. */}
                  {inAppWiki
                    ? (
                      <Link className="home-row-cover" to={articleHref} tabIndex={-1} aria-hidden="true">
                        <img
                          className="wiki-cover-thumb"
                          src={card.cover_url || DEFAULT_COVER_URL}
                          alt=""
                          width="200"
                          height="105"
                          loading={index < 3 ? 'eager' : 'lazy'}
                          decoding="async"
                          onError={handleCoverError}
                        />
                      </Link>
                    )
                    : (
                      <a className="home-row-cover" href={articleHref} tabIndex={-1} aria-hidden="true">
                        <img
                          className="wiki-cover-thumb"
                          src={card.cover_url || DEFAULT_COVER_URL}
                          alt=""
                          width="200"
                          height="105"
                          loading={index < 3 ? 'eager' : 'lazy'}
                          decoding="async"
                          onError={handleCoverError}
                        />
                      </a>
                    )}
                </li>
              )
            })}
          </ul>
        ) : null}
        {listState === 'error' ? (
          <div className="home-list-message" data-testid="home-list-error" role="status">
            <p>{error || LOAD_ERROR_MESSAGE}</p>
            {/* Neutral: kein Statuscode, kein Stacktrace, keine Warnfarbe im Text. */}
            <button
              type="button"
              className="admin-secondary-button"
              data-testid="home-list-retry"
              onClick={handleRetry}
            >Erneut versuchen</button>
          </div>
        ) : null}
        {listState === 'empty' ? (
          <div className="home-list-message" data-testid="home-list-empty">
            <p>{EMPTY_MESSAGE}</p>
            <Link to="/wiki">Zum Wiki</Link>
          </div>
        ) : null}
      </section>
    </div>
  )
}

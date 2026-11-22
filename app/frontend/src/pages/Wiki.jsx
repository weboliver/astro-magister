/**
 * Wiki - Wiki-Inhalte: Artikel unter `/wiki/<slug>`, Liste mit Filtern unter `/wiki`
 * @component
 * @description Der gesamte Seitenzustand kommt aus der Adresse: `:slug` wählt den Artikel
 *              (`GET /wiki/by-slug/{slug}`), `?bereich=`/`?kategorie=` wählen die Filter der
 *              Liste, `?artikel=<id>` den aufgeklappten Listeneintrag. Filter- und Aufklapp-Wechsel
 *              laufen über `setSearchParams(..., { replace: true, preventScrollReset: true })` —
 *              kein Verlaufseintrag pro Klick und kein Sprung nach oben.
 *              Rechtstexte haben eigene Routen (`LegalPage`), der frühere Direktmodus ist samt
 *              seinen Props entfallen. Die Sichtbarkeit verwandter Einträge hängt ausschließlich
 *              an `profile`, nicht an einem gespeicherten Token.
 *              Die Cover sind reine Anzeige der Serverfelder `cover_url`/`cover_alt`:
 *              links im Kartenkopf steht der Text, rechts das dekorative 200 × 105-Bild (`alt=""`),
 *              im aufgeklappten Eintrag und im Artikelkopf der 400 × 210-Banner mit sprechendem
 *              Alt-Text. Kein Pfad entsteht hier — nur `|| DEFAULT_COVER_URL` als Rückfall.
 * @hook useParams - `:slug` der Artikel-Route (`/wiki/:slug`)
 * @hook useSearchParams - `?bereich=`, `?kategorie=`, `?artikel=`
 * @hook useNavigate - Navigation zu verwandten Einträgen, Editor und Login
 * @hook useLocation - aktueller Pfad für `?next=` beim Login-Sprung
 * @hook useEffect - Artikel, Liste, nachgeladener Einzeleintrag, verwandte Einträge
 * @hook useMemo - abgeleitete Filter (Bereich, Kategorien, aktive Kategorie)
 * @hook useAuth - `profile` steuert verwandte Einträge und den Admin-Knopf
 * @returns {JSX.Element} Gerenderte Wiki-Seite
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import MarkdownArticle from '../components/MarkdownArticle'
import { useSeoMeta } from '../hooks/useSeoMeta'
import { usePageFrame } from '../routing/pageFrame'
import { pages } from '../routing/pages'
import { get } from '../services/api'
import { canonicalForWikiEntry } from '../services/canonical'
import { DEFAULT_COVER_URL } from '../services/covers'

const LOGIN_REQUIRED_MESSAGE = 'Keine Berechtigung - loggen Sie sich zuerst ein'
const ARTICLE_NOT_FOUND_MESSAGE = 'Artikel nicht gefunden'
/** Untertitel im Artikelmodus: „Erläuterungen: <Titel>“ (ersetzt „Artikel aus dem astrologischen Wiki“). */
const articleSubtitle = (name) => `Erläuterungen: ${name}`
const WIKI_TITLE = pages.wiki.meta.title
const WIKI_DESCRIPTION = pages.wiki.meta.description

/**
 * Bild-Fehlerpfad der drei Cover-Flächen: fällt **genau einmal** auf das Standardbild
 * zurück. Der Merker sitzt am Element (wie in `Dashboard.jsx`), nicht an einer gerenderten
 * URL — sonst liefe der Rückfall bei jedem erneuten Fehlschlag erneut und die Fläche würde
 * zwischen zwei Quellen flackern. Nach dem zweiten Fehlschlag bleibt die feste Fläche des Bildes
 * stehen (`background: var(--admin-panel-strong)`), ohne Text und ohne Layoutsprung.
 * @param {React.SyntheticEvent<HTMLImageElement>} event - Fehler-Ereignis des `<img>`
 * @returns {void}
 */
function handleCoverError(event){
  const image = event.currentTarget
  if (!image || image.dataset.coverFallback === '1') return
  image.dataset.coverFallback = '1'
  image.src = DEFAULT_COVER_URL
}

function createRequestError(status, message){
  const error = new Error(message)
  error.status = status
  return error
}

function scrollWindowToTop(){
  if (typeof window === 'undefined') return
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * Liest eine positive Ganzzahl aus einem Query-Wert.
 * `Number('quatsch')` ergibt `NaN`, und `NaN > 0` ist `false` — deshalb prüft der Helfer
 * explizit auf eine ganze Zahl (unbekannte Werte werden ignoriert, nicht weitergereicht).
 * @param {string|null} value - Rohwert aus der Adresse
 * @returns {number} ID oder 0
 */
function readEntryId(value){
  const parsed = Number(value || 0)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export default function Wiki(){
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const bereich = searchParams.get('bereich') || ''
  const kategorie = searchParams.get('kategorie') || ''
  const artikelId = readEntryId(searchParams.get('artikel'))

  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [article, setArticle] = useState(null)
  const [detachedEntry, setDetachedEntry] = useState(null)
  const [relatedEntriesByEntryId, setRelatedEntriesByEntryId] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState({ message: '', requiresLogin: false })

  const isArticleMode = Boolean(slug)
  const isAdmin = Boolean(profile?.isadmin)
  const canShowRelatedEntries = Boolean(profile)

  const wikiSectionIds = useMemo(() => new Set(sections.map((section) => Number(section.section_id))), [sections])

  // Abgeleitete Filter: die Adresse gewinnt, sonst der erste Bereich/die erste Kategorie.
  // Nichts davon wird zurück in die URL geschrieben — ein reiner Standardwert ist kein
  // Zustandswechsel und darf die History nicht anfassen.
  const activeSectionId = useMemo(() => {
    if (bereich && wikiSectionIds.has(Number(bereich))) return String(bereich)
    return sections[0] ? String(sections[0].section_id) : ''
  }, [bereich, sections, wikiSectionIds])

  const filteredCategories = useMemo(() => {
    if (!activeSectionId) return []
    return categories.filter((category) => {
      const sectionId = Number(category.section_id)
      return wikiSectionIds.has(sectionId) && sectionId === Number(activeSectionId)
    })
  }, [activeSectionId, categories, wikiSectionIds])

  const activeCategoryId = useMemo(() => {
    if (kategorie && filteredCategories.some((category) => String(category.category_id) === String(kategorie))) {
      return String(kategorie)
    }
    return filteredCategories[0] ? String(filteredCategories[0].category_id) : ''
  }, [filteredCategories, kategorie])

  const selectedCategory = filteredCategories.find((category) => String(category.category_id) === String(activeCategoryId))

  function setRequestError(errorValue, fallbackMessage){
    if (Number(errorValue?.status) === 401){
      setError({ message: LOGIN_REQUIRED_MESSAGE, requiresLogin: true })
      return
    }
    setError({ message: errorValue?.message || fallbackMessage, requiresLogin: false })
  }

  function navigateToLogin(){
    // Der Rückweg führt auf den aktuellen Artikel bzw. die gefilterte Liste, nicht pauschal
    // auf `/wiki`; `safeNext` prüft das Ziel gegen die Routentabelle.
    navigate('/login?next=' + encodeURIComponent(location.pathname + location.search))
  }

  function navigateToRelatedEntry(relatedEntry){
    if (!relatedEntry?.slug) return
    navigate('/wiki/' + encodeURIComponent(relatedEntry.slug))
  }

  async function loadSections(){
    try{
      const resp = await get('/wiki/sections?wiki_active_only=true')
      if (!resp.ok) throw createRequestError(resp.status, `Bereiche konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(err){
      setSections([])
      setRequestError(err, 'Bereiche konnten nicht geladen werden')
    }
  }

  async function loadCategories(){
    try{
      const resp = await get('/wiki/categories')
      if (!resp.ok) throw createRequestError(resp.status, `Kategorien konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setCategories(Array.isArray(data) ? data : [])
    }catch(err){
      setCategories([])
      setRequestError(err, 'Kategorien konnten nicht geladen werden')
    }
  }

  async function loadEntries(filters = {}){
    setLoading(true)
    setError({ message: '', requiresLogin: false })
    try{
      const params = new URLSearchParams({ limit: '20', wiki_active_only: 'true' })
      if (filters.section_id) params.set('section_id', String(filters.section_id))
      if (filters.category_id) params.set('category_id', String(filters.category_id))
      const resp = await get(`/wiki/entries?${params.toString()}`)
      if (!resp.ok) throw createRequestError(resp.status, `Beiträge konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setEntries(Array.isArray(data) ? data : [])
    }catch(err){
      setEntries([])
      setRequestError(err, 'Beiträge konnten nicht geladen werden')
    }finally{
      setLoading(false)
    }
  }

  async function loadRelatedEntries(entryId){
    const normalizedEntryId = Number(entryId)
    if (!normalizedEntryId || !canShowRelatedEntries) return []

    const [fromResponse, toResponse] = await Promise.all([
      get(`/wiki/relations?entry_from_id=${normalizedEntryId}`),
      get(`/wiki/relations?entry_to_id=${normalizedEntryId}`),
    ])

    if (!fromResponse.ok) throw createRequestError(fromResponse.status, `Verknüpfungen konnten nicht geladen werden (${fromResponse.status})`)
    if (!toResponse.ok) throw createRequestError(toResponse.status, `Verknüpfungen konnten nicht geladen werden (${toResponse.status})`)

    const [fromRelations, toRelations] = await Promise.all([fromResponse.json(), toResponse.json()])
    const relatedIds = Array.from(new Set([
      ...(Array.isArray(fromRelations) ? fromRelations.map((relation) => Number(relation.entry_to_id)) : []),
      ...(Array.isArray(toRelations) ? toRelations.map((relation) => Number(relation.entry_from_id)) : []),
    ].filter((relatedId) => relatedId && relatedId !== normalizedEntryId)))

    if (!relatedIds.length) return []

    const entryResponses = await Promise.all(relatedIds.map((relatedId) => get(`/wiki/entries/${relatedId}`)))
    const relatedEntries = []

    for (const response of entryResponses){
      if (!response.ok) {
        if (response.status === 401) continue
        throw createRequestError(response.status, `Verknüpfte Beiträge konnten nicht geladen werden (${response.status})`)
      }
      const relatedEntry = await response.json()
      if (relatedEntry?.entry_id && Number(relatedEntry.entry_id) !== normalizedEntryId) {
        relatedEntries.push(relatedEntry)
      }
    }

    return relatedEntries.sort((left, right) => {
      const numberDelta = Number(left.entry_number || 0) - Number(right.entry_number || 0)
      if (numberDelta !== 0) return numberDelta
      return String(left.entry_name || '').localeCompare(String(right.entry_name || ''), 'de')
    })
  }

  /** Setzt Filter/Aufklapp-Zustand in der Adresse — ohne Verlaufseintrag und ohne Scroll-Sprung. */
  function applySearchParams(mutate, options = { replace: true, preventScrollReset: true }){
    const next = new URLSearchParams(searchParams)
    mutate(next)
    setSearchParams(next, options)
  }

  function selectSection(sectionId){
    const nextSectionId = String(sectionId)
    const nextSectionCategories = categories.filter((category) => String(category.section_id) === nextSectionId)
    applySearchParams((next) => {
      next.set('bereich', nextSectionId)
      if (nextSectionCategories[0]) next.set('kategorie', String(nextSectionCategories[0].category_id))
      else next.delete('kategorie')
      next.delete('artikel')
    })
  }

  function selectCategory(categoryId){
    applySearchParams((next) => {
      next.set('kategorie', String(categoryId))
      next.delete('artikel')
    })
  }

  function toggleExpandedEntry(entryId){
    const normalizedEntryId = Number(entryId)
    if (!normalizedEntryId) return
    applySearchParams((next) => {
      if (Number(artikelId) === normalizedEntryId) next.delete('artikel')
      else next.set('artikel', String(normalizedEntryId))
    })
  }

  // Liste: Bereiche und Kategorien werden nur im Listenmodus gebraucht.
  useEffect(() => {
    if (isArticleMode) return
    loadSections()
    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArticleMode])

  // Artikelmodus: der Slug ist die einzige Quelle, nie ein `find()` über die Liste.
  useEffect(() => {
    if (!slug) {
      setArticle(null)
      return undefined
    }

    let active = true
    setArticle(null)
    setError({ message: '', requiresLogin: false })
    setLoading(true)
    scrollWindowToTop()

    get('/wiki/by-slug/' + encodeURIComponent(slug))
      .then(async (resp) => {
        if (!resp.ok) {
          if (resp.status === 404) throw createRequestError(404, ARTICLE_NOT_FOUND_MESSAGE)
          throw createRequestError(resp.status, `Artikel konnte nicht geladen werden (${resp.status})`)
        }
        return resp.json()
      })
      .then((data) => {
        if (active) setArticle(data && typeof data === 'object' ? data : null)
      })
      .catch((err) => {
        if (!active) return
        setRequestError(err, 'Artikel konnte nicht geladen werden')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [slug])

  // Liste: der Ladevorgang hängt an den Filtern aus der Adresse, nicht an lokalem Zustand.
  useEffect(() => {
    if (isArticleMode) return
    if (!activeSectionId || !activeCategoryId) {
      setEntries([])
      return
    }
    loadEntries({ section_id: activeSectionId, category_id: activeCategoryId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId, activeSectionId, isArticleMode])

  // `?artikel=` jenseits der geladenen 20: den Eintrag gezielt nachladen, sonst wäre der
  // geteilte Link ein halbes Versprechen.
  useEffect(() => {
    setDetachedEntry(null)
    if (isArticleMode || !artikelId) return undefined
    if (entries.some((entry) => Number(entry.entry_id) === artikelId)) return undefined

    let active = true

    async function loadDetachedEntry(){
      try{
        const resp = await get('/wiki/entries/' + artikelId)
        if (!resp.ok) throw createRequestError(resp.status, `Beitrag konnte nicht geladen werden (${resp.status})`)
        const data = await resp.json()
        if (active) setDetachedEntry(data && typeof data === 'object' ? data : null)
      }catch(err){
        if (active) setRequestError(err, 'Beitrag konnte nicht geladen werden')
      }
    }

    loadDetachedEntry()
    return () => {
      active = false
    }
  }, [artikelId, entries, isArticleMode])

  // Verwandte Einträge: Sichtbarkeit hängt an `profile`, Quelle ist je nach Modus der
  // Artikel oder die geladene Liste (inklusive nachgeladenem Einzeleintrag).
  useEffect(() => {
    if (!canShowRelatedEntries) {
      setRelatedEntriesByEntryId({})
      return undefined
    }

    const sourceEntries = isArticleMode
      ? (article ? [article] : [])
      : (detachedEntry ? [...entries, detachedEntry] : entries)
    const sourceEntryIds = Array.from(new Set(
      sourceEntries.map((entry) => Number(entry.entry_id)).filter((entryId) => entryId > 0)
    ))

    if (!sourceEntryIds.length) {
      setRelatedEntriesByEntryId({})
      return undefined
    }

    let active = true

    async function loadAllRelatedEntries(){
      try{
        const resolvedEntries = await Promise.all(sourceEntryIds.map(async (entryId) => [entryId, await loadRelatedEntries(entryId)]))
        if (!active) return

        setRelatedEntriesByEntryId(
          resolvedEntries.reduce((accumulator, [entryId, relatedEntries]) => {
            accumulator[entryId] = relatedEntries
            return accumulator
          }, {})
        )
      }catch(_error){
        if (active) {
          setRelatedEntriesByEntryId({})
        }
      }
    }

    loadAllRelatedEntries()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, canShowRelatedEntries, detachedEntry, entries, isArticleMode])

  // Titel: Artikelmodus → `entry_name`, sonst die Wiki-Seite. Die Hülle setzt für `wikiEntry`
  // wegen `meta.dynamicTitle` keinen eigenen Titel (sonst überschriebe ihr Effekt den Artikel).
  // Das Canonical schreibt in diesem Artikelzweig **nur** diese Seite; auf der Übersicht `/wiki`
  // gehört `<head>` allein der Hülle (`canonicalForPath('/wiki')` → `/astro-wiki/`). Kind-Effekte
  // laufen vor Eltern-Effekten — schrieben beide auf `/wiki`, überschriebe die Hülle bei jeder
  // Navigation das Wiki-Canonical. Ohne geladenen Eintrag bleibt `DEFAULT_CANONICAL` stehen.
  useSeoMeta(article?.entry_name || WIKI_TITLE, article?.entry_short || WIKI_DESCRIPTION, isArticleMode, canonicalForWikiEntry(article?.slug))

  // Titelbereich: Artikelname und Untertitel kommen aus dem schmalen Kontext, bis der
  // Artikel geladen ist bleibt der `handle`-Titel („Wiki") stehen.
  const setTitle = usePageFrame()?.setTitle
  const setDescription = usePageFrame()?.setDescription
  const setActions = usePageFrame()?.setActions
  const articleEntryId = article?.entry_id
  const articleName = article?.entry_name || ''

  // Editor-Sprung transportiert nur die ID. Als `useCallback` mit primitiven Abhängigkeiten
  // stabilisiert, damit der Aktions-Slot keine veraltete Closure rendert.
  const editArticle = useCallback(() => {
    if (!articleEntryId) return
    navigate('/admin/entries?entry=' + articleEntryId)
  }, [articleEntryId, navigate])

  useEffect(() => {
    if (!setTitle || !isArticleMode || !articleName) return undefined
    setTitle(articleName)
    setDescription(articleSubtitle(articleName))
    return () => {
      setTitle(null)
      setDescription(null)
    }
  }, [isArticleMode, slug, articleName, setTitle, setDescription])

  useEffect(() => {
    if (!setActions || !isArticleMode) return undefined
    setActions(
      <>
        <Link
          to="/wiki"
          className="admin-secondary-button"
          style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 12px', textDecoration: 'none' }}
        >
          Zur Wiki-Übersicht
        </Link>
        {isAdmin && articleEntryId ? (
          <button type="button" className="admin-primary-button" onClick={editArticle}>
            Beitrag bearbeiten
          </button>
        ) : null}
      </>
    )
    return () => setActions(null)
  }, [setActions, isArticleMode, isAdmin, articleEntryId, editArticle])

  const visibleEntries = entries
  const expandedEntry = detachedEntry && Number(detachedEntry.entry_id) === artikelId ? detachedEntry : null

  function renderRelatedEntries(entryId){
    if (!canShowRelatedEntries) return null
    const relatedEntries = relatedEntriesByEntryId[Number(entryId)] || []
    if (!relatedEntries.length) return null

    return (
      <div style={{ clear: 'both', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--admin-line)' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '1rem', color: 'var(--admin-ink)' }}>Weitere Beiträge</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          {relatedEntries.map((relatedEntry) => (
            <button
              key={`wiki-related-${entryId}-${relatedEntry.entry_id}`}
              type="button"
              onClick={() => navigateToRelatedEntry(relatedEntry)}
              style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--admin-panel)', border: '1px solid var(--admin-line)', textAlign: 'left', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, color: 'var(--admin-ink)', marginBottom: relatedEntry.entry_short ? 6 : 0 }}>{relatedEntry.entry_name}</div>
              {relatedEntry.entry_short ? (
                <div style={{ color: 'var(--admin-ink)', lineHeight: 1.5 }}>{relatedEntry.entry_short}</div>
              ) : null}
                <div style={{ marginTop: 10, color: 'var(--admin-accent)', fontWeight: 700, textDecoration: 'underline' }}>
                  Zum Beitrag
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (isArticleMode) {
    return (
      <div>
        {error.message ? (
          <div className="admin-message admin-error">
            <span>{error.message}</span>
            {error.requiresLogin ? (
              <button
                type="button"
                onClick={navigateToLogin}
                style={{ marginLeft: 8, padding: 0, border: 'none', background: 'transparent', color: 'var(--admin-accent)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}
              >
                Zum Login
              </button>
            ) : null}
          </div>
        ) : null}

        {article ? (
          <article className="app-page-panel wiki-article" data-testid="wiki-article">
            {/* Cover als erstes Kind: schwebt rechts, der Artikeltext fließt links herum, höchstens
                400 px breit. Alt-Text kommt aus dem Serverfeld `cover_alt` — ohne Bild ist er
                leer, weil dann das dekorative Standardbild erscheint. */}
            <img
              className="wiki-cover-banner"
              data-testid="wiki-article-cover"
              src={article.cover_url || DEFAULT_COVER_URL}
              alt={article.cover_alt || ''}
              width="400"
              height="210"
              loading="eager"
              decoding="async"
              onError={handleCoverError}
            />
            <MarkdownArticle content={article.entry_content || 'Kein Inhalt vorhanden.'} />
            {renderRelatedEntries(article.entry_id)}
          </article>
        ) : null}

        {!article && !loading && !error.message ? (
          <div className="admin-message">{ARTICLE_NOT_FOUND_MESSAGE}</div>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'grid', gap: 10, marginBottom: 18, marginLeft: 0, padding: 0 }}>
        <div style={{ display: 'flex', marginLeft: 0, padding: 0, flexWrap: 'wrap', alignItems: 'center', gap: 0, color: 'var(--admin-ink)' }}>
          {sections.map((section) => {
            const isActive = String(activeSectionId) === String(section.section_id)
            return (
              <React.Fragment key={`wiki-section-${section.section_id}`}>
                <span style={{ margin: '5px', color: 'var(--admin-line)', fontSize: 20 }}>{section === sections[0] ? '' : '|'}</span>
                <button
                  type="button"
                  onClick={() => selectSection(section.section_id)}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 20, fontWeight: isActive ? 800 : 600, color: isActive ? 'var(--admin-accent)' : 'var(--admin-ink)' }}
                >
                  {section.section_name}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {activeSectionId ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0, color: 'var(--admin-ink)' }}>
            {filteredCategories.map((category) => {
              const isActive = String(activeCategoryId) === String(category.category_id)
              return (
                <React.Fragment key={`wiki-category-${category.category_id}`}>
                  <span style={{ margin: '5px', color: 'var(--admin-line)', fontSize: 18 }}>{category === filteredCategories[0] ? '' : '|'}</span>
                  <button
                    type="button"
                    onClick={() => selectCategory(category.category_id)}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 18, fontWeight: isActive ? 800 : 600, color: isActive ? 'var(--admin-accent)' : 'var(--admin-ink)' }}
                  >
                    {category.category_name}
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        ) : null}
      </div>

      {error.message ? (
        <div className="admin-message admin-error">
          <span>{error.message}</span>
          {error.requiresLogin ? (
            <button
              type="button"
              onClick={navigateToLogin}
              style={{ marginLeft: 8, padding: 0, border: 'none', background: 'transparent', color: 'var(--admin-accent)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}
            >
              Zum Login
            </button>
          ) : null}
        </div>
      ) : null}
      {!visibleEntries.length && !loading && !error.message ? (
        <div className="admin-message">
          {selectedCategory ? `Keine Beiträge für ${selectedCategory.category_name} gefunden.` : 'Keine Beiträge gefunden.'}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 16 }}>
        {visibleEntries.map((entry, index) => {
          const isExpanded = Number(artikelId) === Number(entry.entry_id)
          return (
            <article id={`wiki-entry-${entry.entry_id}`} key={`wiki-entry-${entry.entry_id}`} className="admin-cache-card wiki-card">
              <button
                type="button"
                onClick={() => toggleExpandedEntry(entry.entry_id)}
                aria-expanded={isExpanded}
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {/* Kopf als Raster: Text links, Bild rechts. Das Bild ist ein nacktes `<img>` —
                    kein Link, kein zweiter Knopf; der ganze Kopf bleibt der Toggle. */}
                <div className="wiki-card-head">
                  <div className="wiki-card-text">
                    <header className={isExpanded && isAdmin ? 'admin-cache-card-header wiki-card-header-with-edit' : 'admin-cache-card-header'}>
                      <h2>{entry.entry_name}</h2>
                      <span>{isExpanded ? 'Verbergen' : 'Details'}</span>
                    </header>
                    <p style={{ margin: 0, color: 'var(--admin-ink)' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                  </div>
                  <img
                    className="wiki-cover-thumb"
                    data-testid="wiki-card-cover"
                    src={entry.cover_url || DEFAULT_COVER_URL}
                    alt=""
                    width="200"
                    height="105"
                    loading={index < 3 ? 'eager' : 'lazy'}
                    decoding="async"
                    onError={handleCoverError}
                  />
                </div>
              </button>
              {/* Admin: „Bearbeiten“ neben „Verbergen“. Steht bewusst **neben** dem Kopf-Toggle,
                  nicht darin (kein Knopf im Knopf); der Kopf reserviert ihm rechts den Platz. */}
              {isExpanded && isAdmin ? (
                <button
                  type="button"
                  className="admin-primary-button wiki-card-edit"
                  data-testid="wiki-card-edit"
                  onClick={() => navigate('/admin/entries?entry=' + entry.entry_id)}
                >
                  Bearbeiten
                </button>
              ) : null}

              {isExpanded ? (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--admin-line)' }}>
                  {/* Kein zweites Banner im aufgeklappten Eintrag: das Bild
                      steht direkt darüber im Kartenkopf und ist beim Aufklappen sichtbar. Nur der
                      nachgeladene Einzeleintrag jenseits der 20 rendert ein Banner, weil er keinen
                      Kartenkopf hat. */}
                  <MarkdownArticle content={entry.entry_content || 'Kein Inhalt vorhanden.'} />
                  {renderRelatedEntries(entry.entry_id)}
                  {/* Ohne Slug (in der DB nullable) gibt es keine Artikel-Adresse; der Eintrag ist
                      hier bereits über `?artikel=<id>` aufgeklappt, ein Link auf `/wiki/` würde nur
                      auf die Liste zurückfallen. */}
                  {entry.slug ? (
                    <div className="admin-cache-card-actions">
                      <Link to={'/wiki/' + encodeURIComponent(entry.slug)} style={{ color: 'var(--admin-accent)', fontWeight: 700 }}>
                        Artikel öffnen
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        })}

        {expandedEntry ? (
          <article id={`wiki-entry-${expandedEntry.entry_id}`} className="admin-cache-card">
            <header className="admin-cache-card-header">
              <h2>{expandedEntry.entry_name}</h2>
              <span>Details</span>
            </header>
            <div style={{ marginTop: 8 }}>
              {/* Nachgeladener Einzeleintrag (`?artikel=` jenseits der 20): Kopf ohne Kopfbild,
                  Banner trotzdem über dem Text — dieselbe Fläche wie im aufgeklappten Eintrag. */}
              <img
                className="wiki-cover-banner"
                data-testid="wiki-card-banner"
                src={expandedEntry.cover_url || DEFAULT_COVER_URL}
                alt={expandedEntry.cover_alt || ''}
                width="400"
                height="210"
                loading="eager"
                decoding="async"
                onError={handleCoverError}
              />
              <MarkdownArticle content={expandedEntry.entry_content || 'Kein Inhalt vorhanden.'} />
              {renderRelatedEntries(expandedEntry.entry_id)}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  )
}

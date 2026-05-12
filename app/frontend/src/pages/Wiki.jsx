import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from '../contexts/AuthContext'
import { get } from '../services/api'

const markdownComponents = {
  h1: ({ node, ...props }) => <h1 style={{ margin: '0 0 12px', fontSize: '1.5rem', lineHeight: 1.2 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '20px 0 10px', fontSize: '1.2rem', lineHeight: 1.25 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '16px 0 8px', fontSize: '1.05rem', lineHeight: 1.3 }} {...props} />,
  p: ({ node, ...props }) => <p style={{ margin: '0 0 12px', lineHeight: 1.65 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ marginBottom: 6 }} {...props} />,
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#132238' }} {...props} />,
  em: ({ node, ...props }) => <em style={{ color: '#38506b' }} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote style={{ margin: '16px 0', padding: '8px 14px', borderLeft: '4px solid #9fb4c7', background: '#f3f7fb', color: '#31485f' }} {...props} />
  ),
  code: ({ inline, node, ...props }) =>
    inline
      ? <code style={{ background: '#eef3f8', padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }} {...props} />
      : <code style={{ display: 'block', background: '#eef3f8', padding: 12, borderRadius: 8, overflowX: 'auto' }} {...props} />,
}

const PUBLIC_DIRECT_PAGE_NAMES = new Set(['login', 'impressum', 'kontakt', 'datenschutz'])
const LOGIN_REQUIRED_MESSAGE = 'Keine Berechtigung - loggen Sie sich zuerst ein'

function createRequestError(status, message){
  const error = new Error(message)
  error.status = status
  return error
}

function scrollWindowToTop(){
  if (typeof window === 'undefined') return
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export default function Wiki({
  directPageName = '',
  directOriginPage = '',
  directOriginLabel = '',
  targetSectionId = '',
  targetCategoryId = '',
  targetEntryId = '',
}){
  const { profile } = useAuth()
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [directEntries, setDirectEntries] = useState([])
  const [relatedEntriesByEntryId, setRelatedEntriesByEntryId] = useState({})
  const [publicPageNameByEntryId, setPublicPageNameByEntryId] = useState({})
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [expandedEntryId, setExpandedEntryId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState({ message: '', requiresLogin: false })
  const hasDirectPage = !!String(directPageName || '').trim()
  const hasAuthToken = typeof window !== 'undefined' ? !!window.localStorage.getItem('token') : false
  const isPublicDirectPage = PUBLIC_DIRECT_PAGE_NAMES.has(String(directPageName || '').trim().toLowerCase())
  const isAdmin = Boolean(profile?.isadmin)
  const canShowRelatedEntries = Boolean(profile)
  const normalizedTargetSectionId = String(targetSectionId || '')
  const normalizedTargetCategoryId = String(targetCategoryId || '')
  const normalizedTargetEntryId = Number(targetEntryId || 0)

  const wikiSectionIds = useMemo(() => new Set(sections.map((section) => Number(section.section_id))), [sections])

  function setRequestError(errorValue, fallbackMessage){
    if (Number(errorValue?.status) === 401){
      setError({ message: LOGIN_REQUIRED_MESSAGE, requiresLogin: true })
      return
    }
    setError({ message: errorValue?.message || fallbackMessage, requiresLogin: false })
  }

  function navigateToLogin(){
    window.dispatchEvent(new CustomEvent('astronexNavigate', { detail: { page: 'login', state: {} } }))
  }

  function navigateToEntryEditor(entry){
    if (!entry?.entry_id) return
    window.dispatchEvent(new CustomEvent('astronexNavigate', {
      detail: {
        page: 'admin',
        state: {
          activeTab: 'entries',
          entryEditRequest: {
            entry,
            requestedAt: Date.now(),
          },
        },
      },
    }))
  }

  async function resolvePublicPageName(entryId){
    const normalizedEntryId = Number(entryId)
    if (!normalizedEntryId) return ''

    if (publicPageNameByEntryId[normalizedEntryId]) {
      return publicPageNameByEntryId[normalizedEntryId]
    }

    const pageContentResponse = await get(`/wiki/page-content?entry_id=${normalizedEntryId}`)
    if (!pageContentResponse.ok) return ''

    const pageContents = await pageContentResponse.json()
    const pageId = Array.isArray(pageContents) ? Number(pageContents[0]?.page_id || 0) : 0
    if (!pageId) return ''

    const pageResponse = await get(`/wiki/pages/${pageId}`)
    if (!pageResponse.ok) return ''

    const page = await pageResponse.json()
    const pageName = String(page?.page_name || '').trim()
    if (!pageName) return ''

    setPublicPageNameByEntryId((current) => ({
      ...current,
      [normalizedEntryId]: pageName,
    }))

    return pageName
  }

  async function navigateToRelatedEntry(relatedEntry){
    const normalizedEntryId = Number(relatedEntry?.entry_id || 0)
    if (!normalizedEntryId) return

    if (relatedEntry?.ispublic) {
      const publicPageName = await resolvePublicPageName(normalizedEntryId)
      if (publicPageName) {
        window.dispatchEvent(new CustomEvent('astronexNavigate', {
          detail: {
            page: 'wiki',
            state: {
              directPageName: publicPageName,
              directOriginPage: 'wiki',
              directOriginLabel: 'Wiki',
            },
          },
        }))
        return
      }
    }

    const normalizedCategoryId = String(relatedEntry?.category_id || '')
    const matchingCategory = categories.find((category) => String(category.category_id) === normalizedCategoryId)
    const nextSectionId = matchingCategory ? String(matchingCategory.section_id) : ''

    window.dispatchEvent(new CustomEvent('astronexNavigate', {
      detail: {
        page: 'wiki',
        state: {
          targetSectionId: nextSectionId,
          targetCategoryId: normalizedCategoryId,
          targetEntryId: String(relatedEntry?.entry_id || ''),
        },
      },
    }))
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

  async function loadDirectEntries(pageName){
    const normalizedPageName = String(pageName || '').trim()
    if (!normalizedPageName) {
      setDirectEntries([])
      return
    }

    setLoading(true)
    setError({ message: '', requiresLogin: false })
    try{
      const params = new URLSearchParams({ page_name: normalizedPageName })
      const resp = await get(`/wiki/page-entries?${params.toString()}`)
      if (!resp.ok) throw createRequestError(resp.status, `Direkter Wiki-Eintrag konnte nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      const nextEntries = Array.isArray(data) ? data : []
      setDirectEntries(nextEntries)
      setExpandedEntryId(nextEntries[0]?.entry_id || null)
    }catch(err){
      setDirectEntries([])
      setRequestError(err, 'Direkter Wiki-Eintrag konnte nicht geladen werden')
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

  useEffect(() => {
    if (hasDirectPage) {
      if (hasAuthToken || canShowRelatedEntries) {
        loadSections()
        loadCategories()
      }
      loadDirectEntries(directPageName)
      return
    }

    setDirectEntries([])
    loadSections()
    loadCategories()
  }, [canShowRelatedEntries, directPageName, hasAuthToken, hasDirectPage, isPublicDirectPage])

  useEffect(() => {
    if (hasDirectPage) return
    if (!sections.length) {
      if (selectedSectionId) setSelectedSectionId('')
      if (selectedCategoryId) setSelectedCategoryId('')
      return
    }

    const nextSectionId = selectedSectionId || String(sections[0].section_id)
    if (nextSectionId !== selectedSectionId) {
      setSelectedSectionId(nextSectionId)
      return
    }

    const nextFilteredCategories = categories.filter((category) => {
      const sectionId = Number(category.section_id)
      return wikiSectionIds.has(sectionId) && sectionId === Number(nextSectionId)
    })
    const nextCategoryId = nextFilteredCategories[0] ? String(nextFilteredCategories[0].category_id) : ''

    if (selectedCategoryId && !nextFilteredCategories.some((category) => String(category.category_id) === String(selectedCategoryId))) {
      setSelectedCategoryId(nextCategoryId)
      return
    }

    if (!selectedCategoryId && nextCategoryId) {
      setSelectedCategoryId(nextCategoryId)
    }
  }, [categories, hasDirectPage, sections, selectedCategoryId, selectedSectionId, wikiSectionIds])

  useEffect(() => {
    if (hasDirectPage || !sections.length) return
    let resolvedTargetSectionId = normalizedTargetSectionId

    if (!resolvedTargetSectionId && normalizedTargetCategoryId && categories.length) {
      const matchingCategory = categories.find((category) => String(category.category_id) === normalizedTargetCategoryId)
      resolvedTargetSectionId = matchingCategory ? String(matchingCategory.section_id) : ''
    }

    if (!resolvedTargetSectionId) return
    if (!sections.some((section) => String(section.section_id) === resolvedTargetSectionId)) return
    if (selectedSectionId === resolvedTargetSectionId) return
    setSelectedSectionId(resolvedTargetSectionId)
  }, [categories, hasDirectPage, normalizedTargetCategoryId, normalizedTargetSectionId, sections, selectedSectionId])

  useEffect(() => {
    if (hasDirectPage || !categories.length) return
    if (!normalizedTargetCategoryId) return
    const matchingCategory = categories.find((category) => String(category.category_id) === normalizedTargetCategoryId)
    if (!matchingCategory) return

    const matchingSectionId = String(matchingCategory.section_id)
    if (selectedSectionId !== matchingSectionId) return
    if (selectedCategoryId === normalizedTargetCategoryId) return
    setSelectedCategoryId(normalizedTargetCategoryId)
  }, [categories, hasDirectPage, normalizedTargetCategoryId, selectedCategoryId, selectedSectionId])

  useEffect(() => {
    if (hasDirectPage) return
    setExpandedEntryId(null)
    if (!selectedSectionId || !selectedCategoryId) {
      setEntries([])
      return
    }
    loadEntries({
      section_id: selectedSectionId,
      category_id: selectedCategoryId,
    })
  }, [hasDirectPage, selectedCategoryId, selectedSectionId])

  useEffect(() => {
    if (!hasDirectPage) {
      setExpandedEntryId(null)
      return
    }
    scrollWindowToTop()
    loadDirectEntries(directPageName)
  }, [directPageName, hasDirectPage])

  useEffect(() => {
    if (hasDirectPage || !normalizedTargetEntryId || !entries.length) return
    const matchingEntry = entries.find((entry) => Number(entry.entry_id) === normalizedTargetEntryId)
    if (!matchingEntry) return

    setExpandedEntryId(normalizedTargetEntryId)
    scrollWindowToTop()
  }, [entries, hasDirectPage, normalizedTargetEntryId])

  useEffect(() => {
    if (!canShowRelatedEntries) {
      setRelatedEntriesByEntryId({})
      return
    }

    const sourceEntries = hasDirectPage ? directEntries : entries
    const sourceEntryIds = sourceEntries
      .map((entry) => Number(entry.entry_id))
      .filter((entryId) => entryId > 0)

    if (!sourceEntryIds.length) {
      setRelatedEntriesByEntryId({})
      return
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
  }, [canShowRelatedEntries, directEntries, entries, hasDirectPage])

  // Update page title and meta description when an entry is expanded or a direct page is shown
  useEffect(() => {
    const SITE_NAME = 'Astro-Magister'
    const sourceEntries = hasDirectPage ? directEntries : entries
    const expandedEntry = sourceEntries.find((entry) => Number(entry.entry_id) === Number(expandedEntryId))
    const entryName = String(expandedEntry?.entry_name || '').trim()

    let title
    let description
    if (entryName) {
      title = `${entryName} – Wiki | ${SITE_NAME}`
      description = expandedEntry?.short_description
        ? String(expandedEntry.short_description).slice(0, 155)
        : `${entryName} – astrologischer Wiki-Eintrag auf ${SITE_NAME}.`
    } else if (hasDirectPage && directPageName) {
      title = `${directPageName} | ${SITE_NAME}`
      description = `Wiki-Seite „${directPageName}" auf ${SITE_NAME}.`
    } else {
      title = `Wiki | ${SITE_NAME}`
      description = 'Das astrologische Wiki von Astro-Magister – Begriffe, Planeten, Aspekte und mehr erklärt.'
    }

    document.title = title
    const descEl = document.querySelector('meta[name="description"]')
    if (descEl) descEl.setAttribute('content', description)
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) ogTitle.setAttribute('content', title)
    const ogDesc = document.querySelector('meta[property="og:description"]')
    if (ogDesc) ogDesc.setAttribute('content', description)
    const twTitle = document.querySelector('meta[name="twitter:title"]')
    if (twTitle) twTitle.setAttribute('content', title)
    const twDesc = document.querySelector('meta[name="twitter:description"]')
    if (twDesc) twDesc.setAttribute('content', description)
  }, [directEntries, directPageName, entries, expandedEntryId, hasDirectPage])

  const filteredCategories = useMemo(() => {
    if (!selectedSectionId) return []

    return categories.filter((category) => {
      const sectionId = Number(category.section_id)
      return wikiSectionIds.has(sectionId) && sectionId === Number(selectedSectionId)
    })
  }, [categories, selectedSectionId, wikiSectionIds])

  const visibleEntries = hasDirectPage ? directEntries : entries
  const directEditableEntry = hasDirectPage && directEntries.length > 0 ? directEntries[0] : null
  const selectedCategory = filteredCategories.find((category) => String(category.category_id) === String(selectedCategoryId))

  function renderRelatedEntries(entryId){
    if (!canShowRelatedEntries) return null
    const relatedEntries = relatedEntriesByEntryId[Number(entryId)] || []
    if (!relatedEntries.length) return null

    return (
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #dde1e7' }}>
        <h4 style={{ margin: '0 0 10px', fontSize: '1rem', color: '#132238' }}>Weitere Beiträge</h4>
        <div style={{ display: 'grid', gap: 10 }}>
          {relatedEntries.map((relatedEntry) => (
            <button
              key={`wiki-related-${entryId}-${relatedEntry.entry_id}`}
              type="button"
              onClick={() => navigateToRelatedEntry(relatedEntry)}
              style={{ padding: '12px 14px', borderRadius: 10, background: '#f6f8fb', border: '1px solid #dde1e7', textAlign: 'left', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, color: '#132238', marginBottom: relatedEntry.entry_short ? 6 : 0 }}>{relatedEntry.entry_name}</div>
              {relatedEntry.entry_short ? (
                <div style={{ color: '#4b5d71', lineHeight: 1.5 }}>{relatedEntry.entry_short}</div>
              ) : null}
              <div style={{ marginTop: 10, color: '#0f766e', fontWeight: 700, textDecoration: 'underline' }}>
                Zum Beitrag
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="admin-panel-header">
        {!hasDirectPage ? (
        <div>
          <h3>Wiki</h3>
          <p>{hasDirectPage ? `Direkt verlinkter Wiki-Eintrag für ${directPageName}.` : 'Bereiche und Kategorien auswählen, Beiträge durchsuchen und Inhalte direkt lesen.'}</p>
        </div>
        ): <div></div>}
        {hasDirectPage ? (
          <div className="admin-action-group">
            {directOriginPage ? (
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => window.dispatchEvent(new CustomEvent('astronexNavigate', { detail: { page: directOriginPage, state: {} } }))}
              >
                {`Zurück${directOriginLabel ? ` zu ${directOriginLabel}` : ''}`}
              </button>
            ) : null}
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => window.dispatchEvent(new CustomEvent('astronexNavigate', { detail: { page: 'wiki', state: {} } }))}
            >
              Zur Wiki Startseite
            </button>
            {isAdmin ? (
              <button
                type="button"
                className="admin-primary-button"
                onClick={() => navigateToEntryEditor(directEditableEntry)}
                disabled={!directEditableEntry}
              >
                Beitrag bearbeiten
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!hasDirectPage ? (
      <div style={{ display: 'grid', gap: 10, marginBottom: 18, marginLeft: 0, padding: 0 }}>
        <div style={{ display: 'flex', marginLeft: 0, padding: 0, flexWrap: 'wrap', alignItems: 'center', gap: 0, color: '#11243d' }}>
          {sections.map((section) => {
            const isActive = String(selectedSectionId) === String(section.section_id)
            const nextSectionCategories = categories.filter((category) => Number(category.section_id) === Number(section.section_id) && wikiSectionIds.has(Number(category.section_id)))
            return (
              <React.Fragment key={`wiki-section-${section.section_id}`}>
                <span style={{ margin: '5px', color: '#9aa7b4', fontSize: 20 }}>{section === sections[0] ? '' : '|'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSectionId(String(section.section_id))
                    setSelectedCategoryId(nextSectionCategories[0] ? String(nextSectionCategories[0].category_id) : '')
                  }}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 20, fontWeight: isActive ? 800 : 600, color: isActive ? '#0f766e' : '#38506b' }}
                >
                  {section.section_name}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {selectedSectionId ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0, color: '#11243d' }}>
            {filteredCategories.map((category) => {
              const isActive = String(selectedCategoryId) === String(category.category_id)
              return (
                <React.Fragment key={`wiki-category-${category.category_id}`}>
                  <span style={{ margin: '5px', color: '#b4bcc5', fontSize: 18 }}>{category === filteredCategories[0] ? '' : '|'}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(String(category.category_id))}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 18, fontWeight: isActive ? 800 : 600, color: isActive ? '#0f766e' : '#4b5d71' }}
                  >
                    {category.category_name}
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        ) : null}
      </div>
      ) : null}

      {error.message ? (
        <div className="admin-message admin-error">
          <span>{error.message}</span>
          {error.requiresLogin ? (
            <button
              type="button"
              onClick={navigateToLogin}
              style={{ marginLeft: 8, padding: 0, border: 'none', background: 'transparent', color: '#0f766e', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}
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
        {visibleEntries.map((entry) => {
          const isExpanded = Number(expandedEntryId) === Number(entry.entry_id)
          return (
            <article id={`wiki-entry-${entry.entry_id}`} key={`wiki-entry-${entry.entry_id}`} className="admin-cache-card">
              {hasDirectPage ? (
                <div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {entry.entry_content || 'Kein Inhalt vorhanden.'}
                  </ReactMarkdown>
                  {renderRelatedEntries(entry.entry_id)}
                </div>
              ) : null}

              {!hasDirectPage ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandedEntryId((current) => Number(current) === Number(entry.entry_id) ? null : entry.entry_id)}
                    style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <header className="admin-cache-card-header">
                      <h3>{entry.entry_name}</h3>
                      <span>{isExpanded ? 'Verbergen' : 'Details'}</span>
                    </header>
                    <p style={{ margin: 0, color: '#4b5d71' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                  </button>

                  {isExpanded ? (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #dde1e7' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {entry.entry_content || 'Kein Inhalt vorhanden.'}
                      </ReactMarkdown>
                      {renderRelatedEntries(entry.entry_id)}
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}
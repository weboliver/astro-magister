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

export default function Wiki({ directPageName = '', directOriginPage = '', directOriginLabel = '' }){
  const { profile } = useAuth()
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [directEntries, setDirectEntries] = useState([])
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [expandedEntryId, setExpandedEntryId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState({ message: '', requiresLogin: false })
  const hasDirectPage = !!String(directPageName || '').trim()
  const hasAuthToken = typeof window !== 'undefined' ? !!window.localStorage.getItem('token') : false
  const isPublicDirectPage = PUBLIC_DIRECT_PAGE_NAMES.has(String(directPageName || '').trim().toLowerCase())
  const isAdmin = Boolean(profile?.isadmin)

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

  async function loadSections(){
    try{
      const resp = await get('/auth/wiki/sections?wiki_active_only=true')
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
      const resp = await get('/auth/wiki/categories')
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
      const resp = await get(`/auth/wiki/entries?${params.toString()}`)
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
      const usePublicEndpoint = isPublicDirectPage || !hasAuthToken
      const endpoint = usePublicEndpoint ? '/wiki/page-entries' : '/auth/wiki/page-entries'
      const resp = await get(`${endpoint}?${params.toString()}`, !usePublicEndpoint)
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

  useEffect(() => {
    if (hasDirectPage) {
      if (hasAuthToken && !isPublicDirectPage) {
        loadSections()
        loadCategories()
      }
      loadDirectEntries(directPageName)
      return
    }
    loadSections()
    loadCategories()
    loadEntries()
  }, [])

  useEffect(() => {
    if (hasDirectPage) return
    setExpandedEntryId(null)
    loadEntries({
      section_id: selectedSectionId,
      category_id: selectedCategoryId,
    })
  }, [selectedSectionId, selectedCategoryId])

  useEffect(() => {
    if (!hasDirectPage) {
      setDirectEntries([])
      setExpandedEntryId(null)
      loadEntries({
        section_id: selectedSectionId,
        category_id: selectedCategoryId,
      })
      return
    }
    loadDirectEntries(directPageName)
  }, [directPageName, hasDirectPage])

  const filteredCategories = useMemo(() => {
    const wikiSectionIds = new Set(sections.map((section) => Number(section.section_id)))
    const visibleCategories = categories.filter((category) => wikiSectionIds.has(Number(category.section_id)))
    if (!selectedSectionId) return visibleCategories
    return visibleCategories.filter((category) => Number(category.section_id) === Number(selectedSectionId))
  }, [categories, sections, selectedSectionId])

  const visibleEntries = hasDirectPage ? directEntries : entries
  const directEditableEntry = hasDirectPage && directEntries.length > 0 ? directEntries[0] : null

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
      <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0, color: '#11243d' }}>
          <button
            type="button"
            onClick={() => {
              setSelectedSectionId('')
              setSelectedCategoryId('')
            }}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 20, fontWeight: selectedSectionId ? 600 : 800, color: selectedSectionId ? '#38506b' : '#0f766e' }}
          >
            Alle Bereiche
          </button>
          {sections.map((section) => {
            const isActive = String(selectedSectionId) === String(section.section_id)
            return (
              <React.Fragment key={`wiki-section-${section.section_id}`}>
                <span style={{ margin: '0 10px', color: '#9aa7b4', fontSize: 20 }}>|</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSectionId(String(section.section_id))
                    setSelectedCategoryId('')
                  }}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 20, fontWeight: isActive ? 800 : 600, color: isActive ? '#0f766e' : '#38506b' }}
                >
                  {section.section_name}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0, color: '#11243d' }}>
          <button
            type="button"
            onClick={() => setSelectedCategoryId('')}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 18, fontWeight: selectedCategoryId ? 600 : 800, color: selectedCategoryId ? '#4b5d71' : '#0f766e' }}
          >
            Alle Kategorien
          </button>
          {filteredCategories.map((category) => {
            const isActive = String(selectedCategoryId) === String(category.category_id)
            return (
              <React.Fragment key={`wiki-category-${category.category_id}`}>
                <span style={{ margin: '0 10px', color: '#b4bcc5', fontSize: 18 }}>|</span>
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
      {!visibleEntries.length && !loading && !error.message ? <div className="admin-message">Keine Beiträge gefunden.</div> : null}

      <div style={{ display: 'grid', gap: 16 }}>
        {visibleEntries.map((entry) => {
          const isExpanded = Number(expandedEntryId) === Number(entry.entry_id)
          return (
            <article key={`wiki-entry-${entry.entry_id}`} className="admin-cache-card">
              {hasDirectPage ? (
                <div>
                  {isAdmin && entry?.entry_id ? (
                    <div className="admin-action-group" style={{ marginBottom: 12 }}>
                      <button
                        type="button"
                        className="admin-primary-button"
                        onClick={() => navigateToEntryEditor(entry)}
                      >
                        Beitrag bearbeiten
                      </button>
                    </div>
                  ) : null}
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {entry.entry_content || 'Kein Inhalt vorhanden.'}
                  </ReactMarkdown>
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
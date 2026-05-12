import React, { useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from '../../services/api'

const emptyPageForm = {
  page_name: '',
}

const SEARCH_PAGE_SIZE = 5

export default function AdminPagesTab({ onEditEntry }){
  const [pages, setPages] = useState([])
  const [pageQuery, setPageQuery] = useState('')
  const [pageLoading, setPageLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [pageSuccess, setPageSuccess] = useState('')
  const [selectedPage, setSelectedPage] = useState(null)
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [pageContents, setPageContents] = useState([])
  const [linkedEntries, setLinkedEntries] = useState([])
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [entryQuery, setEntryQuery] = useState('')
  const [entrySectionFilter, setEntrySectionFilter] = useState('')
  const [entryCategoryFilter, setEntryCategoryFilter] = useState('')
  const [entrySearchResults, setEntrySearchResults] = useState([])
  const [entrySearchLoading, setEntrySearchLoading] = useState(false)
  const [entrySearchPage, setEntrySearchPage] = useState(1)

  async function loadPages(){
    setPageLoading(true)
    setPageError('')
    try{
      const resp = await get('/wiki/pages')
      if (!resp.ok) throw new Error(`Pages konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setPages(Array.isArray(data) ? data : [])
    }catch(err){
      setPageError(err?.message || 'Pages konnten nicht geladen werden')
    }finally{
      setPageLoading(false)
    }
  }

  async function loadSections(){
    try{
      const resp = await get('/wiki/sections')
      if (!resp.ok) throw new Error(`Sections konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(_){
      setSections([])
    }
  }

  async function loadCategories(){
    try{
      const resp = await get('/wiki/categories')
      if (!resp.ok) throw new Error(`Categories konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setCategories(Array.isArray(data) ? data : [])
    }catch(_){
      setCategories([])
    }
  }

  async function fetchEntry(entryId){
    const resp = await get(`/wiki/entries/${entryId}`)
    if (!resp.ok) throw new Error(`Beitrag ${entryId} konnte nicht geladen werden (${resp.status})`)
    return resp.json()
  }

  async function loadPageAssignments(pageId){
    if (!pageId){
      setPageContents([])
      setLinkedEntries([])
      return
    }
    setAssignmentLoading(true)
    setPageError('')
    try{
      const params = new URLSearchParams({ page_id: String(pageId) })
      const resp = await get(`/wiki/page-content?${params.toString()}`)
      if (!resp.ok) throw new Error(`Zuordnungen konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      const contentRows = Array.isArray(data) ? data : []
      setPageContents(contentRows)
      if (!contentRows.length){
        setLinkedEntries([])
        return
      }
      const entries = await Promise.all(contentRows.map((row) => fetchEntry(row.entry_id)))
      setLinkedEntries(entries)
    }catch(err){
      setPageError(err?.message || 'Zuordnungen konnten nicht geladen werden')
      setPageContents([])
      setLinkedEntries([])
    }finally{
      setAssignmentLoading(false)
    }
  }

  async function searchEntries(filters = {}, page = 1){
    if (!selectedPage?.page_id){
      setEntrySearchResults([])
      return
    }
    setEntrySearchLoading(true)
    setPageError('')
    try{
      const params = new URLSearchParams({
        limit: String(SEARCH_PAGE_SIZE),
        offset: String((page - 1) * SEARCH_PAGE_SIZE),
      })
      if (filters.q) params.set('q', filters.q)
      if (filters.section_id) params.set('section_id', String(filters.section_id))
      if (filters.category_id) params.set('category_id', String(filters.category_id))
      const resp = await get(`/wiki/entries?${params.toString()}`)
      if (!resp.ok) throw new Error(`Beiträge konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setEntrySearchResults(Array.isArray(data) ? data : [])
    }catch(err){
      setPageError(err?.message || 'Beiträge konnten nicht geladen werden')
      setEntrySearchResults([])
    }finally{
      setEntrySearchLoading(false)
    }
  }

  function resetPageForm(){
    setSelectedPage({ ...emptyPageForm })
    setPageError('')
    setPageSuccess('')
  }

  function editPage(page){
    setSelectedPage({
      page_id: page.page_id,
      page_name: page.page_name || '',
    })
    setPageError('')
    setPageSuccess('')
  }

  async function savePage(){
    if (!selectedPage?.page_name?.trim()){
      setPageError('Bitte einen Seitennamen eingeben')
      return
    }
    setPageLoading(true)
    setPageError('')
    setPageSuccess('')
    try{
      const payload = {
        page_name: selectedPage.page_name.trim(),
      }
      const isUpdate = !!selectedPage.page_id
      const resp = isUpdate
        ? await put(`/wiki/pages/${selectedPage.page_id}`, payload)
        : await post('/wiki/pages', payload)
      if (!resp.ok) throw new Error(`${isUpdate ? 'Speichern' : 'Anlegen'} fehlgeschlagen. Eventuell existiert die Seite schon? (${resp.status})`)
      const saved = await resp.json()
      await loadPages()
      editPage(saved)
      setPageSuccess(isUpdate ? 'Seite aktualisiert' : 'Seite angelegt')
    }catch(err){
      setPageError(err?.message || 'Seite konnte nicht gespeichert werden')
    }finally{
      setPageLoading(false)
    }
  }

  async function deletePage(pageId){
    if (!window.confirm('Seite wirklich löschen?')) return
    setPageLoading(true)
    setPageError('')
    setPageSuccess('')
    try{
      const resp = await del(`/wiki/pages/${pageId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadPages()
      if (selectedPage?.page_id === pageId){
        setSelectedPage(null)
        setPageContents([])
        setLinkedEntries([])
        setEntrySearchResults([])
      }
      setPageSuccess('Seite gelöscht')
    }catch(err){
      setPageError(err?.message || 'Seite konnte nicht gelöscht werden')
    }finally{
      setPageLoading(false)
    }
  }

  async function assignEntry(entry){
    if (!selectedPage?.page_id || !entry?.entry_id) return
    setPageError('')
    setPageSuccess('')
    try{
      const resp = await post('/wiki/page-content', {
        page_id: selectedPage.page_id,
        entry_id: entry.entry_id,
      })
      if (!resp.ok) throw new Error(`Zuordnung fehlgeschlagen (${resp.status})`)
      await loadPageAssignments(selectedPage.page_id)
      setPageSuccess('Beitrag zugeordnet')
    }catch(err){
      setPageError(err?.message || 'Beitrag konnte nicht zugeordnet werden')
    }
  }

  async function removeAssignment(pageContentId){
    if (!pageContentId) return
    setPageError('')
    setPageSuccess('')
    try{
      const resp = await del(`/wiki/page-content/${pageContentId}`)
      if (!resp.ok) throw new Error(`Zuordnung konnte nicht gelöscht werden (${resp.status})`)
      await loadPageAssignments(selectedPage?.page_id)
      setPageSuccess('Zuordnung gelöscht')
    }catch(err){
      setPageError(err?.message || 'Zuordnung konnte nicht gelöscht werden')
    }
  }

  useEffect(() => {
    loadPages()
    loadSections()
    loadCategories()
  }, [])

  useEffect(() => {
    loadPageAssignments(selectedPage?.page_id)
  }, [selectedPage])

  useEffect(() => {
    setEntrySearchPage(1)
  }, [selectedPage, entryQuery, entrySectionFilter, entryCategoryFilter])

  useEffect(() => {
    if (!selectedPage?.page_id){
      setEntrySearchResults([])
      return
    }
    const handle = window.setTimeout(() => {
      searchEntries({
        q: entryQuery.trim(),
        section_id: entrySectionFilter,
        category_id: entryCategoryFilter,
      }, entrySearchPage)
    }, entryQuery.trim() ? 250 : 0)
    return () => window.clearTimeout(handle)
  }, [selectedPage, entryQuery, entrySectionFilter, entryCategoryFilter, entrySearchPage])

  const filteredPages = useMemo(() => {
    const needle = pageQuery.trim().toLowerCase()
    if (!needle) return pages
    return pages.filter((page) => String(page.page_name || '').toLowerCase().includes(needle))
  }, [pageQuery, pages])

  const filteredCategories = useMemo(() => {
    if (!entrySectionFilter) return categories
    return categories.filter((category) => Number(category.section_id) === Number(entrySectionFilter))
  }, [categories, entrySectionFilter])

  const pageContentMap = useMemo(() => {
    const map = new Map()
    pageContents.forEach((row) => {
      map.set(Number(row.entry_id), row)
    })
    return map
  }, [pageContents])

  const availableEntries = useMemo(() => {
    return entrySearchResults.filter((entry) => !pageContentMap.has(Number(entry.entry_id)))
  }, [entrySearchResults, pageContentMap])

  const canEntryGoBack = entrySearchPage > 1
  const canEntryGoForward = entrySearchResults.length === SEARCH_PAGE_SIZE

  return (
    <section className="admin-panel" aria-label="Seiten verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Seiten verwalten</h3>
          <p>Seiten anlegen, suchen, bearbeiten und löschen.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={resetPageForm}>
            Neue Seite
          </button>
          <button type="button" className="admin-primary-button" onClick={loadPages} disabled={pageLoading}>
            {pageLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Suche</span>
          <input
            type="search"
            autoComplete="off"
            inputMode="search"
            value={pageQuery}
            onChange={(event) => setPageQuery(event.target.value)}
            placeholder="Seitenname"
          />
        </label>
      </div>

      {pageError ? <div className="admin-message admin-error">{pageError}</div> : null}
      {pageSuccess ? <div className="admin-message admin-success">{pageSuccess}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          {!filteredPages.length && !pageLoading ? (
            <div className="admin-message">Keine Seiten gefunden.</div>
          ) : null}
          <div className="admin-cache-grid">
            {filteredPages.map((page) => (
              <article key={`page-${page.page_id}`} className="admin-cache-card">
                <header className="admin-cache-card-header">
                  <strong>{page.page_name}</strong>
                  <span>ID {page.page_id}</span>
                </header>
                <div style={{ padding: 8 }}>
                  <button type="button" className="admin-primary-button" onClick={() => editPage(page)}>
                    Bearbeiten
                  </button>
                  <button type="button" className="admin-secondary-button" onClick={() => deletePage(page.page_id)} style={{ marginLeft: 8 }}>
                    Löschen
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div style={{ width: 420, maxWidth: '100%' }}>
          <div className="admin-panel" style={{ padding: 12 }}>
            <h4>{selectedPage?.page_id ? 'Seite bearbeiten' : 'Seite anlegen'}</h4>
            <label className="admin-field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="off"
                value={selectedPage?.page_name || ''}
                onChange={(event) => setSelectedPage((current) => ({ ...(current || emptyPageForm), page_name: event.target.value }))}
              />
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="admin-primary-button" onClick={savePage} disabled={pageLoading}>
                {selectedPage?.page_id ? 'Änderungen speichern' : 'Seite anlegen'}
              </button>
              <button className="admin-secondary-button" onClick={resetPageForm} style={{ marginLeft: 8 }}>
                Zurücksetzen
              </button>
            </div>
          </div>

          {selectedPage?.page_id ? (
            <div className="admin-panel" style={{ padding: 12, marginTop: 16 }}>
              <h4>Beiträge zuordnen</h4>

              <div className="admin-panel" style={{ padding: 12, marginBottom: 16 }}>
                <h5 style={{ marginTop: 0 }}>Bereits zugeordnete Beiträge</h5>
                {!linkedEntries.length && !assignmentLoading ? (
                  <div className="admin-message">Keine Beiträge zugeordnet.</div>
                ) : null}
                <div className="admin-cache-grid" style={{ gridTemplateColumns: 'repeat(1,minmax(0,1fr))' }}>
                  {linkedEntries.map((entry) => {
                    const pageContent = pageContentMap.get(Number(entry.entry_id))
                    return (
                      <article key={`page-linked-entry-${entry.entry_id}`} className="admin-cache-card">
                        <header className="admin-cache-card-header">
                          <strong>{entry.entry_name}</strong>
                          <span>ID {entry.entry_id}</span>
                        </header>
                        <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                        <div style={{ padding: 8 }}>
                          <button type="button" className="admin-primary-button" onClick={() => onEditEntry?.(entry)}>
                            Beitrag bearbeiten
                          </button>
                          <button type="button" className="admin-secondary-button" onClick={() => removeAssignment(pageContent?.page_content_id)}>
                            Zuordnung löschen
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>

              <div className="admin-panel" style={{ padding: 12 }}>
                <h5 style={{ marginTop: 0 }}>Beitrag suchen und zuordnen</h5>
                <div className="admin-toolbar" style={{ marginBottom: 12 }}>
                  <label className="admin-field">
                    <span>Freitext</span>
                    <input
                      type="search"
                      autoComplete="off"
                      inputMode="search"
                      value={entryQuery}
                      onChange={(event) => setEntryQuery(event.target.value)}
                      placeholder="Name, Kurztext oder Inhalt"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Section</span>
                    <select
                      value={entrySectionFilter}
                      onChange={(event) => {
                        setEntrySectionFilter(event.target.value)
                        setEntryCategoryFilter('')
                      }}
                    >
                      <option value="">Alle</option>
                      {sections.map((section) => (
                        <option key={`page-entry-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>Category</span>
                    <select value={entryCategoryFilter} onChange={(event) => setEntryCategoryFilter(event.target.value)}>
                      <option value="">Alle</option>
                      {filteredCategories.map((category) => (
                        <option key={`page-entry-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {!availableEntries.length && !entrySearchLoading ? (
                  <div className="admin-message">{entryQuery.trim() || entrySectionFilter || entryCategoryFilter ? 'Keine zuordenbaren Beiträge gefunden.' : 'Suchkriterien wählen, um Beiträge zu laden.'}</div>
                ) : null}
                <div className="admin-cache-grid" style={{ gridTemplateColumns: 'repeat(1,minmax(0,1fr))' }}>
                  {availableEntries.map((entry) => {
                    const category = categories.find((item) => Number(item.category_id) === Number(entry.category_id))
                    const section = sections.find((item) => Number(item.section_id) === Number(category?.section_id))
                    return (
                      <article key={`page-search-entry-${entry.entry_id}`} className="admin-cache-card">
                        <header className="admin-cache-card-header">
                          <strong>{entry.entry_name}</strong>
                          <span>{section?.section_name || 'Ohne Section'}</span>
                        </header>
                        <p style={{ margin: '0 0 4px 0', color: '#4b5d71' }}>
                          Category: {category?.category_name || 'Unbekannt'}
                        </p>
                        <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>
                          {entry.entry_short || 'Kein Kurztext'}
                        </p>
                        <div style={{ padding: 8 }}>
                          <button type="button" className="admin-primary-button" onClick={() => assignEntry(entry)}>
                            Zuordnen
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <div className="admin-action-group" style={{ marginTop: 12 }}>
                  <button type="button" className="admin-secondary-button" onClick={() => setEntrySearchPage((current) => current - 1)} disabled={!canEntryGoBack || entrySearchLoading}>
                    Zurück
                  </button>
                  <span style={{ color: '#4b5d71' }}>Seite {entrySearchPage}</span>
                  <button type="button" className="admin-secondary-button" onClick={() => setEntrySearchPage((current) => current + 1)} disabled={!canEntryGoForward || entrySearchLoading}>
                    Weiter
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { del, get, post, put } from '../../services/api'

const markdownComponents = {
  h1: ({ node, ...props }) => <h1 style={{ margin: '0 0 12px', fontSize: '1.4rem', lineHeight: 1.2 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '18px 0 10px', fontSize: '1.15rem', lineHeight: 1.25 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '14px 0 8px', fontSize: '1rem', lineHeight: 1.3 }} {...props} />,
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

const emptyEntryForm = {
  entry_name: '',
  entry_short: '',
  entry_content: '',
  generate_text: '',
  ispublic: false,
  entry_number: 0,
  section_id: '',
  category_id: '',
  entry_generate: false,
  entry_active: true,
  entry_published: '',
}

export default function AdminEntriesTab({ entryEditRequest }){
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [entryQuery, setEntryQuery] = useState('')
  const [entrySectionFilter, setEntrySectionFilter] = useState('')
  const [entryCategoryFilter, setEntryCategoryFilter] = useState('')
  const [entryLoading, setEntryLoading] = useState(false)
  const [entryError, setEntryError] = useState('')
  const [entrySuccess, setEntrySuccess] = useState('')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [hasLoadedSearch, setHasLoadedSearch] = useState(false)
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  async function loadSections(){
    try{
      const resp = await get('/auth/wiki/sections')
      if (!resp.ok) throw new Error(`Bereiche konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(_){
      setSections([])
    }
  }

  async function loadCategories(){
    try{
      const resp = await get('/auth/wiki/categories')
      if (!resp.ok) throw new Error(`Kategorien konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setCategories(Array.isArray(data) ? data : [])
    }catch(_){
      setCategories([])
    }
  }

  async function loadEntries(filters = {}){
    setEntryLoading(true)
    setEntryError('')
    try{
      const params = new URLSearchParams()
      if (filters.q) params.set('q', filters.q)
      if (filters.section_id) params.set('section_id', String(filters.section_id))
      if (filters.category_id) params.set('category_id', String(filters.category_id))
      params.set('limit', '100')
      const resp = await get(`/auth/wiki/entries?${params.toString()}`)
      if (!resp.ok) throw new Error(`Beiträge konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setEntries(Array.isArray(data) ? data : [])
      setHasLoadedSearch(true)
    }catch(err){
      setEntryError(err?.message || 'Beiträge konnten nicht geladen werden')
    }finally{
      setEntryLoading(false)
    }
  }

  function resetEntryForm(){
    setSelectedEntry({ ...emptyEntryForm })
    setEntryError('')
    setEntrySuccess('')
  }

  function editEntry(entry){
    const category = categories.find((item) => Number(item.category_id) === Number(entry.category_id))
    setSelectedEntry({
      entry_id: entry.entry_id,
      entry_name: entry.entry_name || '',
      entry_short: entry.entry_short || '',
      entry_content: entry.entry_content || '',
      generate_text: entry.generate_text || '',
      ispublic: entry.ispublic === true,
      entry_number: Number(entry.entry_number) || 0,
      section_id: category?.section_id ?? '',
      category_id: entry.category_id ?? '',
      entry_generate: entry.entry_generate === true,
      entry_active: entry.entry_active !== false,
      entry_published: entry.entry_published || '',
    })
    setEntryError('')
    setEntrySuccess('')
  }

  async function saveEntry(){
    if (!selectedEntry?.entry_name?.trim()){
      setEntryError('Bitte einen Beitragsnamen eingeben')
      return
    }
    if (!selectedEntry?.category_id && selectedEntry?.category_id !== 0){
      setEntryError('Bitte eine Kategorie auswählen')
      return
    }
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const payload = {
        entry_name: selectedEntry.entry_name.trim(),
        entry_short: selectedEntry.entry_short || null,
        entry_content: selectedEntry.entry_content || null,
        generate_text: selectedEntry.generate_text || null,
        ispublic: !!selectedEntry.ispublic,
        entry_number: Number(selectedEntry.entry_number) || 0,
        category_id: Number(selectedEntry.category_id),
        entry_generate: !!selectedEntry.entry_generate,
        entry_active: !!selectedEntry.entry_active,
        entry_published: selectedEntry.entry_published || null,
      }
      const isUpdate = !!selectedEntry.entry_id
      const resp = isUpdate
        ? await put(`/auth/wiki/entries/${selectedEntry.entry_id}`, payload)
        : await post('/auth/wiki/entries', payload)
      if (!resp.ok) throw new Error(`${isUpdate ? 'Speichern' : 'Anlegen'} fehlgeschlagen (${resp.status})`)
      const saved = await resp.json()
      await loadEntries({
        q: entryQuery.trim(),
        section_id: entrySectionFilter,
        category_id: entryCategoryFilter,
      })
      editEntry(saved)
      setEntrySuccess(isUpdate ? 'Beitrag aktualisiert' : 'Beitrag angelegt')
    }catch(err){
      setEntryError(err?.message || 'Beitrag konnte nicht gespeichert werden')
    }finally{
      setEntryLoading(false)
    }
  }

  async function generateText(){
    if (!selectedEntry?.entry_id){
      setEntryError('Bitte zuerst den Beitrag speichern, bevor ein Generierungstext erzeugt wird')
      return
    }
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const resp = await post(`/auth/wiki/entries/${selectedEntry.entry_id}/generate-text`, {})
      if (!resp.ok) throw new Error(`Generierung fehlgeschlagen (${resp.status})`)
      const saved = await resp.json()
      editEntry(saved)
      setEntrySuccess('Inhalt aus Generierungstext erstellt')
    }catch(err){
      setEntryError(err?.message || 'Inhalt konnte nicht generiert werden')
    }finally{
      setEntryLoading(false)
    }
  }

  async function deleteEntry(entryId){
    if (!window.confirm('Beitrag wirklich löschen?')) return
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const resp = await del(`/auth/wiki/entries/${entryId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadEntries({
        q: entryQuery.trim(),
        section_id: entrySectionFilter,
        category_id: entryCategoryFilter,
      })
      if (selectedEntry?.entry_id === entryId) setSelectedEntry(null)
      setEntrySuccess('Beitrag gelöscht')
    }catch(err){
      setEntryError(err?.message || 'Beitrag konnte nicht gelöscht werden')
    }finally{
      setEntryLoading(false)
    }
  }

  useEffect(() => {
    loadSections()
    loadCategories()
  }, [])

  useEffect(() => {
    if (!entryEditRequest?.entry) return
    if (entryEditRequest.entry.category_id != null && !categories.length) return
    editEntry(entryEditRequest.entry)
  }, [entryEditRequest, categories])

  useEffect(() => {
    const query = entryQuery.trim()
    const handle = window.setTimeout(() => {
      loadEntries({
        q: query,
        section_id: entrySectionFilter,
        category_id: entryCategoryFilter,
      })
    }, query ? 250 : 0)
    return () => window.clearTimeout(handle)
  }, [entryQuery, entrySectionFilter, entryCategoryFilter])

  useEffect(() => {
    if (!isContentExpanded) return undefined

    function handleKeyDown(event){
      if (event.key === 'Escape') setIsContentExpanded(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isContentExpanded])

  const filteredCategories = useMemo(() => {
    if (!entrySectionFilter) return categories
    return categories.filter((category) => Number(category.section_id) === Number(entrySectionFilter))
  }, [categories, entrySectionFilter])

  const formCategories = useMemo(() => {
    if (!selectedEntry?.section_id) return categories
    return categories.filter((category) => Number(category.section_id) === Number(selectedEntry.section_id))
  }, [categories, selectedEntry])

  const entryContentPreview = selectedEntry?.entry_content || ''

  return (
    <section className="admin-panel" aria-label="Beiträge verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Beiträge verwalten</h3>
          <p>Beiträge anlegen, suchen, bearbeiten und löschen. Die Trefferliste wird serverseitig gefiltert.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={resetEntryForm}>
            Neuer Beitrag
          </button>
          <button
            type="button"
            className="admin-primary-button"
            onClick={() => loadEntries({
              q: entryQuery.trim(),
              section_id: entrySectionFilter,
              category_id: entryCategoryFilter,
            })}
            disabled={entryLoading}
          >
            {entryLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Freitext</span>
          <input value={entryQuery} onChange={(event) => setEntryQuery(event.target.value)} placeholder="Name, Kurztext oder Inhalt" />
        </label>
        <label className="admin-field">
          <span>Bereich</span>
          <select
            value={entrySectionFilter}
            onChange={(event) => {
              setEntrySectionFilter(event.target.value)
              setEntryCategoryFilter('')
            }}
          >
            <option value="">Alle</option>
            {sections.map((section) => (
              <option key={`entry-filter-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Kategorie</span>
          <select value={entryCategoryFilter} onChange={(event) => setEntryCategoryFilter(event.target.value)}>
            <option value="">Alle</option>
            {filteredCategories.map((category) => (
              <option key={`entry-filter-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
            ))}
          </select>
        </label>
      </div>

      {entryError ? <div className="admin-message admin-error">{entryError}</div> : null}
      {entrySuccess ? <div className="admin-message admin-success">{entrySuccess}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          {!entries.length && !entryLoading ? (
            <div className="admin-message">{hasLoadedSearch ? 'Keine Beiträge gefunden.' : 'Wähle Suchkriterien, um Beiträge zu laden.'}</div>
          ) : null}
          <div className="admin-cache-grid">
            {entries.map((entry) => {
              const category = categories.find((item) => Number(item.category_id) === Number(entry.category_id))
              const section = sections.find((item) => Number(item.section_id) === Number(category?.section_id))
              return (
                <article key={`entry-${entry.entry_id}`} className="admin-cache-card">
                  <header className="admin-cache-card-header">
                      <strong>{entry.entry_name}</strong>
                      <span>{entry.entry_active ? 'Aktiv' : 'Inaktiv'}</span>
                      <span style={{ marginLeft: 8 }}>{entry.ispublic ? 'Öffentlich' : 'Privat'}</span>
                  </header>
                  <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>
                    {entry.entry_short || 'Kein Kurztext'}
                  </p>
                  <p style={{ margin: '0 0 4px 0', color: '#4b5d71' }}>
                    Bereich: {section?.section_name || 'Unbekannt'}
                  </p>
                  <p style={{ margin: '0 0 4px 0', color: '#4b5d71' }}>
                    Kategorie: {category?.category_name || 'Unbekannt'}
                  </p>
                  <p style={{ margin: '0 0 12px 0', color: '#4b5d71' }}>
                    Nummer: {entry.entry_number ?? 0}
                  </p>
                  <div style={{ padding: 8 }}>
                    <button type="button" className="admin-primary-button" onClick={() => editEntry(entry)}>
                      Bearbeiten
                    </button>
                    <button type="button" className="admin-secondary-button" onClick={() => deleteEntry(entry.entry_id)} style={{ marginLeft: 8 }}>
                      Löschen
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <div style={{ width: 460, maxWidth: '100%' }}>
          <div className="admin-panel" style={{ padding: 12 }}>
            <h4>{selectedEntry?.entry_id ? 'Beitrag bearbeiten' : 'Beitrag anlegen'}</h4>
            <label className="admin-field">
              <span>Name</span>
              <input
                value={selectedEntry?.entry_name || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_name: event.target.value }))}
              />
            </label>
            <label className="admin-field">
              <span>Bereich</span>
              <select
                value={selectedEntry?.section_id ?? ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), section_id: event.target.value, category_id: '' }))}
              >
                <option value="">Bitte wählen</option>
                {sections.map((section) => (
                  <option key={`entry-form-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Kategorie</span>
              <select
                value={selectedEntry?.category_id ?? ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), category_id: event.target.value }))}
              >
                <option value="">Bitte wählen</option>
                {formCategories.map((category) => (
                  <option key={`entry-form-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Kurztext</span>
              <textarea
                value={selectedEntry?.entry_short || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_short: event.target.value }))}
                rows={3}
              />
            </label>
            <label className="admin-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span>Inhalt</span>
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setIsContentExpanded((current) => !current)}
                  style={{ padding: '6px 12px' }}
                >
                  {isContentExpanded ? 'Klein anzeigen' : 'Groß anzeigen'}
                </button>
              </div>
              <textarea
                value={selectedEntry?.entry_content || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_content: event.target.value }))}
                rows={8}
              />
            </label>
            <div className="admin-field">
              <span>Markdown Vorschau</span>
              <div style={{ border: '1px solid #dde1e7', borderRadius: 14, background: '#fbfcfe', color: '#203244', overflow: 'hidden' }}>
                <div style={{ height: 240, overflowX: 'auto', overflowY: 'auto', padding: 14 }}>
                  {entryContentPreview.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {entryContentPreview}
                    </ReactMarkdown>
                  ) : (
                    <div style={{ color: '#6b7c8d' }}>Die Markdown-Vorschau erscheint hier, sobald Inhalt eingegeben wurde.</div>
                  )}
                </div>
              </div>
            </div>
            <label className="admin-field">
              <span>Generierungstext</span>
              <textarea
                value={selectedEntry?.generate_text || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), generate_text: event.target.value }))}
                rows={8}
              />
            </label>
            <label className="admin-field">
              <span>Nummer</span>
              <input
                type="number"
                value={selectedEntry?.entry_number ?? 0}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_number: Number(event.target.value) || 0 }))}
              />
            </label>
            <label className="admin-field">
              <span>Veröffentlicht</span>
              <input
                type="date"
                value={selectedEntry?.entry_published || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_published: event.target.value }))}
              />
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.entry_generate === true}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_generate: event.target.checked }))}
              />
              <span>Automatisch generieren</span>
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.entry_active !== false}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_active: event.target.checked }))}
              />
              <span>Aktiv</span>
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.ispublic === true}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), ispublic: event.target.checked }))}
              />
              <span>Öffentlich</span>
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="admin-primary-button" onClick={saveEntry} disabled={entryLoading}>
                {selectedEntry?.entry_id ? 'Änderungen speichern' : 'Beitrag anlegen'}
              </button>
              <button className="admin-secondary-button" onClick={generateText} disabled={entryLoading || !selectedEntry?.entry_id} style={{ marginLeft: 8 }}>
                Text Generieren
              </button>
              <button className="admin-secondary-button" onClick={resetEntryForm} style={{ marginLeft: 8 }}>
                Zurücksetzen
              </button>
            </div>
          </div>
        </div>
      </div>

      {isContentExpanded ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(16, 24, 40, 0.55)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            className="admin-panel"
            style={{
              width: 'min(1400px, 100%)',
              height: '100%',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <h4 style={{ margin: 0 }}>Inhalt groß bearbeiten</h4>
                <p style={{ margin: '4px 0 0 0', color: '#4b5d71' }}>Escape oder Button schließt die Großansicht.</p>
              </div>
              <button type="button" className="admin-secondary-button" onClick={() => setIsContentExpanded(false)}>
                Klein anzeigen
              </button>
            </div>
            <textarea
              value={selectedEntry?.entry_content || ''}
              onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_content: event.target.value }))}
              style={{ flex: 1, minHeight: 0, width: '100%', resize: 'none' }}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
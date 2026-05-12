import React, { useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from '../../services/api'

const emptySectionForm = {
  section_name: '',
  section_description: '',
  section_sort: 0,
  section_active: true,
  wiki_active: true,
}

export default function AdminSectionsTab(){
  const [sections, setSections] = useState([])
  const [sectionQuery, setSectionQuery] = useState('')
  const [sectionLoading, setSectionLoading] = useState(false)
  const [sectionError, setSectionError] = useState('')
  const [sectionSuccess, setSectionSuccess] = useState('')
  const [selectedSection, setSelectedSection] = useState(null)

  async function loadSections(){
    setSectionLoading(true)
    setSectionError('')
    try{
      const resp = await get('/wiki/sections')
      if (!resp.ok) throw new Error(`Bereiche konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(err){
      setSectionError(err?.message || 'Bereiche konnten nicht geladen werden')
    }finally{
      setSectionLoading(false)
    }
  }

  function resetSectionForm(){
    setSelectedSection({ ...emptySectionForm })
    setSectionError('')
    setSectionSuccess('')
  }

  function editSection(section){
    setSelectedSection({
      section_id: section.section_id,
      section_name: section.section_name || '',
      section_description: section.section_description || '',
      section_sort: Number(section.section_sort) || 0,
      section_active: section.section_active !== false,
      wiki_active: section.wiki_active !== false,
    })
    setSectionError('')
    setSectionSuccess('')
  }

  async function saveSection(){
    if (!selectedSection?.section_name?.trim()){
      setSectionError('Bitte einen Bereichs-Namen eingeben')
      return
    }
    setSectionLoading(true)
    setSectionError('')
    setSectionSuccess('')
    try{
      const payload = {
        section_name: selectedSection.section_name.trim(),
        section_description: selectedSection.section_description || null,
        section_sort: Number(selectedSection.section_sort) || 0,
        section_active: !!selectedSection.section_active,
        wiki_active: !!selectedSection.wiki_active,
      }
      const isUpdate = !!selectedSection.section_id
      const resp = isUpdate
        ? await put(`/wiki/sections/${selectedSection.section_id}`, payload)
        : await post('/wiki/sections', payload)
      if (!resp.ok) throw new Error(`${isUpdate ? 'Speichern' : 'Anlegen'} fehlgeschlagen (${resp.status})`)
      const saved = await resp.json()
      await loadSections()
      editSection(saved)
      setSectionSuccess(isUpdate ? 'Bereich aktualisiert' : 'Bereich angelegt')
    }catch(err){
      setSectionError(err?.message || 'Bereich konnte nicht gespeichert werden')
    }finally{
      setSectionLoading(false)
    }
  }

  async function deleteSection(sectionId){
    if (!window.confirm('Bereich wirklich löschen?')) return
    setSectionLoading(true)
    setSectionError('')
    setSectionSuccess('')
    try{
      const resp = await del(`/wiki/sections/${sectionId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadSections()
      if (selectedSection?.section_id === sectionId) setSelectedSection(null)
      setSectionSuccess('Bereich gelöscht')
    }catch(err){
      setSectionError(err?.message || 'Bereich konnte nicht gelöscht werden')
    }finally{
      setSectionLoading(false)
    }
  }

  useEffect(() => {
    loadSections()
  }, [])

  const filteredSections = useMemo(() => {
    const needle = sectionQuery.trim().toLowerCase()
    if (!needle) return sections
    return sections.filter((section) => {
      const haystack = [section.section_name, section.section_description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [sectionQuery, sections])

  return (
    <section className="admin-panel" aria-label="Bereiche verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Bereiche verwalten</h3>
          <p>Bereiche anlegen, suchen, bearbeiten und löschen.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={resetSectionForm}>
            Neuer Bereich
          </button>
          <button type="button" className="admin-primary-button" onClick={loadSections} disabled={sectionLoading}>
            {sectionLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Suche</span>
          <input value={sectionQuery} onChange={(event) => setSectionQuery(event.target.value)} placeholder="Name oder Beschreibung" />
        </label>
      </div>

      {sectionError ? <div className="admin-message admin-error">{sectionError}</div> : null}
      {sectionSuccess ? <div className="admin-message admin-success">{sectionSuccess}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          {!filteredSections.length && !sectionLoading ? (
            <div className="admin-message">Keine Bereiche gefunden.</div>
          ) : null}
          <div className="admin-cache-grid">
            {filteredSections.map((section) => (
              <article key={`section-${section.section_id}`} className="admin-cache-card">
                <header className="admin-cache-card-header">
                  <strong>{section.section_name}</strong>
                  <span>{section.section_active ? 'Aktiv' : 'Inaktiv'}</span>
                </header>
                <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>
                  {section.section_description || 'Keine Beschreibung'}
                </p>
                <p style={{ margin: '0 0 12px 0', color: '#4b5d71' }}>
                  Sortierung: {section.section_sort ?? 0}
                </p>
                <p style={{ margin: '0 0 12px 0', color: '#4b5d71' }}>
                  Wiki: {section.wiki_active !== false ? 'Aktiv' : 'Inaktiv'}
                </p>
                <div style={{ padding: 8 }}>
                  <button type="button" className="admin-primary-button" onClick={() => editSection(section)}>
                    Bearbeiten
                  </button>
                  <button type="button" className="admin-secondary-button" onClick={() => deleteSection(section.section_id)} style={{ marginLeft: 8 }}>
                    Löschen
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div style={{ width: 420, maxWidth: '100%' }}>
          <div className="admin-panel" style={{ padding: 12 }}>
            <h4>{selectedSection?.section_id ? 'Bereich bearbeiten' : 'Bereich anlegen'}</h4>
            <label className="admin-field">
              <span>Name</span>
              <input
                value={selectedSection?.section_name || ''}
                onChange={(event) => setSelectedSection((current) => ({ ...(current || emptySectionForm), section_name: event.target.value }))}
              />
            </label>
            <label className="admin-field">
              <span>Beschreibung</span>
              <textarea
                value={selectedSection?.section_description || ''}
                onChange={(event) => setSelectedSection((current) => ({ ...(current || emptySectionForm), section_description: event.target.value }))}
                rows={6}
              />
            </label>
            <label className="admin-field">
              <span>Sortierung</span>
              <input
                type="number"
                value={selectedSection?.section_sort ?? 0}
                onChange={(event) => setSelectedSection((current) => ({ ...(current || emptySectionForm), section_sort: Number(event.target.value) || 0 }))}
              />
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedSection?.section_active !== false}
                onChange={(event) => setSelectedSection((current) => ({ ...(current || emptySectionForm), section_active: event.target.checked }))}
              />
              <span>Aktiv</span>
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedSection?.wiki_active !== false}
                onChange={(event) => setSelectedSection((current) => ({ ...(current || emptySectionForm), wiki_active: event.target.checked }))}
              />
              <span>Wiki Aktiv</span>
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="admin-primary-button" onClick={saveSection} disabled={sectionLoading}>
                {selectedSection?.section_id ? 'Änderungen speichern' : 'Bereich anlegen'}
              </button>
              <button className="admin-secondary-button" onClick={resetSectionForm} style={{ marginLeft: 8 }}>
                Zurücksetzen
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
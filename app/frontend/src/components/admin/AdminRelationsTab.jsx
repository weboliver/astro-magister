import React, { useEffect, useMemo, useState } from 'react'
import { del, get, post } from '../../services/api'

const SEARCH_PAGE_SIZE = 5

/**
 * AdminRelationsTab - Admin panel tab for managing entry relationships (related entries)
 * @component
 * @param {Object} props - Component props
 * @param {Function} [props.onEditEntry] - Optional callback to edit an entry
 * @returns {JSX.Element} Rendered relations management interface for linking entries
 */
export default function AdminRelationsTab({ onEditEntry }){
  const [leftQuery, setLeftQuery] = useState('')
  const [leftLoading, setLeftLoading] = useState(false)
  const [leftResults, setLeftResults] = useState([])
  const [leftPage, setLeftPage] = useState(1)
  const [selectedEntry, setSelectedEntry] = useState(null)

  const [relationsLoading, setRelationsLoading] = useState(false)
  const [linkedRelations, setLinkedRelations] = useState([])
  const [linkedEntries, setLinkedEntries] = useState([])

  const [rightQuery, setRightQuery] = useState('')
  const [rightLoading, setRightLoading] = useState(false)
  const [rightResults, setRightResults] = useState([])
  const [rightPage, setRightPage] = useState(1)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function fetchEntry(entryId){
    const resp = await get(`/wiki/entries/${entryId}`)
    if (!resp.ok) throw new Error(`Beitrag ${entryId} konnte nicht geladen werden (${resp.status})`)
    return resp.json()
  }

  async function searchEntries(query, page, setter, loadingSetter){
    loadingSetter(true)
    setError('')
    try{
      const params = new URLSearchParams({
        limit: String(SEARCH_PAGE_SIZE),
        offset: String((page - 1) * SEARCH_PAGE_SIZE),
      })
      if (query?.trim()) params.set('q', query.trim())
      const resp = await get(`/wiki/entries?${params.toString()}`)
      if (!resp.ok) throw new Error(`Beiträge konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setter(Array.isArray(data) ? data : [])
    }catch(err){
      setError(err?.message || 'Beiträge konnten nicht geladen werden')
      setter([])
    }finally{
      loadingSetter(false)
    }
  }

  async function loadRelations(entry){
    if (!entry?.entry_id){
      setLinkedRelations([])
      setLinkedEntries([])
      return
    }
    setRelationsLoading(true)
    setError('')
    try{
      const params = new URLSearchParams({ entry_from_id: String(entry.entry_id) })
      const resp = await get(`/wiki/relations?${params.toString()}`)
      if (!resp.ok) throw new Error(`Relationen konnten nicht geladen werden (${resp.status})`)
      const relations = await resp.json()
      const relationList = Array.isArray(relations) ? relations : []
      setLinkedRelations(relationList)
      if (!relationList.length){
        setLinkedEntries([])
        return
      }
      const entries = await Promise.all(relationList.map((relation) => fetchEntry(relation.entry_to_id)))
      setLinkedEntries(entries)
    }catch(err){
      setError(err?.message || 'Relationen konnten nicht geladen werden')
      setLinkedRelations([])
      setLinkedEntries([])
    }finally{
      setRelationsLoading(false)
    }
  }

  async function addRelation(targetEntry){
    if (!selectedEntry?.entry_id || !targetEntry?.entry_id) return
    setError('')
    setSuccess('')
    try{
      const resp = await post('/wiki/relations', {
        entry_from_id: selectedEntry.entry_id,
        entry_to_id: targetEntry.entry_id,
      })
      if (!resp.ok) throw new Error(`Relation konnte nicht angelegt werden (${resp.status})`)
      await loadRelations(selectedEntry)
      setSuccess('Relation angelegt')
    }catch(err){
      setError(err?.message || 'Relation konnte nicht angelegt werden')
    }
  }

  async function removeRelation(relationId){
    if (!relationId) return
    setError('')
    setSuccess('')
    try{
      const resp = await del(`/wiki/relations/${relationId}`)
      if (!resp.ok) throw new Error(`Relation konnte nicht gelöscht werden (${resp.status})`)
      await loadRelations(selectedEntry)
      setSuccess('Relation gelöscht')
    }catch(err){
      setError(err?.message || 'Relation konnte nicht gelöscht werden')
    }
  }

  useEffect(() => {
    setLeftPage(1)
  }, [leftQuery])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      searchEntries(leftQuery, leftPage, setLeftResults, setLeftLoading)
    }, leftQuery.trim() ? 250 : 0)
    return () => window.clearTimeout(handle)
  }, [leftQuery, leftPage])

  useEffect(() => {
    setRightPage(1)
  }, [rightQuery, selectedEntry])

  useEffect(() => {
    if (!selectedEntry?.entry_id){
      setRightResults([])
      return
    }
    if (!rightQuery.trim()){
      setRightResults([])
      return
    }
    const handle = window.setTimeout(() => {
      searchEntries(rightQuery, rightPage, setRightResults, setRightLoading)
    }, 250)
    return () => window.clearTimeout(handle)
  }, [rightQuery, rightPage, selectedEntry])

  useEffect(() => {
    loadRelations(selectedEntry)
  }, [selectedEntry])

  const linkedRelationMap = useMemo(() => {
    const map = new Map()
    linkedRelations.forEach((relation) => {
      map.set(Number(relation.entry_to_id), relation)
    })
    return map
  }, [linkedRelations])

  const availableRightResults = useMemo(() => {
    return rightResults.filter((entry) => {
      if (!selectedEntry?.entry_id) return false
      if (Number(entry.entry_id) === Number(selectedEntry.entry_id)) return false
      return !linkedRelationMap.has(Number(entry.entry_id))
    })
  }, [rightResults, selectedEntry, linkedRelationMap])

  const canLeftGoBack = leftPage > 1
  const canLeftGoForward = leftResults.length === SEARCH_PAGE_SIZE
  const canRightGoBack = rightPage > 1
  const canRightGoForward = rightResults.length === SEARCH_PAGE_SIZE

  return (
    <section className="admin-panel" aria-label="Relationen verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Relationen verwalten</h3>
          <p>Links Beitrag suchen und auswählen, rechts bestehende Verknüpfungen verwalten und neue Beiträge zuordnen.</p>
        </div>
      </div>

      {error ? <div className="admin-message admin-error">{error}</div> : null}
      {success ? <div className="admin-message admin-success">{success}</div> : null}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
        <div className="admin-panel" style={{ padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Beitrag auswählen</h4>
          <label className="admin-field">
            <span>Suche links</span>
            <input
              value={leftQuery}
              onChange={(event) => setLeftQuery(event.target.value)}
              placeholder="Beitragsname oder Inhalt"
            />
          </label>
          {!leftResults.length && !leftLoading ? (
            <div className="admin-message">{leftQuery.trim() ? 'Keine Treffer gefunden.' : 'Suche nach einem Beitrag.'}</div>
          ) : null}
          <div className="admin-cache-grid" style={{ gridTemplateColumns: 'repeat(1,minmax(0,1fr))' }}>
            {leftResults.map((entry) => {
              const isSelected = Number(selectedEntry?.entry_id) === Number(entry.entry_id)
              return (
                <article key={`left-entry-${entry.entry_id}`} className="admin-cache-card" style={isSelected ? { outline: '2px solid #11243d' } : undefined}>
                  <header className="admin-cache-card-header">
                    <strong>{entry.entry_name}</strong>
                    <span>ID {entry.entry_id}</span>
                  </header>
                  <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                  <div style={{ padding: 8 }}>
                    <button type="button" className="admin-primary-button" onClick={() => setSelectedEntry(entry)}>
                      {isSelected ? 'Ausgewählt' : 'Auswählen'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="admin-action-group" style={{ marginTop: 12 }}>
            <button type="button" className="admin-secondary-button" onClick={() => setLeftPage((current) => current - 1)} disabled={!canLeftGoBack || leftLoading}>
              Zurück
            </button>
            <span style={{ color: '#4b5d71' }}>Seite {leftPage}</span>
            <button type="button" className="admin-secondary-button" onClick={() => setLeftPage((current) => current + 1)} disabled={!canLeftGoForward || leftLoading}>
              Weiter
            </button>
          </div>
        </div>

        <div className="admin-panel" style={{ padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Verknüpfungen</h4>
          {selectedEntry ? (
            <p style={{ marginTop: 0, color: '#4b5d71' }}>
              Ausgewählter Beitrag: <strong>{selectedEntry.entry_name}</strong>
            </p>
          ) : (
            <div className="admin-message">Links einen Beitrag auswählen, um Relationen zu verwalten.</div>
          )}

          {selectedEntry ? (
            <>
              <div className="admin-panel" style={{ padding: 12, marginBottom: 16 }}>
                <h5 style={{ marginTop: 0 }}>Bereits verknüpfte Beiträge</h5>
                {!linkedEntries.length && !relationsLoading ? (
                  <div className="admin-message">Keine Relationen vorhanden.</div>
                ) : null}
                <div className="admin-cache-grid" style={{ gridTemplateColumns: 'repeat(1,minmax(0,1fr))' }}>
                  {linkedEntries.map((entry) => {
                    const relation = linkedRelationMap.get(Number(entry.entry_id))
                    return (
                      <article key={`linked-entry-${entry.entry_id}`} className="admin-cache-card">
                        <header className="admin-cache-card-header">
                          <strong>{entry.entry_name}</strong>
                          <span>ID {entry.entry_id}</span>
                        </header>
                        <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                        <div style={{ padding: 8 }}>
                          <button type="button" className="admin-primary-button" onClick={() => onEditEntry?.(entry)}>
                            Beitrag bearbeiten
                          </button>
                          <button type="button" className="admin-secondary-button" onClick={() => removeRelation(relation?.relation_id)}>
                            Verknüpfung lösen
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>

              <div className="admin-panel" style={{ padding: 12 }}>
                <h5 style={{ marginTop: 0 }}>Neue Relation hinzufügen</h5>
                <label className="admin-field">
                  <span>Suche rechts</span>
                  <input
                    type="search"
                    autoComplete="off"
                    inputMode="search"
                    value={rightQuery}
                    onChange={(event) => setRightQuery(event.target.value)}
                    placeholder="Beitrag zum Verknüpfen suchen"
                  />
                </label>
                {!availableRightResults.length && !rightLoading ? (
                  <div className="admin-message">{rightQuery.trim() ? 'Keine zuordenbaren Treffer gefunden.' : 'Suche nach einem Beitrag zum Zuordnen.'}</div>
                ) : null}
                <div className="admin-cache-grid" style={{ gridTemplateColumns: 'repeat(1,minmax(0,1fr))' }}>
                  {availableRightResults.map((entry) => (
                    <article key={`right-entry-${entry.entry_id}`} className="admin-cache-card">
                      <header className="admin-cache-card-header">
                        <strong>{entry.entry_name}</strong>
                        <span>ID {entry.entry_id}</span>
                      </header>
                      <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{entry.entry_short || 'Kein Kurztext'}</p>
                      <div style={{ padding: 8 }}>
                        <button type="button" className="admin-primary-button" onClick={() => addRelation(entry)}>
                          Zuordnen
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="admin-action-group" style={{ marginTop: 12 }}>
                  <button type="button" className="admin-secondary-button" onClick={() => setRightPage((current) => current - 1)} disabled={!canRightGoBack || rightLoading}>
                    Zurück
                  </button>
                  <span style={{ color: '#4b5d71' }}>Seite {rightPage}</span>
                  <button type="button" className="admin-secondary-button" onClick={() => setRightPage((current) => current + 1)} disabled={!canRightGoForward || rightLoading}>
                    Weiter
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
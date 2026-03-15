import React, { useEffect, useState } from 'react'
import { del, get } from '../../services/api'

const DEFAULT_LIMIT = 50
const PAGE_SIZE_OPTIONS = [25, 50, 100]

function formatTimestamp(value){
  if (!value) return 'Unbekannt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function AdminAuditLogTab(){
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [eventType, setEventType] = useState('')
  const [successFilter, setSuccessFilter] = useState('')
  const [pageSize, setPageSize] = useState(DEFAULT_LIMIT)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  async function loadAuditLog(nextOffset = offset, nextPageSize = pageSize, nextFilters = {}){
    setLoading(true)
    setError('')
    setSuccessMessage('')
    try{
      const effectiveQuery = Object.prototype.hasOwnProperty.call(nextFilters, 'query') ? nextFilters.query : query
      const effectiveEventType = Object.prototype.hasOwnProperty.call(nextFilters, 'eventType') ? nextFilters.eventType : eventType
      const effectiveSuccessFilter = Object.prototype.hasOwnProperty.call(nextFilters, 'successFilter') ? nextFilters.successFilter : successFilter
      const params = new URLSearchParams()
      params.set('limit', String(nextPageSize))
      params.set('offset', String(nextOffset))
      if (effectiveQuery.trim()) params.set('query', effectiveQuery.trim())
      if (effectiveEventType.trim()) params.set('event_type', effectiveEventType.trim())
      if (effectiveSuccessFilter === 'true' || effectiveSuccessFilter === 'false') params.set('success', effectiveSuccessFilter)

      const resp = await get(`/auth/audit-log?${params.toString()}`)
      if (!resp.ok) throw new Error(`Audit Log konnte nicht geladen werden (${resp.status})`)

      const data = await resp.json()
      const rows = Array.isArray(data) ? data : []
      setEntries(rows)
      setOffset(nextOffset)
      setHasMore(rows.length === nextPageSize)
    }catch(err){
      setError(err?.message || 'Audit Log konnte nicht geladen werden')
      setEntries([])
      setHasMore(false)
    }finally{
      setLoading(false)
    }
  }

  function applyFilters(){
    loadAuditLog(0, pageSize)
  }

  function resetFilters(){
    setQuery('')
    setEventType('')
    setSuccessFilter('')
    loadAuditLog(0, pageSize, { query: '', eventType: '', successFilter: '' })
  }

  function goToPreviousPage(){
    if (offset === 0 || loading) return
    loadAuditLog(Math.max(0, offset - pageSize), pageSize)
  }

  function goToNextPage(){
    if (!hasMore || loading) return
    loadAuditLog(offset + pageSize, pageSize)
  }

  function handlePageSizeChange(event){
    const nextPageSize = Number.parseInt(event.target.value, 10) || DEFAULT_LIMIT
    setPageSize(nextPageSize)
    loadAuditLog(0, nextPageSize)
  }

  function handleKeyDown(event){
    if (event.key !== 'Enter') return
    event.preventDefault()
    applyFilters()
  }

  async function handleDeleteOldEntries(){
    if (deleting) return
    const confirmed = window.confirm('Audit-Eintraege loeschen, die aelter als 3 Monate sind? Dieser Vorgang kann nicht rueckgaengig gemacht werden.')
    if (!confirmed) return

    setDeleting(true)
    setError('')
    setSuccessMessage('')
    try {
      const resp = await del('/auth/audit-log?older_than_months=3')
      if (!resp.ok) throw new Error(`Audit Log konnte nicht bereinigt werden (${resp.status})`)
      const data = await resp.json()
      const deletedCount = Number.parseInt(data.deleted_count, 10) || 0
      setSuccessMessage(`${deletedCount} Audit-Eintraege entfernt, die aelter als 3 Monate sind.`)
      await loadAuditLog(0, pageSize)
    } catch (err) {
      setError(err?.message || 'Audit Log konnte nicht bereinigt werden')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    loadAuditLog(0, DEFAULT_LIMIT)
  }, [])

  const currentPage = Math.floor(offset / pageSize) + 1
  const rangeStart = entries.length ? offset + 1 : 0
  const rangeEnd = offset + entries.length

  return (
    <section className="admin-panel" aria-label="Auth Audit Log">
      <div className="admin-panel-header">
        <div>
          <h3>Auth Audit Log</h3>
          <p>Zeigt Login-, Lockout-, Captcha- und Rate-Limit-Ereignisse der Anmeldung.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button settings-danger-button" onClick={handleDeleteOldEntries} disabled={loading || deleting}>{deleting ? 'Lösche...' : 'Älter als 3 Monate löschen'}</button>
          <button type="button" className="admin-secondary-button" onClick={() => loadAuditLog(offset, pageSize)} disabled={loading}>{loading ? 'Lade...' : 'Aktualisieren'}</button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Suche</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Benutzer, Detail oder IP" />
        </label>
        <label className="admin-field">
          <span>Event</span>
          <input value={eventType} onChange={(event) => setEventType(event.target.value)} onKeyDown={handleKeyDown} placeholder="z.B. login_failed" />
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select value={successFilter} onChange={(event) => setSuccessFilter(event.target.value)}>
            <option value="">Alle</option>
            <option value="true">Erfolg</option>
            <option value="false">Fehler</option>
          </select>
        </label>
        <label className="admin-field admin-field-compact">
          <span>Pro Seite</span>
          <select value={pageSize} onChange={handlePageSizeChange}>
            {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={applyFilters} disabled={loading}>Filtern</button>
          <button type="button" className="admin-secondary-button" onClick={resetFilters} disabled={loading}>Zuruecksetzen</button>
        </div>
      </div>

      {error ? <div className="admin-message admin-error">{error}</div> : null}
      {successMessage ? <div className="admin-message admin-success">{successMessage}</div> : null}
      {!error && !entries.length && !loading ? <div className="admin-message">Keine Audit-Einträge gefunden.</div> : null}

      <div className="admin-audit-list">
        {entries.map((entry) => (
          <article key={`audit-${entry.id}`} className="admin-cache-card admin-audit-card">
            <header className="admin-cache-card-header">
              <strong>{entry.event_type}</strong>
              <span className={entry.success ? 'admin-audit-badge admin-audit-badge-success' : 'admin-audit-badge admin-audit-badge-failure'}>
                {entry.success ? 'Erfolg' : 'Fehler'}
              </span>
            </header>
            <div className="admin-audit-meta">
              <span>{formatTimestamp(entry.created)}</span>
              <span>{entry.username || 'Ohne Benutzer'}</span>
              <span>{entry.ip_address || 'Ohne IP'}</span>
            </div>
            <p className="admin-audit-detail">{entry.detail || 'Kein Detail gespeichert.'}</p>
            {entry.user_agent ? <p className="admin-audit-user-agent">{entry.user_agent}</p> : null}
          </article>
        ))}
      </div>

      <div className="admin-pagination" aria-label="Audit Log Pagination">
        <div className="admin-pagination-summary">
          <strong>Seite {currentPage}</strong>
          <span>{rangeStart ? `${rangeStart}-${rangeEnd}` : '0'} Eintraege</span>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={goToPreviousPage} disabled={loading || offset === 0}>Zurueck</button>
          <button type="button" className="admin-secondary-button" onClick={goToNextPage} disabled={loading || !hasMore}>Weiter</button>
        </div>
      </div>
    </section>
  )
}
import React, { useEffect, useMemo, useState } from 'react'
import { del, get } from '../../services/api'
import { formatTtl } from './cacheUtils'

export default function AdminCacheTab(){
  const [cacheData, setCacheData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [limit, setLimit] = useState(100)
  const [includeValues, setIncludeValues] = useState(false)
  const [valueMaxLength, setValueMaxLength] = useState(1200)

  async function loadCache(){
    setLoading(true)
    setError('')
    try{
      const params = new URLSearchParams({
        limit: String(limit),
        include_values: includeValues ? 'true' : 'false',
        value_max_length: String(valueMaxLength),
      })
      const response = await get(`/auth/cache/redis?${params.toString()}`)
      if (!response.ok){
        let detail = `Cache konnte nicht geladen werden (${response.status})`
        try{
          const data = await response.json()
          if (data?.detail) detail = data.detail
        }catch(_){
          const text = await response.text()
          if (text) detail = text
        }
        throw new Error(detail)
      }
      const data = await response.json()
      setCacheData(data)
    }catch(err){
      setError(err?.message || 'Cache konnte nicht geladen werden')
    }finally{
      setLoading(false)
    }
  }

  async function deleteCache(key = null){
    const message = key
      ? 'Diesen Cache-Eintrag wirklich löschen?'
      : 'Den kompletten Cache wirklich löschen?'
    if (typeof window !== 'undefined' && !window.confirm(message)) return

    setLoading(true)
    setError('')
    setSuccess('')
    try{
      const params = key ? `?${new URLSearchParams({ key }).toString()}` : ''
      const response = await del(`/auth/cache/redis${params}`)
      if (!response.ok){
        let detail = `Cache konnte nicht geloescht werden (${response.status})`
        try{
          const data = await response.json()
          if (data?.detail) detail = data.detail
        }catch(_){
          const text = await response.text()
          if (text) detail = text
        }
        throw new Error(detail)
      }
      const data = await response.json()
      setSuccess(
        key
          ? `Cache-Eintrag geloescht: ${data.deleted_count}`
          : `Cache geleert: ${data.deleted_count} Eintraege entfernt`
      )
      await loadCache()
    }catch(err){
      setError(err?.message || 'Cache konnte nicht geloescht werden')
    }finally{
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCache()
  }, [])

  const entryStats = useMemo(() => {
    const entries = Array.isArray(cacheData?.entries) ? cacheData.entries : []
    return { entries }
  }, [cacheData])

  return (
    <section className="admin-panel" aria-label="Redis Cache Eintraege">
      <div className="admin-panel-header">
        <div>
          <h3>Cache-Eintraege</h3>
          <p>Zeigt die aktuell verfuegbaren Eintraege aus dem konfigurierten Cache-Backend.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={() => deleteCache()} disabled={loading}>
            Alles loeschen
          </button>
          <button type="button" className="admin-primary-button" onClick={loadCache} disabled={loading}>
            {loading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Limit</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Maximale Textlaenge</span>
          <input
            type="number"
            min={50}
            max={20000}
            step={50}
            value={valueMaxLength}
            onChange={(event) => setValueMaxLength(Number(event.target.value) || 50)}
          />
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={includeValues}
            onChange={(event) => setIncludeValues(event.target.checked)}
          />
          <span>Werte anzeigen</span>
        </label>
      </div>

      {error ? <div className="admin-message admin-error">{error}</div> : null}
      {success ? <div className="admin-message admin-success">{success}</div> : null}
      {!error && !entryStats.entries.length && !loading ? (
        <div className="admin-message">Keine Cache-Eintraege vorhanden.</div>
      ) : null}

      <div className="admin-cache-grid">
        {entryStats.entries.map((entry) => (
          <article key={`${entry.source}-${entry.key}`} className="admin-cache-card">
            <header className="admin-cache-card-header">
              <strong>{entry.key}</strong>
              <span>{entry.source || 'cache'}</span>
            </header>
            <dl className="admin-cache-meta">
              <div>
                <dt>TTL</dt>
                <dd>{formatTtl(entry.ttl_seconds)}</dd>
              </div>
              <div>
                <dt>Laenge</dt>
                <dd>{entry.value_length ?? 'n/a'}</dd>
              </div>
              <div>
                <dt>Beschnitten</dt>
                <dd>{entry.value_truncated ? 'ja' : 'nein'}</dd>
              </div>
            </dl>
            {includeValues && entry.value ? (
              <pre className="admin-cache-value">{entry.value}</pre>
            ) : null}
            <div className="admin-cache-card-actions">
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => deleteCache(entry.key)}
                disabled={loading}
              >
                Eintrag loeschen
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
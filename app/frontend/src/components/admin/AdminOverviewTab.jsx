import React, { useEffect, useMemo, useState } from 'react'
import { get, post } from '../../services/api'
import { formatTimestamp, formatTtl } from './cacheUtils'

/**
 * AdminOverviewTab - Admin panel tab showing system overview, cache status, and wiki build controls
 * @component
 * @returns {JSX.Element} Rendered overview dashboard with cache info and build actions
 */
export default function AdminOverviewTab(){
  const [cacheData, setCacheData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastLoadedAt, setLastLoadedAt] = useState(null)
  const [buildState, setBuildState] = useState('idle')
  const [buildMessage, setBuildMessage] = useState('')

  async function loadCache(){
    setLoading(true)
    setError('')
    try{
      const response = await get('/auth/cache/redis?limit=100&include_values=false&value_max_length=1200')
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
      setLastLoadedAt(Date.now())
    }catch(err){
      setError(err?.message || 'Cache konnte nicht geladen werden')
    }finally{
      setLoading(false)
    }
  }

  async function buildWiki(){
    setBuildState('building')
    setBuildMessage('')
    try{
      const response = await post('/wiki/build')
      if (!response.ok){
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `Build failed (${response.status})`)
      }
      setBuildState('ok')
      setBuildMessage('Build erfolgreich — /astro-wiki/ ist aktuell.')
    }catch(err){
      setBuildState('error')
      setBuildMessage(err?.message || 'Build fehlgeschlagen')
    }
  }

  useEffect(() => {
    loadCache()
  }, [])

  const entryStats = useMemo(() => {
    const entries = Array.isArray(cacheData?.entries) ? cacheData.entries : []
    const totalValueLength = entries.reduce((sum, entry) => sum + (entry.value_length || 0), 0)
    const sources = [...new Set(entries.map((entry) => entry.source).filter(Boolean))]
    return {
      totalValueLength,
      sources,
    }
  }, [cacheData])

  return (
    <section className="admin-panel" aria-label="Cache Übersicht">
      <div className="admin-hero">
        <div>
          <p className="admin-eyebrow">Systemstatus</p>
          <h2>Admin-Konsole</h2>
          <p>
            Überwache das aktive Cache-Backend und prüfe, ob Redis verwendet wird oder der lokale Fallback aktiv ist.
          </p>
        </div>
        <button type="button" className="admin-primary-button" onClick={loadCache} disabled={loading}>
          {loading ? 'Lade...' : 'Status aktualisieren'}
        </button>
      </div>

      {error ? <div className="admin-message admin-error">{error}</div> : null}

      <div className="admin-stats-grid">
        <article className="admin-stat-card">
          <span>Aktives Backend</span>
          <strong>{cacheData?.backend || 'unbekannt'}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Konfiguriert</span>
          <strong>{cacheData?.configured_backend || 'unbekannt'}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Einträge</span>
          <strong>{cacheData?.entry_count ?? 0}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Gesamtgröße</span>
          <strong>{entryStats.totalValueLength}</strong>
        </article>
      </div>

      <div className="admin-summary-grid">
        <article className="admin-summary-card">
          <h3>Verbindung</h3>
          <p>Redis URL gesetzt: {cacheData?.redis_url_configured ? 'ja' : 'nein'}</p>
          <p>Cache Prefix: {cacheData?.cache_prefix || '-'}</p>
          <p>Standard TTL: {formatTtl(cacheData?.default_ttl_seconds)}</p>
        </article>
        <article className="admin-summary-card">
          <h3>Quellen</h3>
          <p>{entryStats.sources.length ? entryStats.sources.join(', ') : 'Noch keine Einträge'}</p>
          <p>Letzte Aktualisierung: {formatTimestamp(lastLoadedAt)}</p>
        </article>
      </div>

      <div className="admin-summary-grid" style={{marginTop: 24}}>
        <article className="admin-summary-card">
          <h3>Wiki Build</h3>
          <p>Baut die statischen Astro-Seiten unter /astro-wiki/ — holt Daten vom API zur Build-Zeit.</p>
          <button
            type="button"
            className="admin-primary-button"
            style={{marginTop: 12}}
            onClick={buildWiki}
            disabled={buildState === 'building'}
          >
            {buildState === 'building' ? 'Baue...' : 'Build starten'}
          </button>
          {buildState === 'ok' && <p style={{color: '#0f766e', marginTop: 8}}>{buildMessage}</p>}
          {buildState === 'error' && <p style={{color: '#dc2626', marginTop: 8}}>{buildMessage}</p>}
        </article>
      </div>
    </section>
  )
}
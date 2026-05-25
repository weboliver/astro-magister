import React, { useState } from 'react'
import { post } from '../../services/api'

export default function AdminBuildWikiTab(){
  const [buildState, setBuildState] = useState('idle')
  const [buildMessage, setBuildMessage] = useState('')

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

  return (
    <section className="admin-panel" aria-label="Wiki Build">
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
          {buildState === 'ok' && <p style={{color: 'var(--admin-accent)', marginTop: 8}}>{buildMessage}</p>}
          {buildState === 'error' && <p style={{color: '#dc2626', marginTop: 8}}>{buildMessage}</p>}
        </article>
      </div>
    </section>
  )
}

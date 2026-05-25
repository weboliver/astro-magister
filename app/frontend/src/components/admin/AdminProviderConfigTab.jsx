import React, { useEffect, useState } from 'react'
import { get, put } from '../../services/api'

export default function AdminProviderConfigTab(){
  const [providers, setProviders] = useState([])
  const [selectedProvider, setSelectedProvider] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentProvider, setCurrentProvider] = useState('')

  async function loadConfig(){
    setLoading(true)
    setError('')
    setSuccess('')
    try{
      const response = await get('/auth/admin/provider-config')
      if (!response.ok){
        let detail = `Provider-Konfiguration konnte nicht geladen werden (${response.status})`
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
      setProviders(data.available_providers || [])
      setSelectedProvider(data.chat_provider || '')
      setCurrentProvider(data.chat_provider || '')
    }catch(err){
      setError(err?.message || 'Provider-Konfiguration konnte nicht geladen werden. Bitte versuchen Sie es später erneut.')
    }finally{
      setLoading(false)
    }
  }

  async function saveConfig(){
    setSaving(true)
    setError('')
    setSuccess('')
    try{
      const response = await put('/auth/admin/provider-config', { chat_provider: selectedProvider })
      if (!response.ok){
        let detail = 'Unbekannter Fehler'
        try{
          const data = await response.json()
          if (data?.detail) detail = data.detail
        }catch(_){ /* use default */ }
        throw new Error(detail)
      }
      const data = await response.json()
      setCurrentProvider(data.chat_provider)
      setSuccess('Provider-Einstellungen gespeichert.')
    }catch(err){
      setError(`Speichern fehlgeschlagen: ${err?.message || 'Unbekannter Fehler'}. Bitte versuchen Sie es erneut.`)
    }finally{
      setSaving(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  function handleSelectChange(e){
    setSelectedProvider(e.target.value)
    setSuccess('')
    setError('')
  }

  const isEmpty = !loading && providers.length === 0
  const isSaving = saving

  return (
    <section className="admin-panel" aria-label="Provider-Einstellungen">
      <div className="admin-hero">
        <div>
          <p className="admin-eyebrow">Einstellungen</p>
          <h2>Chat-Provider</h2>
          <p>
            Wählen Sie den KI-Provider für alle Chat-Interpretationen aus. Die Änderung wird sofort für alle neuen Anfragen wirksam.
          </p>
        </div>
        {!isEmpty && (
          <button
            type="button"
            className="admin-primary-button"
            onClick={saveConfig}
            disabled={isSaving || loading}
          >
            {isSaving ? 'Speichere...' : 'Speichern'}
          </button>
        )}
      </div>

      {loading ? (
        <p>Lade Provider-Konfiguration...</p>
      ) : error ? (
        <div className="admin-message admin-error">{error}</div>
      ) : isEmpty ? (
        <div className="admin-summary-grid">
          <article className="admin-summary-card">
            <h3>Keine Provider verfügbar</h3>
            <p>Der Server hat keine konfigurierten KI-Provider zurückgegeben. Bitte kontaktieren Sie den Administrator.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="admin-field" style={{maxWidth: '320px'}}>
            <label htmlFor="provider-select">Aktiver Provider</label>
            <select
              id="provider-select"
              value={selectedProvider}
              onChange={handleSelectChange}
              disabled={isSaving}
            >
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {success ? (
            <div className="admin-message admin-success">{success}</div>
          ) : null}
        </>
      )}
    </section>
  )
}

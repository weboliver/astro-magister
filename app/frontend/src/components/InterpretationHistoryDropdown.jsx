import React, { useState, useEffect, useCallback } from 'react'
import { useInterpretations } from '../hooks/useInterpretations'

/**
 * InterpretationHistoryDropdown - Dropdown for selecting a past interpretation session above the optional question textarea
 * @component
 * @param {Object} props - Component props
 * @param {string} props.contextType - Context type for filtering interpretations (e.g. "planets" | "houses")
 * @param {number|null} props.userPersonsId - Person filter (null = own profile)
 * @param {Function} props.onLoad - Callback called with the full interpretation object when "Auswertung anzeigen" is clicked
 * @param {Function} [props.onClear] - Optional callback when selection is cleared
 * @param {number} [props.refreshToken] - Increment to trigger a list refresh (e.g. after a new session was saved)
 * @param {boolean} [props.yearOnly=false] - If true, only display year in date format
 * @param {number} [props.selectedInterpretationId] - Pre-selected interpretation ID
 * @returns {JSX.Element|null} Rendered dropdown, or null if no interpretations exist
 */
export default function InterpretationHistoryDropdown({
  contextType,
  userPersonsId,
  onLoad,
  onClear,
  refreshToken,
  yearOnly = false,
  selectedInterpretationId,
}) {
  const { interpretations, loadingList, listInterpretations, loadInterpretation } = useInterpretations()
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    listInterpretations(contextType, userPersonsId)
  }, [contextType, userPersonsId, listInterpretations])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Refresh when a new session was saved or deleted (refreshToken changes)
  useEffect(() => {
    if (refreshToken !== undefined) refresh()
  }, [refreshToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select when selectedInterpretationId is set and the item is in the list; reset when null
  useEffect(() => {
    if (!selectedInterpretationId) {
      setSelectedId('')
      return
    }
    const exists = interpretations.some((item) => item.id === selectedInterpretationId)
    if (exists) setSelectedId(String(selectedInterpretationId))
  }, [selectedInterpretationId, interpretations])

  const formatDate = (item) => {
    if (yearOnly) {
      return item.interp_year ? String(item.interp_year) : ''
    }
    if (item.interp_year && item.interp_month && item.interp_day) {
      const d = new Date(item.interp_year, item.interp_month - 1, item.interp_day)
      return d.toLocaleDateString('de-DE')
    }
    try { return new Date(item.created).toLocaleDateString('de-DE') } catch (_) { return '' }
  }

  const formatLabel = (item) => {
    const date = formatDate(item)
    let question = 'keine optionale Zusatzfrage'
    if (item.first_question && item.first_question.trim()) {
      const q = item.first_question.trim()
      question = q.length > 40 ? q.slice(0, 40) + '…' : q
    }
    return `${date} · ${question}`
  }

  const handleLoad = async () => {
    if (!selectedId) return
    setLoading(true)
    try {
      const interp = await loadInterpretation(Number(selectedId))
      if (interp && onLoad) onLoad(interp)
    } finally {
      setLoading(false)
    }
  }

  if (!loadingList && interpretations.length === 0) return null

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', marginBottom: 4 }}><b>Historie:</b></label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select
        value={selectedId}
        onChange={(e) => {
          const val = e.target.value
          setSelectedId(val)
          if (!val && onClear) onClear()
        }}
        style={{
          flex: 1,
          fontSize: 12,
          padding: '4px 6px',
          borderRadius: 4,
          border: '1px solid #ccc',
          color: selectedId ? '#1a2a3a' : '#888',
          minWidth: 0,
        }}
        disabled={loadingList}
      >
        <option value="">
          {loadingList ? 'Lade…' : '— Frühere Auswertung wählen —'}
        </option>
        {interpretations.map((item) => (
          <option key={item.id} value={item.id}>
            {formatLabel(item)}
          </option>
        ))}
      </select>
      <button
        onClick={handleLoad}
        disabled={!selectedId || loading}
        style={{
          fontSize: 12,
          padding: '4px 10px',
          cursor: selectedId && !loading ? 'pointer' : 'default',
          borderRadius: 4,
          border: '1px solid #b0c4de',
          background: selectedId ? '#e8f0fe' : '#f0f0f0',
          color: selectedId ? '#1a2a3a' : '#999',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {loading ? 'Lade…' : 'Auswertung anzeigen'}
      </button>
      </div>
    </div>
  )
}

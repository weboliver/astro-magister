import React from 'react'
import { LoadingSpinner } from './LoadingSpinner'

export default function SynastrieControls({
  comparisonMode,
  onComparisonModeChange,
  isStreaming,
  personASelected,
  personBSelected,
  samePerson,
  onInterpret,
  isInterpreting,
  followupQuestion,
  onFollowupChange,
  onFollowupSubmit,
  isSubmittingFollowup,
  contextType,
}) {
  const hasBothPersons = personASelected && personBSelected
  const buttonDisabled = isInterpreting || samePerson || !hasBothPersons

  return (
    <div>
      {/* Comparison mode dropdown */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 20 }}>Vergleichsmodus</label>
        <select
          value={comparisonMode}
          onChange={e => onComparisonModeChange(e.target.value)}
          disabled={isStreaming}
          style={{
            width: '100%',
            maxWidth: 300,
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #cbd5f5',
            fontSize: 14,
            background: '#fff',
            color: '#0b1b2a',
          }}
        >
          <option value="hh">Häuservergleich</option>
          <option value="rr">Radixvergleich</option>
        </select>
        {isStreaming && (
          <span style={{ color: '#888', fontSize: 12 ,  display: 'block', marginTop: 4 }}>
            Moduswechsel während der Analyse nicht möglich
          </span>
        )}
      </div>

      {/* Same-person warning */}
      {samePerson && (
        <div
          style={{
            marginTop: 8,
            marginBottom: 12,
            padding: '8px 12px',
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: 6,
            color: '#664d00',
            fontSize: 13,
          }}
        >
          Bitte wähle zwei verschiedene Personen für einen Partnervergleich aus.
        </div>
      )}
    </div>
  )
}
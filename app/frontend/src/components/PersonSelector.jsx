import React, { useMemo, useEffect, useState } from 'react'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useSynastrySelection } from '../contexts/SynastrySelectionContext'
import { useAuth } from '../contexts/AuthContext'
import { getSignIndex } from '../theme/ThemeApplier'
import { zodiacNames } from '../theme/zodiacColors'

function PersonSignGlyph({ persons, selectedPersonId }){
  const { profile } = useAuth()
  const [ascendantName, setAscendantName] = useState(null)

  const info = useMemo(() => {
    let name, signIdx, birth
    if (selectedPersonId != null) {
      const p = persons.find(p => p.id === selectedPersonId)
      if (p && p.birth_year) {
        name = p.name
        signIdx = getSignIndex(new Date(p.birth_year, (p.birth_month || 1) - 1, p.birth_day || 1))
        birth = { y: p.birth_year, m: p.birth_month, d: p.birth_day, h: p.birth_hour, min: p.birth_minute, sec: p.birth_second, tz: p.birth_timezone, lat: p.birth_latitude, lng: p.birth_longitude }
      }
    } else if (profile?.birth_year) {
      name = profile.name || localStorage.getItem('username') || 'Profil'
      signIdx = getSignIndex(new Date(profile.birth_year, (profile.birth_month || 1) - 1, profile.birth_day || 1))
      birth = { y: profile.birth_year, m: profile.birth_month, d: profile.birth_day, h: profile.birth_hour, min: profile.birth_minute, sec: profile.birth_second, tz: profile.birth_timezone, lat: profile.birth_latitude, lng: profile.birth_longitude }
    }
    if (!name) return null
    return { name, signIdx, signName: zodiacNames[signIdx], birth }
  }, [persons, selectedPersonId, profile])

  useEffect(() => {
    setAscendantName(null)
    if (!info?.birth) return
    const b = info.birth
    if (b.y == null || b.m == null || b.d == null) return
    const params = new URLSearchParams({
      birth_year: b.y,
      birth_month: b.m || 1,
      birth_day: b.d || 1,
      birth_hour: b.h ?? 12,
      birth_minute: b.min ?? 0,
      birth_second: b.sec ?? 0,
      birth_timezone: b.tz || 'UTC',
      birth_latitude: b.lat ?? 0,
      birth_longitude: b.lng ?? 0,
    })
    fetch(`/api/ascendant?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.ascendant_sign_index != null) setAscendantName(zodiacNames[data.ascendant_sign_index]) })
      .catch(() => {})
  }, [info?.birth])

  if (!info) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <img
        src={`/theme/glyph/sign/${info.signIdx}`}
        alt="Sternzeichen"
        width={28}
        height={28}
        style={{ flexShrink: 0, marginBottom: 5 }}
      />
      <span style={{ fontSize: 13, color: '#4b5d71' }}>
        <b>{info.name}</b> Sternzeichen: {info.signName}{ascendantName ? `, Aszendent: ${ascendantName}` : ''}
      </span>
    </div>
  )
}

/**
 * PersonSelectUI - Shared render component for the person selector dropdown.
 * Pure presentational component with no hooks — receives all data via props.
 *
 * @param {Object} props
 * @param {string} props.label - Label text for the select field
 * @param {string} props.helperText - Optional helper text below the select
 * @param {Array} props.persons - List of person objects with {id, name}
 * @param {number|null} props.selectedPersonId - Currently selected person ID
 * @param {function} props.selectPersonId - Callback to update the selection
 * @param {boolean} props.loading - Whether persons are currently loading
 */
function PersonSelectUI({ label, helperText, persons, selectedPersonId, selectPersonId, loading, labelColor, excludeUserPersonId, hideOwnProfile }){
  const handleChange = (event) => {
    const value = event.target.value
    if (!value){
      selectPersonId(null)
      return
    }
    const id = Number(value)
    selectPersonId(Number.isNaN(id) ? null : id)
  }

  const filteredPersons = excludeUserPersonId
    ? persons.filter(p => p.id !== excludeUserPersonId)
    : persons

  return (
    <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '100%' }}>
      <label style={{ fontSize: 14, fontWeight: 600, color: labelColor || undefined }}>{label}</label>
      <select
        data-testid="person-selector"
        value={selectedPersonId ?? ''}
        onChange={handleChange}
        disabled={loading}
        style={{ flex: '1 1 220px', width: '48%', maxWidth:530, minWidth: 300, maxHeight: 40, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5f5', background: '#fff', fontSize: 14, color: '#0b1b2a', boxSizing: 'border-box' }}
      >
        {!hideOwnProfile && <option value="">Eigenes Profil verwenden</option>}
        {filteredPersons.map(person => (
          <option key={person.id} value={person.id}>{person.name}</option>
        ))}
      </select>
      {!loading && persons.length === 0 && (
        <span style={{ color: '#556', fontSize: 12 }}>Noch keine Personen gespeichert.</span>
      )}
      {!loading && (
        <PersonSignGlyph persons={persons} selectedPersonId={selectedPersonId} />
      )}
    </div>
  )
}

/**
 * GlobalPersonSelector - Wrapper that reads from global PersonSelectionContext.
 * Used when no index prop is provided (backward-compatible path).
 */
function GlobalPersonSelector({ label, helperText, labelColor, excludeUserPersonId, hideOwnProfile }){
  const { persons, selectedPersonId, selectPersonId, loading } = usePersonSelection()
  return (
    <PersonSelectUI
      label={label}
      helperText={helperText}
      persons={persons}
      selectedPersonId={selectedPersonId}
      selectPersonId={selectPersonId}
      loading={loading}
      labelColor={labelColor}
      excludeUserPersonId={excludeUserPersonId}
      hideOwnProfile={hideOwnProfile}
    />
  )
}

/**
 * SynastryPersonSelector - Wrapper that reads from SynastrySelectionContext for a specific slot.
 * Used when index prop is 'A' or 'B'.
 */
function SynastryPersonSelector({ label, helperText, index, labelColor, excludeUserPersonId, hideOwnProfile }){
  const { persons, selectedPersonId, selectPersonId, loading } = useSynastrySelection(index)
  return (
    <PersonSelectUI
      label={label}
      helperText={helperText}
      persons={persons}
      selectedPersonId={selectedPersonId}
      selectPersonId={selectPersonId}
      loading={loading}
      labelColor={labelColor}
      excludeUserPersonId={excludeUserPersonId}
      hideOwnProfile={hideOwnProfile}
    />
  )
}

/**
 * PersonSelector - Dropdown component for selecting a person from saved profiles.
 *
 * Dual-mode operation:
 *   - WITHOUT index prop: Uses global PersonSelectionContext (backward compatible, existing pages unchanged)
 *   - WITH index="A" or index="B": Uses SynastrySelectionContext for isolated dual-person selection
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} [props.label='Person wählen'] - Label text for the select field
 * @param {string} [props.helperText=''] - Optional helper text to display below the select
 * @param {'A'|'B'} [props.index] - When provided, uses SynastrySelectionContext for the specified slot
 * @returns {JSX.Element} Rendered person selector dropdown
 */
export default function PersonSelector({ label = 'Person wählen', helperText = '', index, labelColor, excludeUserPersonId, hideOwnProfile }){
  // Delegate to the appropriate sub-component based on index prop.
  // No hooks called in this function — avoids conditional hook issues.
  if (index === 'A' || index === 'B'){
    return <SynastryPersonSelector label={label} helperText={helperText} index={index} labelColor={labelColor} excludeUserPersonId={excludeUserPersonId} hideOwnProfile={hideOwnProfile} />
  }
  return <GlobalPersonSelector label={label} helperText={helperText} labelColor={labelColor} excludeUserPersonId={excludeUserPersonId} hideOwnProfile={hideOwnProfile} />
}

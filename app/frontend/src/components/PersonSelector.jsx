import React from 'react'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useSynastrySelection } from '../contexts/SynastrySelectionContext'

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
      {helperText && (
        <span style={{ color: '#556', fontSize: 12 }}>{helperText}</span>
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

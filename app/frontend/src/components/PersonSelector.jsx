import React from 'react'
import { usePersonSelection } from '../contexts/PersonSelectionContext'

export default function PersonSelector({ label = 'Person wählen', helperText = '' }){
  const { persons, selectedPersonId, selectPersonId, loading } = usePersonSelection()

  const handleChange = (event) => {
    const value = event.target.value
    if (!value){
      selectPersonId(null)
      return
    }
    const id = Number(value)
    selectPersonId(Number.isNaN(id) ? null : id)
  }

  return (
    <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '100%' }}>
      <label style={{ fontSize: 14, fontWeight: 600 }}>{label}</label>
      <select
        value={selectedPersonId ?? ''}
        onChange={handleChange}
        disabled={loading}
        style={{ flex: '1 1 220px', width: '48%', maxWidth:530, minWidth: 300, maxHeight: 40, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5f5', background: '#fff', fontSize: 14, color: '#0b1b2a', boxSizing: 'border-box' }}
      >
        <option value="">Eigenes Profil verwenden</option>
        {persons.map(person => (
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

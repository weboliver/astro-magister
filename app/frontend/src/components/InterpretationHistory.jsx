import React, { useEffect } from 'react'
import { useInterpretations } from '../hooks/useInterpretations'

/**
 * InterpretationHistory - Collapsible list of past AI interpretation sessions with select and delete functionality
 * @component
 * @param {Object} props - Component props
 * @param {string} props.contextType - Context type for filtering (e.g. "planets" | "houses")
 * @param {number|null} props.userPersonsId - Person filter (null = own profile)
 * @param {number} [props.activeId] - Currently active interpretation ID to highlight
 * @param {Function} [props.onSelect] - Callback called when user clicks "Fortsetzen"
 * @param {Function} [props.onDelete] - Callback called after successful deletion
 * @param {boolean} props.open - Controlled open state
 * @param {Function} props.onToggle - Callback called when user clicks the toggle button
 * @returns {JSX.Element} Rendered collapsible history list
 */
export default function InterpretationHistory({
  contextType,
  userPersonsId,
  activeId,
  onSelect,
  onDelete,
  open,
  onToggle,
}) {
  const { interpretations, loadingList, listInterpretations, deleteInterpretation } = useInterpretations()

  useEffect(() => {
    if (open) {
      listInterpretations(contextType, userPersonsId)
    }
  }, [open, contextType, userPersonsId, listInterpretations])

  // Refresh list when a new session is saved (activeId changes to a non-null value)
  useEffect(() => {
    if (activeId && open) {
      listInterpretations(contextType, userPersonsId)
    }
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id) => {
    const ok = await deleteInterpretation(id)
    if (ok && onDelete) onDelete(id)
  }

  const formatDate = (isoString) => {
    try { return new Date(isoString).toLocaleDateString('de-DE') } catch (_) { return '' }
  }

  const formatInterpDate = (item) => {
    if (!item.interp_year) return ''
    const m = String(item.interp_month || 1).padStart(2, '0')
    const d = String(item.interp_day || 1).padStart(2, '0')
    return `${item.interp_year}-${m}-${d}`
  }

  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button
          onClick={onToggle}
          style={{
            fontSize: 12,
            color: '#446',
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: 4,
            padding: '3px 10px',
            cursor: 'pointer',
          }}
        >
          Frühere Interpretationen anzeigen
        </button>
      ) : (
        <div
          style={{
            border: '1px solid #dde1e7',
            borderRadius: 6,
            padding: '10px 12px',
            background: '#fafafa',
            marginTop: 4,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 13 }}>Frühere Interpretationen</strong>
            <button
              onClick={onToggle}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#666' }}
              title="Schliessen"
            >
              ×
            </button>
          </div>

          {loadingList && (
            <div style={{ fontSize: 12, color: '#888', padding: '4px 0' }}>Lade…</div>
          )}
          {!loadingList && interpretations.length === 0 && (
            <div style={{ fontSize: 12, color: '#888', padding: '4px 0' }}>
              Keine gespeicherten Interpretationen vorhanden.
            </div>
          )}

          {interpretations.map((item) => {
            const isActive = item.id === activeId
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '6px 0',
                  borderBottom: '1px solid #eee',
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#334',
                      fontWeight: isActive ? 'bold' : 'normal',
                    }}
                  >
                    {formatInterpDate(item)}
                    {item.location_city ? ` · ${item.location_city}` : ''}
                    <span style={{ marginLeft: 8, color: '#999', fontWeight: 'normal', fontSize: 11 }}>
                      {formatDate(item.created)}
                    </span>
                  </div>
                  {item.first_question && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#666',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 340,
                      }}
                      title={item.first_question}
                    >
                      {item.first_question}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => onSelect && onSelect(item.id)}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      cursor: 'pointer',
                      background: isActive ? '#c5e8c5' : '#e8f0fe',
                      border: `1px solid ${isActive ? '#7cbf7c' : '#b0c4de'}`,
                      borderRadius: 3,
                      fontWeight: isActive ? 'bold' : 'normal',
                    }}
                  >
                    {isActive ? 'Aktiv' : 'Fortsetzen'}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      cursor: 'pointer',
                      background: '#fff0f0',
                      border: '1px solid #f5c0c0',
                      borderRadius: 3,
                      color: '#c00',
                    }}
                    title="Löschen"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

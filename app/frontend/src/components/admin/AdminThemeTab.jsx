import React, { useCallback, useEffect, useRef, useState } from 'react'
import { get, post, put } from '../../services/api'
import { applyTheme, getSignIndex } from '../../theme/ThemeApplier.js'
import { ZODIAC_DEFAULTS, zodiacNames } from '../../theme/zodiacColors.js'

// ── Element groups for sign layout (D-10: Fire, Earth, Air, Water) ──
const ELEMENT_GROUPS = [
  { name: 'Feuer', signs: [0, 4, 8] },
  { name: 'Erde', signs: [1, 5, 9] },
  { name: 'Luft', signs: [2, 6, 10] },
  { name: 'Wasser', signs: [3, 7, 11] },
]

export default function AdminThemeTab() {
  // ── State ──
  const [theme, setTheme] = useState(null)
  const [savedTheme, setSavedTheme] = useState(null)
  const [archive, setArchive] = useState(null)
  const [enabled, setEnabled] = useState(true)
  const [overrideSign, setOverrideSign] = useState(null)
  const [previewActive, setPreviewActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const savedThemeRef = useRef(savedTheme)
  useEffect(() => {
    savedThemeRef.current = savedTheme
  }, [savedTheme])

  // ── Derived ──
  const isDirty = theme !== null && savedTheme !== null
    ? JSON.stringify(theme) !== JSON.stringify(savedTheme)
    : false
  const hasArchive = archive !== null
  const canSave = !loading && !saving && !restoring

  // ── Helper: apply a sign's local theme to the page (live preview) ──
  const applyPreviewToPage = useCallback(
    (signIndex) => {
      if (!theme || !theme[signIndex]) return
      const palette = theme[signIndex]
      applyTheme(signIndex, palette)
    },
    [theme],
  )

  // ── Helper: revert the page to the saved/default theme ──
  const revertPageToSaved = useCallback(() => {
    const st = savedThemeRef.current
    if (!st) return
    const signIdx =
      overrideSign !== null ? overrideSign : getSignIndex()
    const palette = st[signIdx]
    if (!palette) return
    applyTheme(signIdx, palette)
  }, [overrideSign])

  // ── API: load config from backend ──
  async function loadConfig() {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const response = await get('/auth/admin/theme-settings')
      if (!response.ok) {
        let detail = 'Unbekannter Fehler'
        try {
          const data = await response.json()
          if (data?.detail) detail = data.detail
        } catch (_) {
          /* use default */
        }
        throw new Error(detail)
      }
      const data = await response.json()
      setTheme(data.theme)
      setSavedTheme(JSON.parse(JSON.stringify(data.theme)))
      setArchive(data.archive)
      setEnabled(data.enabled)
      // Initialize localStorage on page load (Phase 32)
      localStorage.setItem('zodiacThemeEnabled', data.enabled)
    } catch (err) {
      setError(
        `Theme-Einstellungen konnten nicht geladen werden. ${err?.message || ''}`,
      )
    } finally {
      setLoading(false)
    }
  }

  // ── API: save all 12 signs to backend ──
  async function saveConfig() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await put('/auth/admin/theme-settings', {
        theme,
        enabled,
      })
      if (!response.ok) {
        let detail = 'Unbekannter Fehler'
        try {
          const data = await response.json()
          if (data?.detail) detail = data.detail
        } catch (_) {
          /* use default */
        }
        throw new Error(detail)
      }
      const data = await response.json()
      setSavedTheme(JSON.parse(JSON.stringify(data.theme)))
      setArchive(data.archive)
      setSuccess('Theme-Einstellungen gespeichert.')
      localStorage.setItem('zodiacThemeEnabled', enabled)
      localStorage.setItem('zodiacTheme', JSON.stringify(data.theme))
    } catch (err) {
      setError(
        `Speichern fehlgeschlagen: ${err?.message || 'Unbekannter Fehler'}.`,
      )
    } finally {
      setSaving(false)
    }
  }

  // ── API: restore previous version from archive ──
  async function restoreArchive() {
    if (
      !window.confirm(
        'Gespeicherte Version durch die vorherige ersetzen?',
      )
    )
      return
    setRestoring(true)
    setError('')
    setSuccess('')
    try {
      const response = await post('/auth/admin/theme-settings/restore')
      if (!response.ok) {
        let detail = 'Unbekannter Fehler'
        try {
          const data = await response.json()
          if (data?.detail) detail = data.detail
        } catch (_) {
          /* use default */
        }
        throw new Error(detail)
      }
      const data = await response.json()
      setTheme(data.theme)
      setSavedTheme(JSON.parse(JSON.stringify(data.theme)))
      setArchive(data.archive)
      setSuccess('Theme wiederhergestellt.')
    } catch (err) {
      setError(
        `Wiederherstellung fehlgeschlagen: ${err?.message || 'Unbekannter Fehler'}.`,
      )
    } finally {
      setRestoring(false)
    }
  }

  // ── Event: color picker change (local state only, no API call) ──
  function handleColorChange(signIndex, field, value) {
    setTheme((prev) => {
      const newTheme = { ...prev }
      newTheme[signIndex] = { ...newTheme[signIndex], [field]: value }
      return newTheme
    })
    setSuccess('')
  }

  // ── Event: preview button ──
  function handlePreviewClick() {
    const signIdx =
      overrideSign !== null ? overrideSign : getSignIndex()
    applyPreviewToPage(signIdx)
    setPreviewActive(true)
  }

  // ── Event: revert preview ──
  function handleRevertClick() {
    revertPageToSaved()
    setPreviewActive(false)
  }

  // ── Event: reset to zodiac defaults ──
  function handleResetDefaults() {
    if (
      !window.confirm(
        'Alle Farben auf die Standardwerte zurücksetzen? Ungespeicherte Änderungen gehen verloren.',
      )
    )
      return
    const defaults = {}
    for (let i = 0; i < 12; i++) {
      defaults[i] = {
        accent: ZODIAC_DEFAULTS[i].accent,
        panel: ZODIAC_DEFAULTS[i].panel,
        accentSoft: ZODIAC_DEFAULTS[i].accentSoft,
        shadow: ZODIAC_DEFAULTS[i].shadow,
      }
    }
    setTheme(defaults)
    setSuccess('')
    setError('')
  }

  // ── Event: sign override dropdown ──
  function handleOverrideChange(e) {
    const val = e.target.value
    const parsed = val === '' ? null : parseInt(val, 10)
    setOverrideSign(parsed)
    if (previewActive) {
      const signIdx = parsed !== null ? parsed : getSignIndex()
      applyPreviewToPage(signIdx)
    }
  }

  // ── Event: theme toggle checkbox ──
  function handleToggleChange(e) {
    setEnabled(e.target.checked)
  }

  // ── Effects ──
  useEffect(() => {
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup on unmount: revert any active preview (D-16)
  useEffect(() => {
    return () => {
      const st = savedThemeRef.current
      if (!st) return
      const signIdx =
        overrideSign !== null ? overrideSign : getSignIndex()
      const palette = st[signIdx]
      if (palette) {
        applyTheme(signIdx, palette)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render ──
  return (
    <section className="admin-panel" aria-label="Theme-Einstellungen">
      {/* ── Hero Bar ── */}
      <div className="admin-hero">
        <div>
          <p className="admin-eyebrow">Einstellungen</p>
          <h2>Theme-Einstellungen</h2>
          <p>
            Passen Sie die Farben für jedes Sternzeichen an. Änderungen
            werden mit &quot;Speichern&quot; übernommen. Die Vorschau zeigt
            die Farben direkt auf der Seite.
          </p>
        </div>
        <button
          type="button"
          className="admin-primary-button"
          onClick={saveConfig}
          disabled={!canSave}
        >
          {saving ? 'Speichere...' : 'Speichern'}
        </button>
      </div>

      {/* ── Controls Row ── */}
      <div
        className="admin-action-group"
        style={{ marginBottom: '14px' }}
      >
        <label className="admin-checkbox" style={{ marginLeft: 0 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggleChange}
            disabled={!canSave}
          />
          Dynamisches Theme aktivieren
        </label>
      </div>

      <div
        className="admin-field"
        style={{ maxWidth: '280px', marginBottom: '16px' }}
      >
        <label htmlFor="sign-override">Anzeige-Sternzeichen</label>
        <select
          id="sign-override"
          value={overrideSign !== null ? overrideSign : ''}
          onChange={handleOverrideChange}
          disabled={!canSave}
        >
          <option value="">Automatisch</option>
          {zodiacNames.map((name, i) => (
            <option key={i} value={i}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div
        className="admin-action-group"
        style={{ marginBottom: '18px' }}
      >
        <button
          type="button"
          className="admin-secondary-button"
          onClick={handlePreviewClick}
          disabled={!canSave}
        >
          {previewActive ? 'Vorschau aktiv' : 'Vorschau'}
        </button>
        <button
          type="button"
          className="admin-secondary-button"
          onClick={handleRevertClick}
          disabled={!canSave || !previewActive}
        >
          Zurücksetzen
        </button>
        <button
          type="button"
          className="admin-secondary-button"
          onClick={handleResetDefaults}
          disabled={!canSave}
        >
          Auf Standard zurücksetzen
        </button>
        {hasArchive && (
          <button
            type="button"
            className="admin-secondary-button"
            onClick={restoreArchive}
            disabled={!canSave || restoring}
          >
            {restoring
              ? 'Stelle wieder her...'
              : 'Letzte Version wiederherstellen'}
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      {error && <div className="admin-message admin-error">{error}</div>}
      {success && (
        <div className="admin-message admin-success">{success}</div>
      )}

      {/* ── Loading ── */}
      {loading ? (
        <p>Lade Theme-Einstellungen...</p>
      ) : (
        <>
          {/* ── Per-Element Sign Cards ── */}
          {ELEMENT_GROUPS.map((group) => (
            <div key={group.name} className="theme-group">
              <h3 className="theme-group-heading">{group.name}</h3>
              <div className="theme-grid">
                {group.signs.map((signIndex) => {
                  const sign = theme[signIndex]
                  if (!sign) return null
                  return (
                    <div
                      key={signIndex}
                      className="settings-card theme-card"
                    >
                      <p className="theme-card-name">
                        {zodiacNames[signIndex]}
                      </p>
                      <div className="theme-pickers">
                        <div className="theme-picker">
                          <label
                            className="theme-picker-label"
                            htmlFor={`accent-${signIndex}`}
                          >
                            Akzent
                          </label>
                          <input
                            id={`accent-${signIndex}`}
                            type="color"
                            className="theme-picker-input"
                            value={sign.accent}
                            onChange={(e) =>
                              handleColorChange(
                                signIndex,
                                'accent',
                                e.target.value,
                              )
                            }
                            disabled={!canSave}
                          />
                        </div>
                        <div className="theme-picker">
                          <label
                            className="theme-picker-label"
                            htmlFor={`panel-${signIndex}`}
                          >
                            Hintergrund
                          </label>
                          <input
                            id={`panel-${signIndex}`}
                            type="color"
                            className="theme-picker-input"
                            value={sign.panel}
                            onChange={(e) =>
                              handleColorChange(
                                signIndex,
                                'panel',
                                e.target.value,
                              )
                            }
                            disabled={!canSave}
                          />
                        </div>
                      </div>
                      <div
                        className="theme-swatch"
                        style={{ backgroundColor: sign.panel }}
                      >
                        <div
                          className="theme-swatch-accent"
                          style={{ backgroundColor: sign.accent }}
                        />
                        <div className="theme-swatch-panel">
                          Vorschau
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* ── Bottom Save Button (D-11: top + bottom) ── */}
          <div style={{ marginTop: '32px', textAlign: 'right' }}>
            <button
              type="button"
              className="admin-primary-button"
              onClick={saveConfig}
              disabled={!canSave}
            >
              {saving ? 'Speichere...' : 'Speichern'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

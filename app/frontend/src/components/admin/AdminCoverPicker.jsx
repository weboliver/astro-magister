import React, { useEffect, useRef, useState } from 'react'
import { apiUrl, get } from '../../services/api'

/**
 * The 23 tile images use one fixed neutral pair, delivered by the server as
 * `tile_background`/`tile_glyph_color` in `GET /wiki/cover-options` — no preset key is
 * hard-coded here. Tiles load once per dialog with the same colours, so clicking a swatch
 * does not re-fetch 23 images. Only the large preview carries the live selection.
 */
const TILE_ERROR_TEXT = 'Die Symbol-Kacheln können nicht angezeigt werden: Die Bildoptionen enthalten kein Kachel-Farbpaar. Die Auswahl funktioniert weiter über die Vorschau.'

const PREVIEW_ERROR_TEXT = 'Vorschau konnte nicht erstellt werden. Wähle die Option erneut oder schließe den Dialog und versuche es noch einmal.'
const OPTIONS_TITLE_ID = 'admin-cover-picker-title'

/** Everything inside the dialog that Tab can reach (disabled controls are skipped). */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Finds a preset by key in a server list (`backgrounds`, `glyph_colors`). */
function presetByKey(presets, key){
  if (!key || !Array.isArray(presets)) return null
  return presets.find((preset) => preset.key === key) || null
}

/** German display name of a preset key, `''` while unknown. */
function presetName(presets, key){
  const preset = presetByKey(presets, key)
  return preset ? preset.name : ''
}

/**
 * AdminCoverPicker — the CMS dialog that picks a wiki cover image.
 *
 * The dialog renders no glyph and no colour itself: every tile and the live preview
 * come from `GET /wiki/cover-preview`, and the glyph names, background presets and
 * allowed symbol colours come from `GET /wiki/cover-options`. The selection is held
 * as **keys** (glyph key, background preset key, symbol-colour preset key); hex
 * values exist only inside the two preview URLs built here. Persisting happens in
 * the editor form through its existing save button — this dialog only calls
 * `onApply({ glyph, bg, fg })`.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.open - Whether the dialog is visible
 * @param {{glyph: (string|null), bg: (string|null), fg: (string|null)}} props.value - Current selection as preset keys
 * @param {(string|null)} [props.suggestion] - Glyph key the server suggests for this title
 * @param {function({glyph: string, bg: (?string), fg: (?string)}): void} props.onApply - Writes the selection into the form state
 * @param {function(): void} props.onCancel - Discards the dialog changes
 * @returns {JSX.Element|null} The dialog overlay, or `null` while closed
 */
export default function AdminCoverPicker({ open, value, suggestion, onApply, onCancel }){
  const [options, setOptions] = useState(null)
  const [optionsError, setOptionsError] = useState('')
  const [selection, setSelection] = useState({ glyph: null, bg: null, fg: null })
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  // Nur die letzte Vorschau-Anfrage darf das Bild setzen — ältere Antworten
  // werden über diese laufende Nummer verworfen.
  const requestIdRef = useRef(0)
  const bodyRef = useRef(null)
  const dialogRef = useRef(null)

  const valueGlyph = value?.glyph || null
  const valueBg = value?.bg || null
  const valueFg = value?.fg || null

  // Options come from the server once per open (44 names/hex values, a deploy changes them).
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setOptionsError('')
    async function loadOptions(){
      try{
        const resp = await get('/wiki/cover-options')
        if (cancelled) return
        if (!resp.ok){
          setOptionsError(`Bildoptionen konnten nicht geladen werden (${resp.status}). Schließe den Dialog und versuche es erneut.`)
          return
        }
        const data = await resp.json()
        if (cancelled) return
        setOptions(data && typeof data === 'object' ? data : null)
      }catch(_){
        if (cancelled) return
        setOptionsError('Bildoptionen konnten nicht geladen werden (Netzwerkfehler). Schließe den Dialog und versuche es erneut.')
      }
    }
    loadOptions()
    return () => { cancelled = true }
  }, [open])

  // Der Dialog arbeitet auf einer lokalen Kopie der Auswahl; erst „Bild übernehmen" schreibt sie zurück.
  useEffect(() => {
    if (!open) return
    setSelection({ glyph: valueGlyph, bg: valueBg, fg: valueFg })
  }, [open, valueGlyph, valueBg, valueFg])

  const glyphColorPresets = Array.isArray(options?.glyph_colors) ? options.glyph_colors : []

  /** Glyph colours the palette allows on the given background (server truth, never a local table). */
  function allowedGlyphColorKeys(bgKey){
    if (!bgKey) return glyphColorPresets.map((preset) => preset.key)
    return glyphColorPresets
      .filter((preset) => Array.isArray(preset.allowed_for) && preset.allowed_for.includes(bgKey))
      .map((preset) => preset.key)
  }

  // Sobald die Optionen da sind: fehlende Auswahl auf die Server-Defaults setzen und eine
  // Symbolfarbe heilen, die für den aktuellen Hintergrund nicht erlaubt ist — ohne Fehlermeldung.
  useEffect(() => {
    if (!open || !options) return
    const backgrounds = Array.isArray(options.backgrounds) ? options.backgrounds : []
    setSelection((current) => {
      const bgKey = presetByKey(backgrounds, current.bg)
        ? current.bg
        : (options.default_background || backgrounds[0]?.key || null)
      const allowed = allowedGlyphColorKeys(bgKey)
      const fgKey = allowed.includes(current.fg)
        ? current.fg
        : (allowed.includes(options.default_glyph_color) ? options.default_glyph_color : (allowed[0] || null))
      if (bgKey === current.bg && fgKey === current.fg) return current
      return { ...current, bg: bgKey, fg: fgKey }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options])

  const tileBackgroundHex = presetByKey(options?.backgrounds, options?.tile_background)?.hex || ''
  const tileGlyphHex = presetByKey(options?.glyph_colors, options?.tile_glyph_color)?.hex || ''
  const tilesUnavailable = !!options && (!tileBackgroundHex || !tileGlyphHex)

  // Hinweis für helle Hintergründe aus den Serverdaten statt aus einem festen Preset-Namen.
  const selectedBackground = presetByKey(options?.backgrounds, selection.bg)
  const lightBackgroundGlyphNames = selectedBackground?.family === 'light'
    ? glyphColorPresets
      .filter((preset) => Array.isArray(preset.allowed_for) && preset.allowed_for.includes(selection.bg))
      .map((preset) => preset.name)
    : []

  /** Tile image: the server's fixed neutral pair, so the 23 images load once per dialog. */
  function tileUrl(glyphKey){
    if (!glyphKey || !tileBackgroundHex || !tileGlyphHex) return ''
    return apiUrl(
      '/wiki/cover-preview?variant=tile&glyph=' + encodeURIComponent(glyphKey)
      + '&bg=' + encodeURIComponent(tileBackgroundHex)
      + '&fg=' + encodeURIComponent(tileGlyphHex),
    )
  }

  const previewBgHex = presetByKey(options?.backgrounds, selection.bg)?.hex || ''
  const previewFgHex = presetByKey(options?.glyph_colors, selection.fg)?.hex || ''
  const previewUrl = selection.glyph && previewBgHex && previewFgHex
    ? apiUrl(
      '/wiki/cover-preview?variant=full&glyph=' + encodeURIComponent(selection.glyph)
      + '&bg=' + encodeURIComponent(previewBgHex)
      + '&fg=' + encodeURIComponent(previewFgHex),
    )
    : ''

  // Vorschau: das alte Bild bleibt bei opacity .6 stehen, eine role="status"-Zeile meldet den
  // Ladefall, und nur die letzte Anfrage setzt das Bild (kein Zurückspringen auf eine ältere Antwort).
  useEffect(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setPreviewError('')
    if (!open || !previewUrl){
      setPreviewLoading(false)
      if (!previewUrl) setPreviewSrc('')
      return undefined
    }
    setPreviewLoading(true)
    if (typeof window === 'undefined' || typeof window.Image !== 'function'){
      setPreviewSrc(previewUrl)
      setPreviewLoading(false)
      return undefined
    }
    const probe = new window.Image()
    probe.onload = () => {
      if (requestIdRef.current !== requestId) return
      setPreviewSrc(previewUrl)
      setPreviewLoading(false)
    }
    probe.onerror = () => {
      if (requestIdRef.current !== requestId) return
      setPreviewError(PREVIEW_ERROR_TEXT)
      setPreviewLoading(false)
    }
    probe.src = previewUrl
    return undefined
  }, [open, previewUrl])

  // Escape verwirft die Dialogänderungen (Muster aus AdminEntriesTab, Listener mit Cleanup).
  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event){
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  // Modaler Dialog (aria-modal): Seite dahinter nicht scrollen, Fokus im Dialog halten und beim
  // Schließen auf das auslösende Element zurückgeben.
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement
    document.body.style.overflow = 'hidden'

    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()

    // Fokus, der den Dialog trotzdem verlässt (Klick, Screenreader-Sprung), zurückholen.
    function handleFocusIn(event){
      const node = dialogRef.current
      if (node && !node.contains(event.target)) node.focus()
    }
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)){
        previouslyFocused.focus()
      }
    }
  }, [open])

  /** Tab/Shift+Tab springen zyklisch zwischen dem ersten und letzten fokussierbaren Element. */
  function handleDialogKeyDown(event){
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((node) => node.getClientRects().length > 0)
    if (!focusable.length){
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement
    if (event.shiftKey && (current === first || current === dialog)){
      event.preventDefault()
      last.focus()
    }else if (!event.shiftKey && current === last){
      event.preventDefault()
      first.focus()
    }
  }

  // Beim Öffnen bekommt die gewählte Kachel den Fokus, sonst die erste.
  useEffect(() => {
    if (!open || !options) return
    const container = bodyRef.current
    if (!container || typeof container.querySelector !== 'function') return
    const target = selection.glyph
      ? container.querySelector(`[data-testid="cover-tile-${selection.glyph}"]`)
      : container.querySelector('[data-testid^="cover-tile-"]')
    if (target && typeof target.focus === 'function') target.focus()
    // Bewusst nur beim Öffnen bzw. beim Eintreffen der Optionen — nicht bei jeder Kachelwahl,
    // sonst würde der Fokus dem Klick hinterherspringen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options])

  if (!open) return null

  const glyphs = Array.isArray(options?.glyphs) ? options.glyphs : []
  const backgrounds = Array.isArray(options?.backgrounds) ? options.backgrounds : []
  const zodiacGlyphs = glyphs.filter((item) => item.family === 'zodiac')
  const planetGlyphs = glyphs.filter((item) => item.family === 'planet')
  // Häuser sind im Backend gezeichnete Räder (kein Font-Zeichen) — die Familie liefert die
  // Gruppe, der Server die Namen, das Frontend bleibt frei von Glyphenwissen.
  const houseGlyphs = glyphs.filter((item) => item.family === 'house')
  const visibleGlyphColors = glyphColorPresets.filter(
    (preset) => !selection.bg || (Array.isArray(preset.allowed_for) && preset.allowed_for.includes(selection.bg)),
  )
  const glyphName = presetName(glyphs, selection.glyph)
  const backgroundName = presetName(backgrounds, selection.bg)
  const glyphColorName = presetName(glyphColorPresets, selection.fg)

  function chooseBackground(bgKey){
    setSelection((current) => {
      const allowed = allowedGlyphColorKeys(bgKey)
      const fgKey = allowed.includes(current.fg) ? current.fg : (allowed[0] || null)
      return { ...current, bg: bgKey, fg: fgKey }
    })
  }

  function handleApply(){
    if (!selection.glyph) return
    onApply({ glyph: selection.glyph, bg: selection.bg, fg: selection.fg })
  }

  function renderGlyphGroup(title, items){
    if (!items.length) return null
    return (
      <section className="admin-cover-group">
        <h4>{title}</h4>
        <div className="admin-cover-grid">
          {items.map((item) => {
            const selected = selection.glyph === item.key
            const url = tileUrl(item.key)
            return (
              <button
                key={item.key}
                type="button"
                className={selected ? 'admin-cover-tile admin-cover-tile-selected' : 'admin-cover-tile'}
                aria-pressed={selected}
                data-testid={'cover-tile-' + item.key}
                onClick={() => setSelection((current) => ({ ...current, glyph: item.key }))}
              >
                {suggestion === item.key ? <span className="admin-cover-badge">Vorschlag</span> : null}
                {url ? <img className="admin-cover-tile-image" src={url} alt="" /> : <span className="admin-cover-tile-image" />}
                <span className="admin-cover-tile-name">{item.name}</span>
                {selected ? <span className="admin-cover-tile-check" aria-hidden="true">✓</span> : null}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="admin-cover-overlay">
      <div
        className="admin-panel admin-cover-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={OPTIONS_TITLE_ID}
        data-testid="admin-cover-picker"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="admin-panel-header">
          <div>
            <h3 id={OPTIONS_TITLE_ID}>Artikelbild wählen</h3>
            <p>Wähle Symbol, Hintergrund und Symbolfarbe. Die Vorschau zeigt das fertige Bild in 400 × 210.</p>
          </div>
          <div className="admin-action-group">
            <button type="button" className="admin-secondary-button" data-testid="admin-cover-cancel" onClick={onCancel}>
              Abbrechen
            </button>
            <button
              type="button"
              className="admin-primary-button"
              data-testid="admin-cover-apply"
              onClick={handleApply}
              disabled={!selection.glyph}
            >
              Bild übernehmen
            </button>
          </div>
        </div>

        {optionsError ? <div className="admin-message admin-error">{optionsError}</div> : null}

        <div className="admin-cover-body" ref={bodyRef}>
          <div className="admin-cover-column admin-cover-column-preview">
            <section className="admin-cover-group">
              <h4>Vorschau</h4>
              {!selection.glyph ? (
                <div className="admin-cover-placeholder">Wähle ein Symbol, um die Vorschau zu sehen.</div>
              ) : null}
              {selection.glyph && previewSrc ? (
                <img
                  className={previewLoading ? 'admin-cover-preview admin-cover-preview-pending' : 'admin-cover-preview'}
                  data-testid="admin-cover-preview"
                  src={previewSrc}
                  alt={'Vorschau: ' + (glyphName || selection.glyph) + ' auf ' + (backgroundName || '–') + ', Symbolfarbe ' + (glyphColorName || '–')}
                />
              ) : null}
              {selection.glyph && !previewSrc ? <div className="admin-cover-placeholder" /> : null}
              {previewLoading ? <p className="admin-cover-note" role="status">Vorschau wird erstellt …</p> : null}
              {previewError ? <div className="admin-message admin-error">{previewError}</div> : null}
            </section>

            <section className="admin-cover-group">
              <h4>Hintergrund</h4>
              <div className="admin-cover-swatches">
                {backgrounds.map((preset) => {
                  const selected = selection.bg === preset.key
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      className={selected ? 'admin-cover-swatch admin-cover-swatch-selected' : 'admin-cover-swatch'}
                      aria-pressed={selected}
                      aria-label={'Hintergrund: ' + preset.name}
                      data-testid={'cover-bg-' + preset.key}
                      onClick={() => chooseBackground(preset.key)}
                    >
                      <span className="admin-cover-swatch-face" style={{ '--admin-cover-swatch': preset.hex }} />
                      <span className="admin-cover-swatch-name">{preset.name}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="admin-cover-group">
              <h4>Symbolfarbe</h4>
              <div className="admin-cover-swatches">
                {visibleGlyphColors.map((preset) => {
                  const selected = selection.fg === preset.key
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      className={selected ? 'admin-cover-swatch admin-cover-swatch-selected' : 'admin-cover-swatch'}
                      aria-pressed={selected}
                      aria-label={'Symbolfarbe: ' + preset.name}
                      data-testid={'cover-fg-' + preset.key}
                      onClick={() => setSelection((current) => ({ ...current, fg: preset.key }))}
                    >
                      <span className="admin-cover-swatch-face" style={{ '--admin-cover-swatch': preset.hex }} />
                      <span className="admin-cover-swatch-name">{preset.name}</span>
                    </button>
                  )
                })}
              </div>
              {lightBackgroundGlyphNames.length === 1 ? (
                <p className="admin-cover-note">Auf hellem Hintergrund gibt es nur die Symbolfarbe {lightBackgroundGlyphNames[0]}.</p>
              ) : null}
            </section>
          </div>

          <div className="admin-cover-column admin-cover-column-glyphs">
            {!options && !optionsError ? <p className="admin-cover-note">Lade Bildoptionen …</p> : null}
            {tilesUnavailable ? (
              <div className="admin-message admin-error" role="alert" data-testid="admin-cover-tiles-error">{TILE_ERROR_TEXT}</div>
            ) : null}
            {renderGlyphGroup('Tierkreiszeichen', zodiacGlyphs)}
            {renderGlyphGroup('Planeten', planetGlyphs)}
            {renderGlyphGroup('Häuser', houseGlyphs)}
          </div>
        </div>
      </div>
    </div>
  )
}

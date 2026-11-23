import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiUrl, del, get, post, put } from '../../services/api'
import AdminCoverPicker from './AdminCoverPicker'
import { refreshRebuildStamp } from '../../services/wikiRebuild'
import { markdownComponents as baseMarkdownComponents } from '../MarkdownRenderer'

// Admin-Vorschau: gemeinsame Basis aus MarkdownRenderer, nur die Ueberschriften etwas kompakter.
const markdownComponents = {
  ...baseMarkdownComponents,
  h1: ({ node, ...props }) => <h1 style={{ margin: '0 0 12px', fontSize: '1.4rem', lineHeight: 1.2 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '18px 0 10px', fontSize: '1.15rem', lineHeight: 1.25 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '14px 0 8px', fontSize: '1rem', lineHeight: 1.3 }} {...props} />,
}

/**
 * Formular-Grundzustand. `cover_glyph`/`cover_bg`/`cover_fg` tragen **Preset-Schlüssel**, nie
 * Hex-Werte: der Picker arbeitet mit Schlüsseln, und Hex entsteht nur beim Bauen einer
 * Vorschau-URL bzw. beim Senden des Payloads. `cover_url` ist ein reiner Anzeigewert, der
 * fertig vom Server kommt (`EntryOut.cover_url`) und nie gesendet wird.
 *
 * `ispublic` startet auf `true`: Öffentlichkeit ist der Normalfall, der Admin nimmt das
 * Häkchen nur bei den wenigen Ausnahmen heraus. Das gilt **nur für das leere Formular** —
 * bestehende Einträge, das Häkchen im Editor und der Speicherpfad bleiben unverändert, es gibt
 * keinen Massenlauf und keine Migration.
 */
const emptyEntryForm = {
  entry_name: '',
  slug: '',
  entry_short: '',
  entry_content: '',
  generate_text: '',
  ispublic: true,
  entry_number: 0,
  section_id: '',
  category_id: '',
  entry_generate: false,
  entry_active: true,
  entry_published: '',
  cover_glyph: null,
  cover_bg: null,
  cover_fg: null,
  cover_url: '',
}

/** Gespeicherter Bildstand des offenen Eintrags — Schlüssel (bg/fg) und Anzeige-URL. */
const emptySavedCover = { glyph: null, bg: null, fg: null, url: '' }

const COVER_ERROR_MESSAGE = 'Die Bildauswahl ist ungültig. Öffne „Bild ändern“ und wähle erneut.'
const COVER_FIELDS = new Set(['cover_glyph', 'cover_bg', 'cover_fg'])

/**
 * Übersetzt eine 422-Antwort in eine Meldung, die zur tatsächlichen Ursache passt.
 * Nur Fehler der Bildauswahl (Detail „Ungültige Bildauswahl“ aus dem Router oder ein
 * Validierungsfehler an einem Cover-Feld) zeigen auf „Bild ändern“; jede andere
 * Feldvalidierung nennt Feld und Grund.
 * @param {*} body - geparster Antwortkörper (FastAPI: `detail` als String oder Liste)
 * @returns {string} Meldung für die Fehlerzeile des Editors
 */
function validationErrorMessage(body){
  const detail = body?.detail
  if (typeof detail === 'string'){
    return detail === 'Ungültige Bildauswahl' ? COVER_ERROR_MESSAGE : detail
  }
  if (Array.isArray(detail) && detail.length){
    const coverError = detail.some((item) => {
      const loc = Array.isArray(item?.loc) ? item.loc : []
      if (loc.some((part) => COVER_FIELDS.has(part))) return true
      return typeof item?.msg === 'string' && /cover_(bg|fg|glyph)/.test(item.msg)
    })
    if (coverError) return COVER_ERROR_MESSAGE
    const parts = detail.map((item) => {
      const loc = Array.isArray(item?.loc) ? item.loc.filter((part) => part !== 'body') : []
      const field = loc.length ? loc.join('.') : 'Eingabe'
      return `${field}: ${item?.msg || 'ungültig'}`
    })
    return `Eingaben sind ungültig — ${parts.join('; ')}`
  }
  return 'Eingaben sind ungültig (422). Bitte Felder prüfen.'
}

/**
 * AdminEntriesTab - Admin panel tab for managing wiki entries with CRUD operations and markdown preview
 * @component
 * @param {Object} props - Component props
 * @param {Object} [props.entryEditRequest] - Optional pre-populated entry data for editing; `requestedAt` marks a new request
 * @returns {JSX.Element} Rendered entry management interface with search, create, edit, and delete
 */
export default function AdminEntriesTab({ entryEditRequest }){
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [entryQuery, setEntryQuery] = useState('')
  const [entrySectionFilter, setEntrySectionFilter] = useState('')
  const [entryCategoryFilter, setEntryCategoryFilter] = useState('')
  const [entryPublicFilter, setEntryPublicFilter] = useState('')
  const [entryActiveFilter, setEntryActiveFilter] = useState('')
  const [entryNotPublicFilter, setEntryNotPublicFilter] = useState(false)
  const [entryLoading, setEntryLoading] = useState(false)
  const [entryError, setEntryError] = useState('')
  const [entrySuccess, setEntrySuccess] = useState('')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [hasLoadedSearch, setHasLoadedSearch] = useState(false)
  const [isContentExpanded, setIsContentExpanded] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [slugRefreshCount, setSlugRefreshCount] = useState(0)
  const [coverOptions, setCoverOptions] = useState(null)
  const [coverSuggestion, setCoverSuggestion] = useState(null)
  const [coverSuggestionReady, setCoverSuggestionReady] = useState(false)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverBulkBusy, setCoverBulkBusy] = useState(false)
  // Der gespeicherte Bildstand (Schlüssel + Anzeige-URL) — Bezugspunkt für „geändert?".
  const savedCoverRef = useRef({ ...emptySavedCover })
  // Hex-Werte eines gespeicherten Eintrags, die ohne geladene Optionen noch nicht auf
  // Schlüssel abgebildet werden konnten; der Effect auf `coverOptions` bildet sie nach.
  const pendingCoverHexRef = useRef({ bg: null, fg: null })
  const coverOpenButtonRef = useRef(null)
  // Laufende Nummer der Cover-Vorschlagsanfrage: verwirft veraltete Antworten.
  const suggestionRequestIdRef = useRef(0)
  const ITEMS_PER_PAGE = 10

  function presetByKey(presets, key){
    if (!key || !Array.isArray(presets)) return null
    return presets.find((preset) => preset.key === key) || null
  }

  function presetKeyForHex(presets, hexValue){
    if (!hexValue || !Array.isArray(presets)) return null
    const wanted = String(hexValue).trim().toUpperCase()
    const found = presets.find((preset) => String(preset.hex || '').trim().toUpperCase() === wanted)
    return found ? found.key : null
  }

  function bgKeyForHex(hexValue){
    return presetKeyForHex(coverOptions?.backgrounds, hexValue)
  }

  function fgKeyForHex(hexValue){
    return presetKeyForHex(coverOptions?.glyph_colors, hexValue)
  }

  function bgHexForKey(key){
    const preset = presetByKey(coverOptions?.backgrounds, key)
    return preset ? preset.hex : ''
  }

  function fgHexForKey(key){
    const preset = presetByKey(coverOptions?.glyph_colors, key)
    return preset ? preset.hex : ''
  }

  function glyphNameForKey(key){
    const preset = presetByKey(coverOptions?.glyphs, key)
    return preset ? preset.name : ''
  }

  function backgroundNameForKey(key){
    const preset = presetByKey(coverOptions?.backgrounds, key)
    return preset ? preset.name : ''
  }

  function glyphColorNameForKey(key){
    const preset = presetByKey(coverOptions?.glyph_colors, key)
    return preset ? preset.name : ''
  }

  async function loadSections(){
    try{
      const resp = await get('/wiki/sections')
      if (!resp.ok) throw new Error(`Bereiche konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(_){
      setSections([])
    }
  }

  async function loadCategories(){
    try{
      const resp = await get('/wiki/categories')
      if (!resp.ok) throw new Error(`Kategorien konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setCategories(Array.isArray(data) ? data : [])
    }catch(_){
      setCategories([])
    }
  }

  // Die einzige Quelle für den Filtersatz der Beitragsliste. Jeder Abruf — Tippen,
  // Select-Wechsel, Kurzwahl, Speichern, Löschen, Bildvorschläge, Aktualisieren — geht
  // hierüber, damit kein Nachladen auf einen Teil-Filtersatz zurückfällt.
  function currentEntryFilters(){
    const base = {
      q: entryQuery.trim(),
      section_id: entrySectionFilter,
      category_id: entryCategoryFilter,
    }
    // Die Kurzwahl schlägt die Selects: solange sie aktiv ist, wird sie allein gesendet —
    // ohne `ispublic` (und ohne `active_only`). Ein unbedingtes Spread würde die Kurzwahl
    // stillschweigend mit einem stehengebliebenen Select verschneiden und die falsche
    // Menge liefern; die Select-Werte bleiben im State und gelten beim Ausschalten wieder.
    if (entryNotPublicFilter) return { ...base, not_public: true }
    return {
      ...base,
      ispublic: entryPublicFilter,
      active_only: entryActiveFilter,
    }
  }

  async function loadEntries(filters = {}){
    setEntryLoading(true)
    setEntryError('')
    try{
      const params = new URLSearchParams()
      if (filters.q) params.set('q', filters.q)
      if (filters.section_id) params.set('section_id', String(filters.section_id))
      if (filters.category_id) params.set('category_id', String(filters.category_id))
      if (filters.ispublic) params.set('ispublic', filters.ispublic)
      if (filters.not_public) params.set('not_public', 'true')
      // Der Parameter heißt `active_only`, aber der Service wertet
      // `Entry.entry_active == active_only` aus: 'false' wählt die **inaktiven** Zeilen
      // (Tri-State, kein zweiter Parameter und keine Umbenennung).
      if (filters.active_only) params.set('active_only', filters.active_only)
      params.set('limit', '100')
      const resp = await get(`/wiki/entries?${params.toString()}`)
      if (!resp.ok) throw new Error(`Beiträge konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setEntries(Array.isArray(data) ? data : [])
      setHasLoadedSearch(true)
    }catch(err){
      setEntryError(err?.message || 'Beiträge konnten nicht geladen werden')
    }finally{
      setEntryLoading(false)
    }
  }

  function resetEntryForm(){
    savedCoverRef.current = { ...emptySavedCover }
    pendingCoverHexRef.current = { bg: null, fg: null }
    setSelectedEntry({ ...emptyEntryForm })
    setEntryError('')
    setEntrySuccess('')
  }

  function editEntry(entry){
    const category = categories.find((item) => Number(item.category_id) === Number(entry.category_id))
    // Hex → Preset-Schlüssel. Sind die Optionen noch nicht geladen, bleibt der Hex-Wert im
    // Merker und der Effect auf `coverOptions` bildet ihn nach — sonst bliebe die Swatch
    // nach einem Reload unselektiert.
    const coverBgKey = bgKeyForHex(entry.cover_bg)
    const coverFgKey = fgKeyForHex(entry.cover_fg)
    pendingCoverHexRef.current = {
      bg: !coverOptions && entry.cover_bg ? entry.cover_bg : null,
      fg: !coverOptions && entry.cover_fg ? entry.cover_fg : null,
    }
    savedCoverRef.current = {
      glyph: entry.cover_glyph || null,
      bg: coverBgKey,
      fg: coverFgKey,
      url: entry.cover_url || '',
    }
    setSelectedEntry({
      entry_id: entry.entry_id,
      entry_name: entry.entry_name || '',
      slug: entry.slug || '',
      entry_short: entry.entry_short || '',
      entry_content: entry.entry_content || '',
      generate_text: entry.generate_text || '',
      ispublic: entry.ispublic === true,
      entry_number: Number(entry.entry_number) || 0,
      section_id: category?.section_id ?? '',
      category_id: entry.category_id ?? '',
      entry_generate: entry.entry_generate === true,
      entry_active: entry.entry_active !== false,
      entry_published: entry.entry_published || '',
      cover_glyph: entry.cover_glyph || null,
      cover_bg: coverBgKey,
      cover_fg: coverFgKey,
      cover_url: entry.cover_url || '',
    })
    setEntryError('')
    setEntrySuccess('')
  }

  /** Übernimmt die Picker-Auswahl (Schlüssel) in den Formularzustand — kein zweiter Speicherpfad. */
  function applyCoverSelection(next){
    setSelectedEntry((current) => ({
      ...(current || emptyEntryForm),
      cover_glyph: next?.glyph || null,
      cover_bg: next?.bg || null,
      cover_fg: next?.fg || null,
    }))
  }

  function removeCover(){
    setSelectedEntry((current) => ({
      ...(current || emptyEntryForm),
      cover_glyph: null,
      cover_bg: null,
      cover_fg: null,
      cover_url: '',
    }))
  }

  /** Auswahl auf den Servervorschlag setzen, mit dem Standardpaar aus `/wiki/cover-options`. */
  function applyCoverSuggestion(){
    if (!coverSuggestion?.glyph) return
    applyCoverSelection({
      glyph: coverSuggestion.glyph,
      bg: coverOptions?.default_background || null,
      fg: coverOptions?.default_glyph_color || null,
    })
  }

  function closeCoverPicker(){
    setCoverPickerOpen(false)
    const trigger = coverOpenButtonRef.current
    if (trigger && typeof trigger.focus === 'function') trigger.focus()
  }

  async function saveEntry(){
    if (!selectedEntry?.entry_name?.trim()){
      setEntryError('Bitte einen Beitragsnamen eingeben')
      return
    }
    if (!selectedEntry?.category_id && selectedEntry?.category_id !== 0){
      setEntryError('Bitte eine Kategorie auswählen')
      return
    }
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    const previousCoverUrl = savedCoverRef.current.url || ''
    try{
      const payload = {
        entry_name: selectedEntry.entry_name.trim(),
        entry_short: selectedEntry.entry_short || null,
        entry_content: selectedEntry.entry_content || null,
        generate_text: selectedEntry.generate_text || null,
        ispublic: !!selectedEntry.ispublic,
        entry_number: Number(selectedEntry.entry_number) || 0,
        category_id: Number(selectedEntry.category_id),
        entry_generate: !!selectedEntry.entry_generate,
        entry_active: !!selectedEntry.entry_active,
        entry_published: selectedEntry.entry_published || null,
      }
      // Bildauswahl: nur bei Änderung und nur vollständig (drei Felder oder drei Nulls).
      // Ohne geladene Optionen bleiben die Felder ganz aus dem Payload — Speichern ändert
      // das Bild dann nicht, statt mit 422 zu scheitern.
      const savedCover = savedCoverRef.current
      const selectedGlyph = selectedEntry.cover_glyph || null
      const selectedBgKey = selectedEntry.cover_bg || null
      const selectedFgKey = selectedEntry.cover_fg || null
      const selectedBgHex = bgHexForKey(selectedBgKey)
      const selectedFgHex = fgHexForKey(selectedFgKey)
      const coverChanged = selectedGlyph !== (savedCover.glyph || null)
        || selectedBgKey !== (savedCover.bg || null)
        || selectedFgKey !== (savedCover.fg || null)
      const coverCleared = !selectedGlyph && !selectedBgKey && !selectedFgKey
      if (coverOptions && coverChanged){
        if (coverCleared){
          // „Bild entfernen": drei explizite Nulls, nie leere Strings.
          payload.cover_glyph = null
          payload.cover_bg = null
          payload.cover_fg = null
        }else if (selectedGlyph && selectedBgHex && selectedFgHex){
          payload.cover_glyph = selectedGlyph
          payload.cover_bg = selectedBgHex
          payload.cover_fg = selectedFgHex
        }
      }
      const isUpdate = !!selectedEntry.entry_id
      const resp = isUpdate
        ? await put(`/wiki/entries/${selectedEntry.entry_id}`, payload)
        : await post('/wiki/entries', payload)
      if (!resp.ok){
        if (resp.status === 422){
          const body = await resp.json().catch(() => ({}))
          setEntryError(validationErrorMessage(body))
          return
        }
        throw new Error(`${isUpdate ? 'Speichern' : 'Anlegen'} fehlgeschlagen (${resp.status})`)
      }
      const saved = await resp.json()
      await loadEntries(currentEntryFilters())
      editEntry(saved)
      setEntrySuccess(isUpdate ? 'Beitrag aktualisiert' : 'Beitrag angelegt')
      // Ein gesetztes, geändertes oder entferntes Bild meldet einen neuen Änderungsstempel
      // für den Rebuild-Hinweis (kein automatischer Build). Die Anzeige des Speicherns
      // hängt nicht am Ergebnis dieses Aufrufs.
      if ((savedCoverRef.current.url || '') !== previousCoverUrl) void refreshRebuildStamp()
    }catch(err){
      setEntryError(err?.message || 'Beitrag konnte nicht gespeichert werden')
    }finally{
      setEntryLoading(false)
    }
  }

  async function generateText(){
    if (!selectedEntry?.entry_id){
      setEntryError('Bitte zuerst den Beitrag speichern, bevor ein Generierungstext erzeugt wird')
      return
    }
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const resp = await post(`/wiki/entries/${selectedEntry.entry_id}/generate-text`, {})
      if (!resp.ok) throw new Error(`Generierung fehlgeschlagen (${resp.status})`)
      const saved = await resp.json()
      editEntry(saved)
      setEntrySuccess('Inhalt aus Generierungstext erstellt')
    }catch(err){
      setEntryError(err?.message || 'Inhalt konnte nicht generiert werden')
    }finally{
      setEntryLoading(false)
    }
  }

  async function deleteEntry(entryId){
    if (!window.confirm('Beitrag wirklich löschen?')) return
    setEntryLoading(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const resp = await del(`/wiki/entries/${entryId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadEntries(currentEntryFilters())
      if (selectedEntry?.entry_id === entryId) setSelectedEntry(null)
      setEntrySuccess('Beitrag gelöscht')
    }catch(err){
      setEntryError(err?.message || 'Beitrag konnte nicht gelöscht werden')
    }finally{
      setEntryLoading(false)
    }
  }

  /**
   * Wendet die Bildvorschläge auf alle Beiträge der gefilterten Kategorie an.
   * Nur Einträge ohne Bild werden verändert; der Server deckelt auf 100 Änderungen.
   */
  async function applyCoverBulk(){
    if (!entryCategoryFilter) return
    const categoryName = categories.find(
      (item) => Number(item.category_id) === Number(entryCategoryFilter),
    )?.category_name || ''
    const confirmed = window.confirm(
      `Bildvorschläge anwenden: Alle Beiträge der Kategorie „${categoryName}“ ohne Bild erhalten ihr vorgeschlagenes Symbol in Nachtblau mit Gold. Beiträge ohne passenden Vorschlag bleiben ohne Bild. Vorhandene Bilder werden nicht verändert. Fortfahren?`,
    )
    if (!confirmed) return
    setCoverBulkBusy(true)
    setEntryError('')
    setEntrySuccess('')
    try{
      const resp = await post('/wiki/cover-bulk-apply', { category_id: Number(entryCategoryFilter) })
      if (!resp.ok){
        setEntryError(`Bildvorschläge konnten nicht angewendet werden (${resp.status}). Lade die Liste neu, um den aktuellen Stand zu sehen.`)
        return
      }
      const data = await resp.json()
      if (Number(data?.updated) > 0){
        setEntrySuccess(`Bildvorschläge angewendet: ${data.updated} Beiträge mit neuem Bild, ${data.skipped} ohne passenden Vorschlag.`)
      }else{
        setEntrySuccess(`Keine Änderungen: Alle Beiträge der Kategorie „${categoryName}“ haben bereits ein Bild oder keinen passenden Vorschlag.`)
      }
      await loadEntries(currentEntryFilters())
      void refreshRebuildStamp()
    }catch(err){
      setEntryError(err?.message || 'Bildvorschläge konnten nicht angewendet werden')
    }finally{
      setCoverBulkBusy(false)
    }
  }

  useEffect(() => {
    loadSections()
    loadCategories()
  }, [])

  // Bildoptionen (Namen, Hex-Werte, erlaubte Paare) einmal pro Editor-Mount — ein Ladefehler
  // blockiert den Editor nicht, er hält nur die drei Bildfelder aus dem Payload.
  useEffect(() => {
    let cancelled = false
    async function loadCoverOptions(){
      try{
        const resp = await get('/wiki/cover-options')
        if (cancelled || !resp.ok) return
        const data = await resp.json()
        if (cancelled) return
        setCoverOptions(data && typeof data === 'object' ? data : null)
      }catch(_){
        // bewusst still: ohne Optionen bleibt das Bild beim Speichern unverändert
      }
    }
    loadCoverOptions()
    return () => { cancelled = true }
  }, [])

  // Gespeicherte Hex-Werte nachbilden, sobald die Optionen da sind (sonst bliebe die Swatch
  // nach einem Reload unselektiert).
  useEffect(() => {
    if (!coverOptions) return
    const pending = pendingCoverHexRef.current
    if (!pending?.bg && !pending?.fg) return
    pendingCoverHexRef.current = { bg: null, fg: null }
    const nextBgKey = pending.bg ? bgKeyForHex(pending.bg) : null
    const nextFgKey = pending.fg ? fgKeyForHex(pending.fg) : null
    savedCoverRef.current = {
      ...savedCoverRef.current,
      bg: savedCoverRef.current.bg || nextBgKey,
      fg: savedCoverRef.current.fg || nextFgKey,
    }
    setSelectedEntry((current) => {
      if (!current) return current
      return {
        ...current,
        cover_bg: pending.bg ? nextBgKey : current.cover_bg,
        cover_fg: pending.fg ? nextFgKey : current.cover_fg,
      }
    })
    // bgKeyForHex/fgKeyForHex lesen die Optionen dieses Rendervorgangs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverOptions])

  // Vorschlag aus Titel/Kategorie — beim Öffnen und 250 ms nach der letzten Änderung.
  // Jede Effekt-Ausführung zieht eine neue laufende Nummer; nur die Antwort zur aktuellen
  // Nummer darf den Vorschlag setzen (Muster aus AdminCoverPicker) — sonst
  // überschreibt eine späte Antwort für einen alten Titel den Vorschlag für den neuen.
  useEffect(() => {
    const requestId = ++suggestionRequestIdRef.current
    const isCurrent = () => suggestionRequestIdRef.current === requestId
    const name = (selectedEntry?.entry_name || '').trim()
    const hasImage = Boolean(selectedEntry?.cover_glyph || selectedEntry?.cover_url)
    if (!selectedEntry || !name || hasImage){
      setCoverSuggestion(null)
      setCoverSuggestionReady(false)
      return undefined
    }
    const handle = window.setTimeout(async () => {
      try{
        const params = new URLSearchParams()
        params.set('name', name)
        if (selectedEntry.category_id !== '' && selectedEntry.category_id != null){
          params.set('category_id', String(selectedEntry.category_id))
        }
        const resp = await get(`/wiki/cover-suggestion?${params.toString()}`)
        if (!isCurrent()) return
        if (!resp.ok){
          setCoverSuggestion(null)
          setCoverSuggestionReady(true)
          return
        }
        const data = await resp.json()
        if (!isCurrent()) return
        setCoverSuggestion({ glyph: data?.glyph || null, name: data?.name || '' })
        setCoverSuggestionReady(true)
      }catch(_){
        if (!isCurrent()) return
        setCoverSuggestion(null)
        setCoverSuggestionReady(true)
      }
    }, 250)
    return () => window.clearTimeout(handle)
  }, [selectedEntry?.entry_name, selectedEntry?.category_id, selectedEntry?.cover_glyph, selectedEntry?.cover_url])

  // Der Effekt hängt am Anfrage-Merker `requestedAt`, nicht an der Objektidentität: ein zweiter
  // Sprung auf denselben Eintrag (`/admin/entries?entry=<id>` erneut) muss erneut öffnen, auch
  // wenn das Request-Objekt memoisiert würde.
  useEffect(() => {
    if (!entryEditRequest?.entry) return
    if (entryEditRequest.entry.category_id != null && !categories.length) return
    editEntry(entryEditRequest.entry)
  }, [entryEditRequest?.requestedAt, categories])

  useEffect(() => {
    const query = entryQuery.trim()
    const handle = window.setTimeout(() => {
      setCurrentPage(1)
      loadEntries(currentEntryFilters())
    }, query ? 250 : 0)
    return () => window.clearTimeout(handle)
  }, [entryQuery, entrySectionFilter, entryCategoryFilter, entryPublicFilter, entryActiveFilter, entryNotPublicFilter])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE))
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [entries, currentPage])

  useEffect(() => {
    if (!isContentExpanded) return undefined

    function handleKeyDown(event){
      if (event.key === 'Escape') setIsContentExpanded(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isContentExpanded])

  const filteredCategories = useMemo(() => {
    if (!entrySectionFilter) return categories
    return categories.filter((category) => Number(category.section_id) === Number(entrySectionFilter))
  }, [categories, entrySectionFilter])

  const formCategories = useMemo(() => {
    if (!selectedEntry?.section_id) return categories
    return categories.filter((category) => Number(category.section_id) === Number(selectedEntry.section_id))
  }, [categories, selectedEntry])

  const entryContentPreview = selectedEntry?.entry_content || ''

  // ── Artikelbild ──────────────────────────────────────────────────────────
  // Vergleich ausschließlich über die Preset-Schlüssel gegen den gespeicherten Stand.
  const savedCover = savedCoverRef.current
  const selectedCoverGlyph = selectedEntry?.cover_glyph || null
  const selectedCoverBgKey = selectedEntry?.cover_bg || null
  const selectedCoverFgKey = selectedEntry?.cover_fg || null
  const coverSelectionChanged = Boolean(selectedEntry) && (
    selectedCoverGlyph !== (savedCover.glyph || null)
    || selectedCoverBgKey !== (savedCover.bg || null)
    || selectedCoverFgKey !== (savedCover.fg || null)
  )
  const selectedCoverBgHex = bgHexForKey(selectedCoverBgKey)
  const selectedCoverFgHex = fgHexForKey(selectedCoverFgKey)
  const pendingCoverUrl = selectedCoverGlyph && selectedCoverBgHex && selectedCoverFgHex
    ? apiUrl(
      '/wiki/cover-preview?variant=full&glyph=' + encodeURIComponent(selectedCoverGlyph)
      + '&bg=' + encodeURIComponent(selectedCoverBgHex)
      + '&fg=' + encodeURIComponent(selectedCoverFgHex),
    )
    : ''
  // Gespeichert und unverändert → Server-`cover_url`; geändert → Vorschau-Endpunkt; sonst Platzhalter.
  const coverPreviewSrc = coverSelectionChanged ? pendingCoverUrl : (savedCover.url || '')
  const hasCoverImage = Boolean(coverPreviewSrc)
  const coverImageAlt = 'Artikelbild: ' + (glyphNameForKey(selectedCoverGlyph) || '–')
    + ' auf ' + (backgroundNameForKey(selectedCoverBgKey) || '–')
    + ', Symbolfarbe ' + (glyphColorNameForKey(selectedCoverFgKey) || '–')
  const coverCaption = 'Symbol: ' + (glyphNameForKey(selectedCoverGlyph) || '–')
    + ' · Hintergrund: ' + (backgroundNameForKey(selectedCoverBgKey) || '–')
    + ' · Symbolfarbe: ' + (glyphColorNameForKey(selectedCoverFgKey) || '–')
  const suggestionGlyph = coverSuggestion?.glyph || null
  const suggestionName = coverSuggestion?.name || glyphNameForKey(suggestionGlyph)

  return (
    <section className="admin-panel" aria-label="Beiträge verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Beiträge verwalten</h3>
          <p>Beiträge anlegen, suchen, bearbeiten und löschen. Die Trefferliste wird serverseitig gefiltert.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={resetEntryForm}>
            Neuer Beitrag
          </button>
          <button
            type="button"
            className="admin-primary-button"
            onClick={() => loadEntries(currentEntryFilters())}
            disabled={entryLoading}
          >
            {entryLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
          <button
            type="button"
            className="admin-secondary-button"
            onClick={async () => {
              setEntryLoading(true)
              setEntryError('')
              setEntrySuccess('')
              try {
                const resp = await post('/wiki/entries/refresh-slugs', {})
                if (!resp.ok) throw new Error(`Slugs aktualisieren fehlgeschlagen (${resp.status})`)
                const data = await resp.json()
                setEntrySuccess(`Slugs aktualisiert: ${data.updated} Beiträge`)
                setSlugRefreshCount((c) => c + 1)
                await loadEntries(currentEntryFilters())
              } catch (err) {
                setEntryError(err?.message || 'Slugs konnten nicht aktualisiert werden')
              } finally {
                setEntryLoading(false)
              }
            }}
            disabled={entryLoading}
            title="Alle Beitrags-Slugs basierend auf entry_name regenerieren"
          >
            Slugs aktualisieren
          </button>
          <button
            type="button"
            className="admin-secondary-button"
            data-testid="admin-cover-bulk-apply"
            onClick={applyCoverBulk}
            disabled={!entryCategoryFilter || entryLoading || coverBulkBusy}
            title={!entryCategoryFilter ? 'Wähle zuerst eine Kategorie im Filter.' : 'Bildvorschläge auf die gefilterte Kategorie anwenden'}
          >
            {coverBulkBusy ? 'Wende an …' : 'Bildvorschläge anwenden'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Freitext</span>
          <input value={entryQuery} onChange={(event) => setEntryQuery(event.target.value)} placeholder="Name, Kurztext oder Inhalt" />
        </label>
        <label className="admin-field">
          <span>Bereich</span>
          <select
            value={entrySectionFilter}
            onChange={(event) => {
              setEntrySectionFilter(event.target.value)
              setEntryCategoryFilter('')
            }}
          >
            <option value="">Alle</option>
            {sections.map((section) => (
              <option key={`entry-filter-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Kategorie</span>
          <select value={entryCategoryFilter} onChange={(event) => setEntryCategoryFilter(event.target.value)}>
            <option value="">Alle</option>
            {filteredCategories.map((category) => (
              <option key={`entry-filter-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Öffentlich</span>
          <select
            value={entryPublicFilter}
            onChange={(event) => setEntryPublicFilter(event.target.value)}
            disabled={entryNotPublicFilter}
            title={entryNotPublicFilter ? 'Die Kurzwahl „Nur nicht wirklich öffentlich“ ist aktiv — dieser Filter wird nicht angewendet.' : undefined}
          >
            <option value="">Alle</option>
            <option value="true">Ja</option>
            <option value="false">Nein</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Aktiv</span>
          <select
            value={entryActiveFilter}
            onChange={(event) => setEntryActiveFilter(event.target.value)}
            disabled={entryNotPublicFilter}
            title={entryNotPublicFilter ? 'Die Kurzwahl „Nur nicht wirklich öffentlich“ ist aktiv — dieser Filter wird nicht angewendet.' : undefined}
          >
            <option value="">Alle</option>
            <option value="true">Ja</option>
            <option value="false">Nein</option>
          </select>
        </label>
        <label
          className="admin-checkbox"
          style={{ marginLeft: 0 }}
          title="Zeigt Einträge, die nicht öffentlich und aktiv zugleich sind — für anonyme Leser unsichtbar."
        >
          <input
            type="checkbox"
            checked={entryNotPublicFilter}
            onChange={(event) => setEntryNotPublicFilter(event.target.checked)}
          />
          <span>Nur nicht wirklich öffentlich</span>
        </label>
      </div>

      {entryError ? <div className="admin-message admin-error">{entryError}</div> : null}
      {entrySuccess ? <div className="admin-message admin-success">{entrySuccess}</div> : null}

      {/* Links eine schmale Liste, rechts der Editor über die ganze Restbreite: das Bearbeiten
          langer Texte braucht Platz, die Auswahl nur eine Zeile je Beitrag. */}
      <div className="admin-entries-layout">
        <div className="admin-entries-list-column">
          {!entries.length && !entryLoading ? (
            <div className="admin-message">{hasLoadedSearch ? 'Keine Beiträge gefunden.' : 'Wähle Suchkriterien, um Beiträge zu laden.'}</div>
          ) : null}
          <ul className="admin-entry-list" data-testid="admin-entry-list">
            {(() => {
              const start = (currentPage - 1) * ITEMS_PER_PAGE
              const paged = entries.slice(start, start + ITEMS_PER_PAGE)
              return paged.map((entry) => {
                const category = categories.find((item) => Number(item.category_id) === Number(entry.category_id))
                const section = sections.find((item) => Number(item.section_id) === Number(category?.section_id))
                const isSelected = Number(selectedEntry?.entry_id) === Number(entry.entry_id)
                const meta = [
                  section?.section_name || 'Bereich unbekannt',
                  category?.category_name || 'Kategorie unbekannt',
                  'Nr. ' + (entry.entry_number ?? 0),
                  entry.cover_glyph ? 'Bild: ' + (glyphNameForKey(entry.cover_glyph) || entry.cover_glyph) : 'kein Bild',
                ].join(' · ')
                return (
                  <li
                    key={`entry-${entry.entry_id}`}
                    className={isSelected ? 'admin-entry-row admin-entry-row-selected' : 'admin-entry-row'}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <div className="admin-entry-row-head">
                      <strong className="admin-entry-row-title">{entry.entry_name}</strong>
                      <span className="admin-entry-badge">{entry.entry_active ? 'Aktiv' : 'Inaktiv'}</span>
                      <span className="admin-entry-badge">{entry.ispublic ? 'Öffentlich' : 'Privat'}</span>
                    </div>
                    <p className="admin-entry-row-meta">{meta}</p>
                    {entry.slug ? (
                      <p className="admin-entry-row-slug"><code>{entry.slug}</code></p>
                    ) : (
                      <p className="admin-entry-row-slug admin-entry-row-slug-missing">Kein Slug</p>
                    )}
                    <div className="admin-entry-row-actions">
                      <button type="button" className="admin-primary-button" onClick={() => editEntry(entry)}>
                        Bearbeiten
                      </button>
                      <button type="button" className="admin-secondary-button" onClick={() => deleteEntry(entry.entry_id)}>
                        Löschen
                      </button>
                    </div>
                  </li>
                )
              })
            })()}
          </ul>
          {entries.length > ITEMS_PER_PAGE ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div style={{ color: '#374151' }}>Seite {currentPage} von {Math.min(10, Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE)))}</div>
              <div>
                <button type="button" className="admin-secondary-button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                  Zurück
                </button>
                <button type="button" className="admin-secondary-button" onClick={() => setCurrentPage((p) => Math.min(Math.min(10, Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE))), p + 1))} disabled={currentPage === Math.min(10, Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE)))} style={{ marginLeft: 8 }}>
                  Weiter
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="admin-entries-editor-column">
          <div className="admin-panel" style={{ padding: 16 }}>
            <h4>{selectedEntry?.entry_id ? 'Beitrag bearbeiten' : 'Beitrag anlegen'}</h4>
            <label className="admin-field" style={{ marginBottom: 10 }}>
              <span>Name</span>
              <input
                value={selectedEntry?.entry_name || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_name: event.target.value }))}
              />
            </label>
            <label className="admin-field" style={{ marginBottom: 10 }}>
              <span>Bereich</span>
              <select
                value={selectedEntry?.section_id ?? ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), section_id: event.target.value, category_id: '' }))}
              >
                <option value="">Bitte wählen</option>
                {sections.map((section) => (
                  <option key={`entry-form-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field" style={{ marginBottom: 10 }}>
              <span>Kategorie</span>
              <select
                value={selectedEntry?.category_id ?? ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), category_id: event.target.value }))}
              >
                <option value="">Bitte wählen</option>
                {formCategories.map((category) => (
                  <option key={`entry-form-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field" style={{ marginBottom: 10 }}>
              <span>Slug</span>
              <input
                value={selectedEntry?.slug || ''}
                readOnly
                style={{ background: 'rgba(var(--admin-accent-r),var(--admin-accent-g),var(--admin-accent-b),.1)', color: 'var(--admin-ink)', fontFamily: 'monospace', fontSize: 12 }}
                title="Slug wird automatisch aus Name + ID generiert"
              />
            </label>
            {/* Kurztext (½) und Artikelbild (¼) nebeneinander, gleich hoch; schmal untereinander. */}
            <div className="admin-entry-short-cover">
            <label className="admin-field">
              <span>Kurztext</span>
              <textarea
                value={selectedEntry?.entry_short || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_short: event.target.value }))}
                rows={2}
              />
            </label>
            <div className="admin-field admin-cover-section" data-testid="admin-cover-section">
              <span>Artikelbild</span>
              {coverPreviewSrc ? (
                <img className="admin-cover-editor-preview" src={coverPreviewSrc} alt={coverImageAlt} />
              ) : (
                <div className="admin-cover-editor-placeholder">Dieser Beitrag hat noch kein Artikelbild.</div>
              )}
              {coverPreviewSrc ? <p className="admin-cover-caption">{coverCaption}</p> : null}
              {!coverPreviewSrc && suggestionGlyph ? (
                <div className="admin-cover-suggestion" data-testid="admin-cover-suggestion">
                  <span>{'Vorschlag: ' + (suggestionName || suggestionGlyph)}</span>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    data-testid="admin-cover-suggestion-apply"
                    onClick={applyCoverSuggestion}
                    disabled={entryLoading || !coverOptions}
                  >
                    Vorschlag übernehmen
                  </button>
                </div>
              ) : null}
              {!coverPreviewSrc && !suggestionGlyph && coverSuggestionReady ? (
                <div className="admin-cover-suggestion" data-testid="admin-cover-suggestion">
                  <span>Kein Vorschlag für diesen Titel.</span>
                </div>
              ) : null}
              <div className="admin-cover-actions">
                <button
                  ref={coverOpenButtonRef}
                  type="button"
                  className="admin-secondary-button"
                  data-testid="admin-cover-open"
                  onClick={() => setCoverPickerOpen(true)}
                  disabled={entryLoading}
                >
                  {hasCoverImage ? 'Bild ändern' : 'Bild wählen'}
                </button>
                {hasCoverImage ? (
                  <button
                    type="button"
                    className="admin-secondary-button"
                    data-testid="admin-cover-remove"
                    onClick={removeCover}
                    disabled={entryLoading}
                  >
                    Bild entfernen
                  </button>
                ) : null}
              </div>
              {coverSelectionChanged ? (
                <p className="admin-cover-caption">Bild geändert – wird mit „Änderungen speichern“ übernommen.</p>
              ) : null}
            </div>
            </div>
            {/* Inhalt und Vorschau nebeneinander (breit) bzw. untereinander (schmal). */}
            <div className="admin-entry-content-grid">
            <label className="admin-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span>Inhalt</span>
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setIsContentExpanded((current) => !current)}
                  style={{ padding: '6px 12px', marginTop: 10 }}
                >
                  {isContentExpanded ? 'Klein anzeigen' : 'Groß anzeigen'}
                </button>
              </div>
              <textarea
                value={selectedEntry?.entry_content || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_content: event.target.value }))}
                rows={20}
                className="admin-entry-content-input"
              />
            </label>
            <div className="admin-field admin-entry-preview-field">
              <span>Markdown Vorschau</span>
              <div style={{ border: '1px solid #dde1e7', borderRadius: 14, background: '#fbfcfe', color: '#203244', overflow: 'hidden' }}>
                <div className="admin-entry-preview-scroll" style={{ overflowX: 'auto', overflowY: 'auto', padding: 14 }}>
                  {entryContentPreview.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {entryContentPreview}
                    </ReactMarkdown>
                  ) : (
                    <div style={{ color: '#6b7c8d' }}>Die Markdown-Vorschau erscheint hier, sobald Inhalt eingegeben wurde.</div>
                  )}
                </div>
              </div>
            </div>
            </div>
            <label className="admin-field">
              <span>Generierungstext</span>
              <textarea
                value={selectedEntry?.generate_text || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), generate_text: event.target.value }))}
                rows={8}
              />
            </label>
            <label className="admin-field">
              <span>Nummer</span>
              <input
                type="number"
                value={selectedEntry?.entry_number ?? 0}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_number: Number(event.target.value) || 0 }))}
              />
            </label>
            <label className="admin-field">
              <span>Veröffentlicht</span>
              <input
                type="date"
                value={selectedEntry?.entry_published || ''}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_published: event.target.value }))}
              />
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.entry_generate === true}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_generate: event.target.checked }))}
              />
              <span>Automatisch generieren</span>
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.entry_active !== false}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_active: event.target.checked }))}
              />
              <span>Aktiv</span>
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedEntry?.ispublic === true}
                onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), ispublic: event.target.checked }))}
              />
              <span>Öffentlich</span>
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="admin-primary-button" onClick={saveEntry} disabled={entryLoading}>
                {selectedEntry?.entry_id ? 'Änderungen speichern' : 'Beitrag anlegen'}
              </button>
              <button className="admin-secondary-button" onClick={generateText} disabled={entryLoading || !selectedEntry?.entry_id} style={{ marginLeft: 8 }}>
                Text Generieren
              </button>
              <button className="admin-secondary-button" onClick={resetEntryForm} style={{ marginLeft: 8 }}>
                Zurücksetzen
              </button>
            </div>
          </div>
        </div>
      </div>

      {isContentExpanded ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(16, 24, 40, 0.55)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            className="admin-panel"
            style={{
              width: 'min(1400px, 100%)',
              height: '100%',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <h4 style={{ margin: 0 }}>Inhalt groß bearbeiten</h4>
                <p style={{ margin: '4px 0 0 0', color: '#4b5d71' }}>Escape oder Button schließt die Großansicht.</p>
              </div>
              <button type="button" className="admin-secondary-button" onClick={() => setIsContentExpanded(false)}>
                Klein anzeigen
              </button>
            </div>
            <textarea
              value={selectedEntry?.entry_content || ''}
              onChange={(event) => setSelectedEntry((current) => ({ ...(current || emptyEntryForm), entry_content: event.target.value }))}
              style={{ flex: 1, minHeight: 0, width: '100%', resize: 'none' }}
            />
          </div>
        </div>
      ) : null}

      <AdminCoverPicker
        open={coverPickerOpen}
        value={{ glyph: selectedCoverGlyph, bg: selectedCoverBgKey, fg: selectedCoverFgKey }}
        suggestion={suggestionGlyph}
        onApply={(next) => { applyCoverSelection(next); closeCoverPicker() }}
        onCancel={closeCoverPicker}
      />
    </section>
  )
}
/**
 * AdminHomeCurationTab - Startseiten-Kuration im CMS.
 *
 * Drei Verträge prägen diesen Tab:
 *
 * 1. **Die Liste ist vollständig.** Gelesen wird `GET /wiki/home-selection` (admin-only, ohne
 *    Deckel) — nicht `/wiki/entries` mit `limit=100`. Nur so enthält die Liste *jede*
 *    Markierung, und ein Drop kann die vollständige Reihenfolge an `PUT /wiki/home-order`
 *    senden. Der Server nummeriert daraus dicht 1..n; eine Teilliste würde doppelte
 *    `home_order`-Werte erzeugen.
 * 2. **Nichts verschwindet still.** Eine Markierung, die nicht öffentlich, nicht aktiv oder in
 *    einem nicht wiki-aktiven Bereich liegt, bleibt in der Liste und trägt ein Abzeichen
 *    „Erscheint nicht auf der Startseite – …“; sie fehlt nur in der Vorschau, weil die den
 *    öffentlichen Karten-Endpunkt liest.
 * 3. **Die Vorschau ist der öffentliche Endpunkt.** `GET /wiki/home-cards` ist genau die Quelle,
 *    die auch die Startseite rendert — kein zweiter Sichtbarkeitsbegriff im Client.
 *
 * @component
 * @returns {JSX.Element} Kurationsansicht mit sortierbarer Liste, Suche und Vorschau
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { get, put } from '../../services/api'
import { refreshRebuildStamp } from '../../services/wikiRebuild'
import { DEFAULT_COVER_URL } from '../../services/covers'

/**
 * Fällt beim Bildfehler einmalig auf das Standardbild zurück — wie die Startseite
 * (`Dashboard.jsx`), damit die Vorschau denselben Zustand zeigt.
 * @param {Event} event - `error`-Ereignis des Vorschaubildes
 * @returns {void}
 */
function handleCoverError(event){
  const image = event.currentTarget
  if (!image || image.dataset.coverFallback === '1') return
  image.dataset.coverFallback = '1'
  image.src = DEFAULT_COVER_URL
}

/** Deckel der Startseite. Gezählt werden **alle** Markierungen, auch die versteckten. */
const HOME_LIMIT = 12

/** Deutsche Screenreader-Anweisung — die englischen dnd-kit-Defaults dürfen nie erscheinen. */
const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Zum Verschieben Leertaste drücken. Mit Pfeil hoch und Pfeil runter bewegen, mit Leertaste ablegen, mit Escape abbrechen.',
}

/**
 * Baut aus einem HTTP-Status einen Fehler, damit die Meldungen `({status})` tragen.
 * @param {number} status - HTTP-Status der fehlgeschlagenen Antwort
 * @returns {Error} Fehler mit `status`-Feld
 */
function statusError(status){
  const err = new Error('HTTP ' + status)
  err.status = status
  return err
}

/**
 * Setzt den HTTP-Status in einen Meldungstext ein. Der Text bleibt als Vertrag wörtlich im
 * Quelltext stehen (`({status})`), die Laufzeit füllt nur den Platzhalter.
 * @param {string} text - Meldung mit `{status}`-Platzhalter
 * @param {(number|string)} status - HTTP-Status oder `–`
 * @returns {string} fertige Meldung
 */
function withStatus(text, status){
  return text.replace('{status}', String(status ?? '–'))
}

/**
 * Sortiert Kurationszeilen wie der Server: `home_order` aufsteigend, leere Werte zuletzt,
 * Gleichstand nach `entry_id`. Die Antwort ist bereits sortiert — das ist nur der Schutz
 * gegen eine abweichende Serverantwort.
 * @param {Array<Object>} rows - Zeilen aus `/wiki/home-selection`
 * @returns {Array<Object>} sortierte Kopie
 */
function sortRows(rows){
  return [...rows].sort((a, b) => {
    const left = a.home_order == null ? Number.POSITIVE_INFINITY : a.home_order
    const right = b.home_order == null ? Number.POSITIVE_INFINITY : b.home_order
    if (left !== right) return left - right
    return (Number(a.entry_id) || 0) - (Number(b.entry_id) || 0)
  })
}

/**
 * Nummeriert eine Liste dicht von 1 bis n — die Anzeige folgt sofort dem Drop.
 * @param {Array<Object>} rows - Zeilen in Zielreihenfolge
 * @returns {Array<Object>} Kopien mit gesetztem `home_order`
 */
function renumber(rows){
  return rows.map((row, index) => ({ ...row, home_order: index + 1 }))
}

/**
 * Gründe, warum eine Markierung nicht auf der Startseite erscheint.
 * Die Felder kommen aus `/wiki/home-selection`, es gibt keine zweite Client-Regel.
 * @param {Object} entry - Kurationszeile
 * @returns {string[]} deutsche Gründe in fester Reihenfolge
 */
function visibilityReasons(entry){
  const reasons = []
  if (entry.ispublic === false) reasons.push('nicht öffentlich')
  if (entry.entry_active === false) reasons.push('inaktiv')
  if (entry.wiki_active === false) reasons.push('Bereich nicht im Wiki')
  return reasons
}

/**
 * Eine sortierbare Zeile der Kurationsliste.
 * @param {Object} props
 * @param {Object} props.entry - Kurationszeile
 * @param {number} props.position - 1-basierte Position in der Liste
 * @param {Function} props.onRemove - Entfernen-Handler
 * @param {Function} props.registerHandle - Callback-Ref für den Fokus nach dem Entfernen
 * @returns {JSX.Element} Listenzeile
 */
function CurationItem({ entry, position, onRemove, registerHandle }){
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.entry_id,
  })
  const reasons = visibilityReasons(entry)

  return (
    <li
      ref={setNodeRef}
      className={isDragging ? 'admin-home-item admin-home-item-dragging' : 'admin-home-item'}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={'home-curation-item-' + entry.entry_id}
    >
      <button
        ref={(node) => registerHandle(entry.entry_id, node)}
        type="button"
        className="admin-home-handle"
        aria-label={(entry.entry_name || 'Beitrag') + ' verschieben'}
        data-testid={'home-curation-handle-' + entry.entry_id}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">≡</span>
      </button>
      <span className="admin-home-position">{position}.</span>
      {entry.cover_url ? (
        <img className="admin-home-thumb" src={entry.cover_url} alt="" />
      ) : (
        <span className="admin-home-thumb admin-home-thumb-empty">Kein Bild</span>
      )}
      <div className="admin-home-meta">
        <span className="admin-home-title" title={entry.entry_name || ''}>{entry.entry_name}</span>
        {entry.category_name ? <span className="admin-home-category">{entry.category_name}</span> : null}
        {reasons.length ? (
          <span className="admin-home-badge" data-testid={'home-curation-warning-' + entry.entry_id}>
            {'Erscheint nicht auf der Startseite – ' + reasons.join(' und ')}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="admin-secondary-button admin-home-remove"
        aria-label={(entry.entry_name || 'Beitrag') + ' von der Startseite entfernen'}
        data-testid={'home-curation-remove-' + entry.entry_id}
        onClick={() => onRemove(entry)}
      >
        Entfernen
      </button>
    </li>
  )
}

export default function AdminHomeCurationTab(){
  const [items, setItems] = useState([])
  // Letzter Stand, den der Server bestätigt hat — Rücksetzpunkt für einen gescheiterten Drop.
  const [serverItems, setServerItems] = useState([])
  const [loadState, setLoadState] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [orderError, setOrderError] = useState('')
  const [changeError, setChangeError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [previewCards, setPreviewCards] = useState([])
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const handleRefs = useRef({})
  const headingRef = useRef(null)

  function registerHandle(entryId, node){
    if (node) handleRefs.current[entryId] = node
    else delete handleRefs.current[entryId]
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const isFull = items.length >= HOME_LIMIT
  const markedIds = new Set(items.map((item) => item.entry_id))
  const addableResults = searchResults.filter((entry) => !markedIds.has(entry.entry_id))

  /**
   * Liest die vollständige Kurationsliste vom Server (einzige Wahrheit).
   * @param {{silent?: boolean}} [options] - `silent`: kein Lade-/Fehlerzustand für die ganze
   *   Spalte, nur Liste und Serverstand ersetzen (Nachladen nach einer Änderung)
   * @returns {Promise<boolean>} `true`, wenn die Liste neu geladen wurde
   */
  async function loadSelection({ silent = false } = {}){
    if (!silent){
      setLoadState('loading')
      setLoadError('')
    }
    try{
      // Bewusst ohne `limit`: die vollständige Markierungsmenge ist die Bedingung dafür,
      // dass `PUT /wiki/home-order` dicht und eindeutig nummerieren kann.
      const resp = await get('/wiki/home-selection')
      if (!resp.ok) throw statusError(resp.status)
      const data = await resp.json()
      const rows = sortRows(Array.isArray(data) ? data : [])
      setItems(rows)
      setServerItems(rows)
      setLoadState('ready')
      return true
    }catch(err){
      if (silent) return false
      setLoadState('error')
      setLoadError(withStatus('Startseiten-Auswahl konnte nicht geladen werden ({status}). Lade die Seite neu.', err?.status))
      return false
    }
  }

  /**
   * Nach einem Fehler den Serverstand übernehmen statt des lokal gemerkten: hat der erste von
   * zwei Aufrufen bereits geschrieben, wäre `serverItems` veraltet, und jeder folgende
   * `PUT /wiki/home-order` liefe in die Mengenprüfung (400). Schlägt auch das Nachladen fehl,
   * bleibt der letzte bekannte Stand stehen.
   * @returns {Promise<boolean>} `true`, wenn die Liste vom Server neu geladen wurde
   */
  async function resyncFromServer(){
    const reloaded = await loadSelection({ silent: true })
    if (!reloaded) setItems(serverItems)
    return reloaded
  }

  /**
   * Fehlertext für eine Zwei-Schritt-Änderung, abhängig davon, ob der Server schon geschrieben hat.
   * @param {boolean} partial - der erste Aufruf (Markierung) war bereits erfolgreich
   * @param {boolean} reloaded - die Liste wurde vom Server neu geladen
   * @param {number|undefined} status - HTTP-Status des fehlgeschlagenen Aufrufs
   * @returns {string} Meldung für die Alert-Zeile
   */
  function changeFailureMessage(partial, reloaded, status){
    if (!partial){
      return withStatus('Änderung konnte nicht gespeichert werden ({status}). Die Liste zeigt wieder den gespeicherten Stand.', status)
    }
    if (reloaded){
      return withStatus('Änderung wurde nur teilweise gespeichert ({status}). Die Liste wurde vom Server neu geladen — bitte prüfen.', status)
    }
    return withStatus('Änderung wurde nur teilweise gespeichert ({status}). Lade die Seite neu, bevor du weiter sortierst.', status)
  }

  async function loadPreview(){
    setPreviewLoading(true)
    setPreviewError('')
    try{
      const resp = await get('/wiki/home-cards')
      if (!resp.ok) throw statusError(resp.status)
      const data = await resp.json()
      setPreviewCards(Array.isArray(data) ? data : [])
    }catch(err){
      setPreviewError(withStatus('Vorschau konnte nicht geladen werden ({status}). Die Auswahl links ist trotzdem gespeichert.', err?.status))
    }finally{
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    void loadSelection()
    void loadPreview()
  }, [])

  // Suche mit 250-ms-Debounce; die vorherigen Treffer bleiben während der Anfrage stehen.
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query){
      setSearchResults([])
      setSearchError('')
      setSearchBusy(false)
      setHasSearched(false)
      return undefined
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setSearchBusy(true)
      setSearchError('')
      try{
        const resp = await get('/wiki/entries?q=' + encodeURIComponent(query) + '&limit=100')
        if (!resp.ok) throw statusError(resp.status)
        const data = await resp.json()
        if (!active) return
        setSearchResults(Array.isArray(data) ? data : [])
        setHasSearched(true)
      }catch(err){
        if (!active) return
        setSearchError(withStatus('Suche fehlgeschlagen ({status}). Bitte erneut versuchen.', err?.status))
      }finally{
        if (active) setSearchBusy(false)
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  /**
   * Meldet eine gespeicherte Änderung: Stempel aktualisieren, Vorschau neu lesen, Live-Region.
   * @param {string} message - Text für die Live-Region
   * @returns {void}
   */
  function afterChange(message){
    setStatusMessage(message)
    void refreshRebuildStamp()
    void loadPreview()
  }

  /**
   * Markiert einen Beitrag und speichert die vollständige Reihenfolge.
   * @param {Object} entry - Eintrag aus der Trefferliste
   * @returns {Promise<void>}
   */
  async function addEntry(entry){
    if (items.length >= HOME_LIMIT) return
    setChangeError('')
    setOrderError('')
    let marked = false
    try{
      const markResp = await put('/wiki/entries/' + entry.entry_id, { home_featured: true })
      if (!markResp.ok) throw statusError(markResp.status)
      marked = true

      const next = renumber([...items, { ...entry, home_featured: true, home_order: null }])
      setItems(next)

      const orderResp = await put('/wiki/home-order', { order: next.map((item) => item.entry_id) })
      if (!orderResp.ok) throw statusError(orderResp.status)

      setServerItems(next)
      // Der Treffer stammt aus `GET /wiki/entries` (EntryOut) und trägt weder `category_name`
      // noch `wiki_active`; erst die Zeile aus `GET /wiki/home-selection` zeigt Kategorie und
      // das Abzeichen „Bereich nicht im Wiki" korrekt.
      await loadSelection({ silent: true })
      afterChange('Zur Startseite hinzugefügt')
    }catch(err){
      let reloaded = false
      if (marked) reloaded = await resyncFromServer()
      else setItems(serverItems)
      setChangeError(changeFailureMessage(marked, reloaded, err?.status))
    }
  }

  /**
   * Entfernt eine Markierung und speichert die verbleibende Reihenfolge dicht.
   * Die Markierung selbst bleibt bis zur Serverantwort sichtbar — kein stilles Ausblenden.
   * @param {Object} entry - Kurationszeile
   * @returns {Promise<void>}
   */
  async function removeEntry(entry){
    setChangeError('')
    setOrderError('')
    const removedIndex = items.findIndex((item) => item.entry_id === entry.entry_id)
    let unmarked = false
    try{
      const unmarkResp = await put('/wiki/entries/' + entry.entry_id, { home_featured: false, home_order: null })
      if (!unmarkResp.ok) throw statusError(unmarkResp.status)
      unmarked = true

      const rest = renumber(items.filter((item) => item.entry_id !== entry.entry_id))
      setItems(rest)

      const orderResp = await put('/wiki/home-order', { order: rest.map((item) => item.entry_id) })
      if (!orderResp.ok) throw statusError(orderResp.status)

      setServerItems(rest)
      afterChange('Von der Startseite entfernt')

      // Fokus: Handle an derselben Position, bei leerer Liste die Spaltenüberschrift.
      window.requestAnimationFrame(() => {
        if (!rest.length){
          if (headingRef.current) headingRef.current.focus()
          return
        }
        const nextIndex = Math.min(Math.max(removedIndex, 0), rest.length - 1)
        const nextHandle = handleRefs.current[rest[nextIndex].entry_id]
        if (nextHandle) nextHandle.focus()
      })
    }catch(err){
      let reloaded = false
      if (unmarked) reloaded = await resyncFromServer()
      else setItems(serverItems)
      setChangeError(changeFailureMessage(unmarked, reloaded, err?.status))
    }
  }

  /**
   * Drop (Maus oder Tastatur): sofort lokal nummerieren, dann die **vollständige** Liste senden.
   * Ein Fehler lädt den Serverstand neu (Fallback: der zuletzt bekannte Stand), damit eine
   * zwischenzeitlich geänderte Markierungsmenge den Tab nicht dauerhaft in 400 hält.
   * @param {Object} event - dnd-kit DragEndEvent
   * @returns {Promise<void>}
   */
  async function handleDragEnd(event){
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.entry_id === active.id)
    const to = items.findIndex((item) => item.entry_id === over.id)
    if (from < 0 || to < 0) return

    const next = renumber(arrayMove(items, from, to))
    setItems(next)
    setOrderError('')
    setChangeError('')

    try{
      const resp = await put('/wiki/home-order', { order: next.map((item) => item.entry_id) })
      if (!resp.ok) throw statusError(resp.status)
      setServerItems(next)
      afterChange('Reihenfolge gespeichert')
    }catch(err){
      await resyncFromServer()
      setOrderError(withStatus('Reihenfolge konnte nicht gespeichert werden ({status}). Die vorherige Reihenfolge ist wiederhergestellt.', err?.status))
    }
  }

  function titleFor(entryId){
    const found = items.find((item) => item.entry_id === entryId)
    return found?.entry_name || 'Beitrag'
  }

  function positionFor(entryId){
    const index = items.findIndex((item) => item.entry_id === entryId)
    return index < 0 ? 0 : index + 1
  }

  const announcements = {
    onDragStart({ active }){
      return `${titleFor(active.id)} aufgenommen, Position ${positionFor(active.id)} von ${items.length}.`
    },
    onDragOver({ active, over }){
      return `${titleFor(active.id)} über Position ${over ? positionFor(over.id) : positionFor(active.id)} von ${items.length}.`
    },
    onDragEnd({ active, over }){
      return `${titleFor(active.id)} auf Position ${over ? positionFor(over.id) : positionFor(active.id)} von ${items.length} abgelegt.`
    },
    onDragCancel({ active }){
      return `Verschieben abgebrochen. ${titleFor(active.id)} bleibt auf Position ${positionFor(active.id)}.`
    },
  }

  return (
    <section className="admin-panel" aria-label="Startseite kuratieren" data-testid="home-curation">
      <div className="admin-panel-header">
        <div>
          <h3>Startseite kuratieren</h3>
          <p>Wähle bis zu 12 Beiträge für die Startseite und lege die Reihenfolge per Ziehen fest. Änderungen werden sofort gespeichert.</p>
        </div>
      </div>

      {loadState === 'loading' ? <div className="admin-message">Lade Startseiten-Auswahl …</div> : null}
      {loadState === 'error' ? <div className="admin-message admin-error" role="alert">{loadError}</div> : null}

      {loadState === 'ready' ? (
        <>
          {orderError ? <div className="admin-message admin-error" role="alert">{orderError}</div> : null}
          {changeError ? <div className="admin-message admin-error" role="alert">{changeError}</div> : null}
          <div className="admin-home-status" role="status" aria-live="polite" data-testid="home-curation-status">
            {statusMessage}
          </div>

          <div className="admin-home-columns">
            <div className="admin-home-column">
              <h4 tabIndex={-1} ref={headingRef} data-testid="home-curation-heading">
                {'Auf der Startseite '}
                <span data-testid="home-curation-count">{`(${items.length} von ${HOME_LIMIT})`}</span>
              </h4>

              {items.length === 0 ? (
                <div className="admin-home-empty" data-testid="home-curation-empty">
                  <strong>Noch keine Beiträge auf der Startseite</strong>
                  <p>Füge rechts bis zu 12 Beiträge hinzu und ordne sie anschließend per Ziehen.</p>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                  accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
                >
                  <SortableContext items={items.map((item) => item.entry_id)} strategy={verticalListSortingStrategy}>
                    <ol className="admin-home-list" data-testid="home-curation-list">
                      {items.map((item, index) => (
                        <CurationItem
                          key={item.entry_id}
                          entry={item}
                          position={index + 1}
                          onRemove={removeEntry}
                          registerHandle={registerHandle}
                        />
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            <div className="admin-home-column admin-home-toolbar">
              <h4>Beiträge hinzufügen</h4>
              <label className="admin-field">
                <span>Beitrag suchen</span>
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Titel oder Kurztext"
                  data-testid="home-curation-search"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>

              {isFull ? (
                <div className="admin-message admin-home-full" data-testid="home-curation-full">
                  Die Startseite ist voll (12 von 12). Entferne eine Karte, um eine neue hinzuzufügen.
                </div>
              ) : null}

              {searchBusy ? <p className="admin-home-hint" role="status">Suche läuft …</p> : null}
              {searchError ? <div className="admin-message admin-error" role="alert">{searchError}</div> : null}

              {addableResults.length ? (
                <ul className="admin-home-results">
                  {addableResults.map((entry) => (
                    <li key={entry.entry_id} className="admin-home-result">
                      <div className="admin-home-result-meta">
                        <span className="admin-home-result-title">{entry.entry_name}</span>
                        {entry.category_name ? <span className="admin-home-category">{entry.category_name}</span> : null}
                      </div>
                      <button
                        type="button"
                        className="admin-secondary-button"
                        aria-label={(entry.entry_name || 'Beitrag') + ' zur Startseite hinzufügen'}
                        data-testid={'home-curation-add-' + entry.entry_id}
                        onClick={() => addEntry(entry)}
                        disabled={isFull}
                      >
                        Hinzufügen
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {hasSearched && !searchBusy && !searchError && !addableResults.length ? (
                <p className="admin-home-hint">Keine passenden Beiträge gefunden.</p>
              ) : null}
            </div>
          </div>

          <div className="admin-home-preview">
            <h4>Vorschau der Startseite</h4>
            <p className="admin-home-hint">Zeigt nur Beiträge, die öffentlich und aktiv sind – in der gespeicherten Reihenfolge.</p>

            {previewError ? <div className="admin-message admin-error" role="alert">{previewError}</div> : null}
            {previewLoading && !previewCards.length ? <div className="admin-message">Lade Vorschau …</div> : null}
            {!previewLoading && !previewError && !previewCards.length ? (
              <div className="admin-message">Aktuell erscheint keine Karte auf der Startseite.</div>
            ) : null}

            {previewCards.length ? (
              // Dieselben Klassen wie die Startseite (`Dashboard.jsx`, `home-row` …): die Vorschau
              // sieht damit aus wie die echte Liste und zieht jede Gestaltungsänderung dort mit.
              // Nur ohne Links (reine Ansicht) und ohne „Neu"-Badge; `<p>` statt `<h2>`, damit die
              // Admin-Gliederung nicht springt.
              <ul className="home-list-items" role="list" data-testid="home-curation-preview">
                {previewCards.map((card) => {
                  const sectionName = card.section_name ? String(card.section_name) : ''
                  const categoryName = card.category_name ? String(card.category_name) : ''
                  return (
                    <li
                      key={card.entry_id}
                      className="home-row"
                      data-testid={'home-curation-preview-card-' + card.entry_id}
                    >
                      <div className="home-row-text">
                        <p className="home-row-title">{card.entry_name}</p>
                        {sectionName || categoryName ? (
                          <p className="home-row-meta">
                            {sectionName}
                            {sectionName && categoryName ? <span aria-hidden="true">·</span> : null}
                            {categoryName}
                          </p>
                        ) : null}
                        {card.entry_short ? <p className="home-row-short">{card.entry_short}</p> : null}
                      </div>
                      <img
                        className="wiki-cover-thumb"
                        src={card.cover_url || DEFAULT_COVER_URL}
                        alt=""
                        width="200"
                        height="105"
                        loading="lazy"
                        decoding="async"
                        onError={handleCoverError}
                      />
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}

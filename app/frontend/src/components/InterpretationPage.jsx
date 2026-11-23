import React, { useState, useEffect, useCallback, useRef } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import PersonSelector from './PersonSelector'
import WikiPageShortcut from './WikiPageShortcut'
import { ADDITIONAL_QUESTION_MAX_LENGTH } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from './InterpretationHistoryDropdown'
import { deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'
import { formatDateTimeValue } from '../utils/dateTime'
import { LoadingSpinner } from './LoadingSpinner'
import { ErrorMessage } from './ErrorMessage'
import { PoweruserNoticeLink } from './PoweruserNotice'
import { usePageFrame } from '../routing/pageFrame'
import { loadWikiLinks } from '../services/wikiLinks'
import { useChartData } from '../hooks/useChartData'

/**
 * Link-Darstellung der Auswertung. Der Ruhezustand liegt vollständig in der Klasse
 * `.wiki-inline-link` (`styles.css`) — Inline-Styles könnten die `:hover`/`:focus-visible`-Regeln
 * nicht überschreiben. Nur Wiki-Ziele bekommen die Klasse und einen neuen Tab: ein normaler Link
 * wuerde die Seite neu laden und eine laufende Auswertung abbrechen. Quellenlinks aus der Antwort
 * bleiben unveraendert; `target`/`rel` stammen nie aus Daten, `href` wird unveraendert durchgereicht.
 */
const wikiLinkComponents = {
  a: ({ node, href = '', ...props }) => {
    const isWiki = href.startsWith('/wiki/')
    return (
      <a
        href={href}
        {...props}
        className={isWiki ? 'wiki-inline-link' : undefined}
        target={isWiki ? '_blank' : undefined}
        rel={isWiki ? 'noopener noreferrer' : undefined}
      />
    )
  },
}

function FollowupTextarea({ value, onChange, isPoweruser, loading, disabled: isDisabled, maxLength, placeholder, followupNumber }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)

  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setDraft(value)
    }
  }, [value])

  const handleChange = useCallback((e) => {
    const v = e.target.value.slice(0, maxLength)
    setDraft(v)
    onChange(v)
  }, [maxLength, onChange])

  const handleBlur = useCallback(() => {
    onChange(draft.slice(0, maxLength))
  }, [draft, onChange, maxLength])

  return (
    <div style={{ marginTop: 12 }}>
      <label><b>Zusatzfrage {followupNumber}</b> {isPoweruser ? <span style={{ color: '#c00' }}>*</span> : null}</label>
      <textarea
        ref={ref}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        maxLength={maxLength}
        rows={3}
        placeholder={placeholder}
        style={{ width: '100%', resize: 'vertical' }}
        disabled={isDisabled}
      />
      {!isPoweruser && (
        <div style={{ marginTop: 4, color: '#c00', fontSize: 12 }}>Zusatzfragen sind nur für zahlende Mitglieder verfügbar. <a href="https://buymeacoffee.com/shinengakic" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.</div>
      )}
      {isPoweruser && <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{draft.length}/{maxLength}</div>}
    </div>
  )
}

function formatDegreeMinute(degree, minute) {
  return `${degree}°${String(minute).padStart(2, '0')}'`
}

function formatOrb(orb) {
  return `${Number(orb).toFixed(1).replace('.', ',')}°`
}

/**
 * Eine Gruppe des Chart-Daten-DTO als bis zu drei Tabellen (Planeten, Aspekte, Häuser).
 * Rendert ausschließlich das Gelieferte: keine Ableitung, keine Sortierung, keine Filterung
 * (D-08/D-09/D-12). Eine Tabelle erscheint nur, wenn ihr Array Einträge hat; eine Gruppe ohne
 * Einträge entfällt ganz.
 */
function ChartDataGroup({ group, showLabel }) {
  const planets = Array.isArray(group?.planets) ? group.planets : []
  const aspects = Array.isArray(group?.aspects) ? group.aspects : []
  const houses = Array.isArray(group?.houses) ? group.houses : []
  if (!planets.length && !aspects.length && !houses.length) return null

  const suffix = showLabel ? <span className="app-visually-hidden"> — {group.label}</span> : null

  return (
    <div>
      {showLabel && <h5 className="chart-data-group-title">{group.label}</h5>}
      {planets.length > 0 && (
        <table className="chart-data-table">
          <caption className="chart-data-caption">Planeten{suffix}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Zeichen</th>
              <th scope="col">Grad/Min.</th>
            </tr>
          </thead>
          <tbody>
            {planets.map((planet, index) => (
              <tr key={`planet-${index}`}>
                <th scope="row">
                  {planet.name}
                  {planet.retrograde ? (
                    <>
                      <span aria-hidden="true">℞</span>
                      <span className="app-visually-hidden">rückläufig</span>
                    </>
                  ) : null}
                </th>
                <td>{planet.sign}</td>
                <td className="chart-data-cell-num">{formatDegreeMinute(planet.degree, planet.minute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {aspects.length > 0 && (
        <table className="chart-data-table">
          <caption className="chart-data-caption">Aspekte{suffix}</caption>
          <thead>
            <tr>
              <th scope="col">Beteiligte</th>
              <th scope="col">Aspekt</th>
              <th scope="col">Orbis</th>
            </tr>
          </thead>
          <tbody>
            {aspects.map((aspect, index) => (
              <tr key={`aspect-${index}`}>
                <th scope="row">{aspect.a} – {aspect.b}</th>
                <td>{aspect.aspect}</td>
                <td className="chart-data-cell-num">{formatOrb(aspect.orb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {houses.length > 0 && (
        <table className="chart-data-table">
          <caption className="chart-data-caption">Häuser{suffix}</caption>
          <thead>
            <tr>
              <th scope="col">Haus</th>
              <th scope="col">Zeichen</th>
              <th scope="col">Grad/Min.</th>
            </tr>
          </thead>
          <tbody>
            {houses.map((house, index) => (
              <tr key={`house-${index}`}>
                <th scope="row">{house.house}</th>
                <td>{house.sign}</td>
                <td className="chart-data-cell-num">{formatDegreeMinute(house.degree, house.minute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function InterpretationPage({
  title,
  wikiPageName,
  wikiOriginPage,
  wikiOriginLabel,
  historyContextType,
  interpretButtonLabel,
  interpretButtonLoadingLabel,
  chartLoadingMessage,
  chartFallbackMessage,
  children,
  onInterpret,
  onDelete,
  state,
  hidePersonSelector,
  onHistoryLoad,
  historyUserPersonsId,
  chartMarginTop,
  chartMinHeight,
  imageObjectFit,
  questionPlaceholder,
  chartChildren,
  chartTitle,
  chartHistoryYearOnly,
  interpretDisabled,
  chartType,
  chartDataPayload,
}) {
  // Hooks stehen unbedingt vor dem Guard: der Guard existiert genau deshalb, weil `state` für
  // possible-null gehalten wird. Stünde er davor, wechselte die Hook-Anzahl beim Übergang
  // falsy → truthy („Rendered more hooks than during the previous render").
  const setActions = usePageFrame()?.setActions

  // Begriffsliste fuer die Anzeige-Verlinkung: einmal pro Mount, nie blockierend.
  // Der leere Startwert laesst `MarkdownRenderer` genau wie bisher rendern, bis die Liste da ist.
  const [wikiLinks, setWikiLinks] = useState([])

  useEffect(() => {
    let active = true
    loadWikiLinks().then((links) => { if (active) setWikiLinks(links) })
    return () => { active = false }
  }, [])

  // Der Wiki-Kurzsprung wandert in den Aktions-Slot des Titelbereichs. Die Abhängigkeiten
  // sind ausschließlich die primitiven Prop-Werte plus der Setter — nie das Kontextobjekt, sonst
  // löste jede Provider-Runde einen neuen Effekt aus.
  useEffect(() => {
    if (!setActions) return undefined
    setActions(
      <WikiPageShortcut pageName={wikiPageName} originPage={wikiOriginPage} originLabel={wikiOriginLabel} />
    )
    return () => setActions(null)
  }, [setActions, wikiPageName, wikiOriginPage, wikiOriginLabel])

  // Chart-Daten-Kästchen (CHART-01). Der Hook steht wie alle anderen **vor** dem Guard:
  // `state` ist possible-null, ein Hook nach dem Guard wechselte die Hook-Anzahl.
  const {
    open: chartDataOpen,
    toggle: toggleChartData,
    close: closeChartData,
    data: chartData,
    loading: chartDataLoading,
    error: chartDataError,
    retry: retryChartData,
  } = useChartData({ chartType, payload: chartDataPayload })

  const chartToggleRef = useRef(null)
  const chartPanelRef = useRef(null)
  const chartCloseRef = useRef(null)

  // Escape schließt nur bei offenem Kasten. Der Fokus geht nur dann zurück auf den Toggle,
  // wenn er im Kasten war — lag er außerhalb, bleibt er unverändert (UI-SPEC § Zustands- und
  // Tastenverhalten).
  useEffect(() => {
    if (!chartDataOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      const focusWasInPanel = Boolean(chartPanelRef.current?.contains(document.activeElement))
      closeChartData()
      if (focusWasInPanel) chartToggleRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [chartDataOpen, closeChartData])

  if (!state) return null

  const {
    resp, setResp,
    year, setYear, month, setMonth, day, setDay,
    hour, setHour, minute, setMinute, second, setSecond,
    latitude, setLatitude, longitude, setLongitude,
    timezone, setTimezone, datetimeLocal, setDatetimeLocal,
    cachedSummary, setCachedSummary,
    showSummary, setShowSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow,
    profile,
    selectedPerson,
    startStream, isStreaming,
    loading,
    chartImage, imageLoading, imageError,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
    maxFollowupsReached,
    summaryRef,
    summaryError, summaryText,
  } = state

  const handleDelete = async () => {
    if (!window.confirm('Auswertung wirklich löschen?')) return
    const ok = await deleteInterpretation(activeInterpretationId)
    if (ok) {
      setActiveInterpretationId(null)
      setCachedSummary('')
      setShowSummary(false)
      setFollowups([])
      setCurrentFollowup('')
      setDropdownRefreshToken(t => t + 1)
    }
  }

  const defaultHistoryLoad = (interp) => {
    setActiveInterpretationId(interp.id)
    const allMsgs = [...(interp.messages || [])].sort((a, b) => a.position - b.position)
    let content = ''
    let followupNum = 0
    let pendingQuestion = null
    for (const msg of allMsgs) {
      if (msg.role === 'assistant') {
        if (!content) {
          content = msg.content
        } else {
          const prefix = pendingQuestion
            ? `\n\n---\n\n**Zusatzfrage ${followupNum}:** ${pendingQuestion}\n\n`
            : '\n\n---\n\n'
          content += prefix + msg.content
          pendingQuestion = null
        }
      } else if (msg.role === 'user' && msg.position > 1) {
        followupNum++
        pendingQuestion = msg.content
      }
    }
    if (content) { setCachedSummary(content); setShowSummary(true) }
    const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
    if (firstUserMsg?.content) setAdditionalQuestion(firstUserMsg.content)
    const followupMsgs = (interp.messages || [])
      .filter(m => m.role === 'user' && m.position > 1)
      .sort((a, b) => a.position - b.position)
    setFollowups(followupMsgs.map(m => ({ question: m.content })))
    setCurrentFollowup('')
  }

  // Das Bild ist ein einziges Element: mit `chartType` und Payload sitzt es im Toggle-Button,
  // ohne eines der beiden Props steht es nackt im Block (kein funktionsloser Button, S11).
  const chartDataEnabled = Boolean(chartType && chartDataPayload)
  const chartDataGroups = Array.isArray(chartData?.groups) ? chartData.groups : []
  const chartDataEmpty = Boolean(chartData) && chartDataGroups.every(
    (group) => !(group?.planets?.length || group?.aspects?.length || group?.houses?.length)
  )
  const chartImageNode = (
    <img
      src={chartImage}
      alt={`${title} Diagramm`}
      className="chart-data-image"
      style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: imageObjectFit ?? 'contain' }}
    />
  )

  return (
    <div>
      {!hidePersonSelector && <PersonSelector helperText="Lade eine gespeicherte Person in das Formular" />}
      {children}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
          <div style={{ marginTop: 8, marginBottom: 8, display: 'none' }}>
            <label>Datum & Uhrzeit</label>
            <Flatpickr
              value={datetimeLocal}
              options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
              onChange={(dates) => {
                const date = dates && dates[0]
                if (!date) return
                const y = date.getFullYear(); const m = date.getMonth() + 1; const d = date.getDate()
                const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
                setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
                setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
              }}
            />
          </div>
          {state.showAdvanced && (
            <>
              <label>Timezone</label>
              <input className="tz-input" value={timezone} onChange={e => setTimezone(e.target.value)} />
              <label>Latitude</label>
              <input value={latitude} onChange={e => setLatitude(e.target.value)} />
              <label>Longitude</label>
              <input value={longitude} onChange={e => setLongitude(e.target.value)} />
            </>
          )}
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType={historyContextType}
              userPersonsId={historyUserPersonsId ?? selectedPerson?.id ?? null}
              refreshToken={activeInterpretationId || dropdownRefreshToken}
              selectedInterpretationId={activeInterpretationId}
              yearOnly={chartHistoryYearOnly}
              onClear={() => {
                setActiveInterpretationId(null)
                setCachedSummary('')
                setShowSummary(false)
                setAdditionalQuestion('')
                setFollowups([])
                setCurrentFollowup('')
              }}
              onLoad={onHistoryLoad || defaultHistoryLoad}
            />
          )}
          <label><b>Optionale Zusatzfrage</b></label>
          <textarea
            value={additionalQuestion}
            onChange={(event) => setAdditionalQuestion(event.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH))}
            maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
            rows={3}
            placeholder={questionPlaceholder || "Optional: Worauf soll die KI bei der Auswertung besonders eingehen?"}
            style={{ width: '100%', resize: 'vertical', background: activeInterpretationId ? '#f5f5f5' : undefined }}
            disabled={!!activeInterpretationId}
          />
          {!activeInterpretationId && (
            <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{additionalQuestion.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>
          )}
          {(showSummary && (cachedSummary || resp || loading)) ? (
            <div style={{ marginTop: 12, background: '#f7f7f7', padding: 16, width: '94%', maxHeight: 420, borderRadius: 10, border: '1px solid #dde1e7', color: '#203244', overflowY: 'auto', overflowX: 'auto' }}>
              {summaryError ? (
                <ErrorMessage message={summaryError} />
              ) : null}
              <div ref={summaryRef}>
                <MarkdownRenderer wikiLinks={wikiLinks} components={wikiLinkComponents}>{summaryText || (loading ? 'Analyse wird erstellt ...' : '')}</MarkdownRenderer>
              </div>
            </div>
          ) : null}
          {cachedSummary && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <button
                onClick={() => {
                  const subject = selectedPerson || profile
                  const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                  printInterpretationAsPdf(title, summaryRef.current, {
                    personName: selectedPerson?.name || profile?.username || 'Eigenes Profil',
                    birthDate,
                    birthCity: subject?.birth_city || '',
                    birthRegionCode: subject?.birth_region || '',
                    birthCountryCode: subject?.birth_country || '',
                    additionalQuestion,
                    imageUrl: chartImage,
                  })
                }}
                title="Druckversion erzeugen"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                <img src="/x-pdf-32.png" alt="PDF herunterladen" style={{ width: 28, height: 28, verticalAlign: 'middle' }} />
              </button>
            </div>
          )}
          {followups.map((fu, idx) => (
            <div key={idx} style={{ marginTop: 12 }}>
              <label><b>Zusatzfrage {idx + 1}</b></label>
              <textarea
                value={fu.question}
                rows={3}
                style={{ width: '100%', resize: 'vertical', background: '#f5f5f5' }}
                disabled
              />
            </div>
          ))}
          {!profile?.is_poweruser && activeInterpretationId && followups.length >= 1 && <PoweruserNoticeLink />}
          {activeInterpretationId && (
            <FollowupTextarea
              value={currentFollowup}
              onChange={setCurrentFollowup}
              isPoweruser={profile?.is_poweruser}
              loading={loading}
              disabled={!profile?.is_poweruser || loading || followups.length >= 10}
              maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
              placeholder="Ihre Frage zur Vertiefung der Auswertung"
              followupNumber={followups.length + 1}
            />
          )}
          {profile?.is_poweruser && activeInterpretationId && followups.length >= 10 && (
            <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Maximale Anzahl von 10 Zusatzfragen erreicht.</div>
          )}
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              onClick={onInterpret}
              disabled={loading || interpretDisabled || (activeInterpretationId ? (!profile?.is_poweruser || !currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? <LoadingSpinner /> : (activeInterpretationId ? 'Auswertung vertiefen' : interpretButtonLabel)}
            </button>
            {activeInterpretationId && (
              <button
                onClick={onDelete || handleDelete}
                disabled={loading}
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', color: '#b42318', cursor: 'pointer' }}
              >
                Auswertung löschen
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 240, maxWidth: 750 }}>
          <div style={{ border: '1px solid #dde1e7', marginTop: (isNarrow ? 0 : (chartMarginTop ?? -70)), borderRadius: 12, padding: 12, minHeight: chartMinHeight ?? 320, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>{chartTitle || `${title} Diagramm`}</h3>
            {imageLoading && <LoadingSpinner message={chartLoadingMessage} />}
            {imageError && <ErrorMessage message={imageError} />}
            {chartImage && !imageLoading && (
              <div style={{ position: 'relative' }}>
                <div className="chart-data-stage">
                  {chartDataEnabled ? (
                    <button
                      type="button"
                      className="chart-data-toggle"
                      aria-label={chartDataOpen ? 'Chart-Daten ausblenden' : 'Chart-Daten anzeigen'}
                      aria-expanded={chartDataOpen}
                      aria-controls="chart-data-panel"
                      ref={chartToggleRef}
                      onClick={toggleChartData}
                    >
                      {chartImageNode}
                      <span className="chart-data-chip">ℹ Chart-Daten</span>
                    </button>
                  ) : chartImageNode}
                  {chartChildren}
                </div>
                {chartDataEnabled && chartDataOpen && (
                  <div className="chart-data-panel" id="chart-data-panel" ref={chartPanelRef} role="region" aria-label="Chart-Daten">
                    <div className="chart-data-head">
                      <h4 className="chart-data-title">Chart-Daten</h4>
                      <button
                        type="button"
                        className="chart-data-close"
                        aria-label="Chart-Daten schließen"
                        ref={chartCloseRef}
                        onClick={() => {
                          closeChartData()
                          chartToggleRef.current?.focus()
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {chartDataLoading && <LoadingSpinner message="Chart-Daten werden geladen" />}
                    {chartDataError && <p className="chart-data-error" role="status">Chart-Daten konnten nicht geladen werden.</p>}
                    {chartDataError && (
                      <button
                        type="button"
                        className="chart-data-retry"
                        onClick={() => {
                          retryChartData()
                          // Der Button fällt sofort aus dem DOM; ohne diesen Sprung landete
                          // der Fokus auf `body`.
                          chartCloseRef.current?.focus()
                        }}
                      >
                        Erneut laden
                      </button>
                    )}
                    {chartDataEmpty && (
                      <>
                        <p className="chart-data-empty">Keine Chart-Daten verfügbar.</p>
                        <p className="chart-data-empty">Für dieses Chart liegen keine Positionen oder Aspekte vor.</p>
                      </>
                    )}
                    {chartDataGroups.map((group, index) => (
                      <ChartDataGroup key={`group-${index}`} group={group} showLabel={chartDataGroups.length > 1} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>{chartFallbackMessage}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}



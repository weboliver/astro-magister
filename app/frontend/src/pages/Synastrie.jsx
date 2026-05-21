/**
 * Synastrie - Partner comparison page for synastry chart interpretation
 * with two-person selection, comparison mode toggle, and AI analysis.
 * @component
 * @returns {JSX.Element} Rendered synastrie page
 * @hook useState - Manages response, advanced toggle, summary state, comparison mode, same-person guard
 * @hook useEffect - Handles responsive layout, auto-fetches chart, manages selections, clears state on toggle
 * @hook useCallback - Handles logout cleanup, interpretation submission
 * @hook useMemo - Computes dual-person payload for API requests
 * @hook useRef - Tracks summary ref, streamed summary, selection init guard, profile change tracking
 *
 * Shared hooks: useInterpretationStream (SSE), useChartCache (chart graphic), useFollowupManager (followups)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { useAuth } from '../contexts/AuthContext'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import PersonSelector from '../components/PersonSelector'
import SynastrieControls from '../components/SynastrieControls'
import WikiPageShortcut from '../components/WikiPageShortcut'
import { useSynastrySelection } from '../contexts/SynastrySelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'
import { ADDITIONAL_QUESTION_MAX_LENGTH, normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from '../components/InterpretationHistoryDropdown'
import { deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'
import { formatDateTimeValue } from '../utils/dateTime'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { ErrorMessage } from '../components/ErrorMessage'
import { PoweruserNoticeLink } from '../components/PoweruserNotice'
import { useInterpretationStream } from '../hooks/useInterpretationStream'
import { useChartCache } from '../hooks/useChartCache'
import { useFollowupManager } from '../hooks/useFollowupManager'

export default function Synastrie(){
  // ---------------------------------------------------------------------------
  // Page-specific state
  // ---------------------------------------------------------------------------
  const [resp, setResp] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth()+1)
  const [day, setDay] = useState(new Date().getDate())
  const [hour, setHour] = useState(12)
  const [minute, setMinute] = useState(0)
  const [second, setSecond] = useState(0)
  const [latitude, setLatitude] = useState(52.52)
  const [longitude, setLongitude] = useState(13.4050)
  const [timezone, setTimezone] = useState(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  const [datetimeLocal, setDatetimeLocal] = useState('')
  const [cachedSummary, setCachedSummary] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [additionalQuestion, setAdditionalQuestion] = useState('')
  const [activeInterpretationId, setActiveInterpretationId] = useState(null)
  const [dropdownRefreshToken, setDropdownRefreshToken] = useState(0)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 800 : false)
  const [historyLoadingClearToken, setHistoryLoadingClearToken] = useState(0)
  const [comparisonMode, setComparisonMode] = useState("hh")
  const [samePersonWarning, setSamePersonWarning] = useState(false)

  // ---------------------------------------------------------------------------
  // Context hooks
  // ---------------------------------------------------------------------------
  const { profile, initialized: authInitialized } = useAuth()
  const prevProfileIdRef = useRef(profile?.id)
  const selectionA = useSynastrySelection('A')
  const selectionB = useSynastrySelection('B')
  const selectedPersonA = selectionA.selectedPerson
  const selectedPersonB = selectionB.selectedPerson

  // ---------------------------------------------------------------------------
  // Shared hooks: SSE streaming, chart cache, followup management
  // ---------------------------------------------------------------------------
  const { startStream, isStreaming } = useInterpretationStream()

  const {
    chartImage, setChartImage, imageLoading, imageError, setImageError,
    displayChartBlob,
    computeGraphicSize,
    computeCacheKey,
    chartCacheRef,
    graphicAbortRef,
    activeChartCacheKeyRef,
    imageUrlRef,
    handleLogoutCleanup: chartLogoutCleanup,
    fetchGraphic,
  } = useChartCache({ graphicEndpointPath: '/synastry/graphic', cacheKeyPrefix: 'synastry' })

  const {
    followups, setFollowups,
    currentFollowup, setCurrentFollowup,
    isFollowupLoading,
    submitFollowup,
    maxFollowupsReached,
  } = useFollowupManager()

  // Derived loading: true while SSE stream or followup request is active
  const loading = isStreaming || isFollowupLoading

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const streamedSummaryRef = useRef('')
  const summaryRef = useRef(null)
  const isLoadingHistoryRef = useRef(false)
  const hasInitializedSelectionResetRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Current payload (dual-person format matching SynastryRequest)
  // ---------------------------------------------------------------------------
  const currentPayload = useMemo(() => {
    const a = selectedPersonA || profile || {}
    const b = selectedPersonB || profile || {}
    return {
      person_a_id: selectedPersonA?.id ?? null,
      person_a_year: a.birth_year ?? 0, person_a_month: a.birth_month ?? 1, person_a_day: a.birth_day ?? 1,
      person_a_hour: a.birth_hour ?? 12, person_a_minute: a.birth_minute ?? 0, person_a_second: a.birth_second ?? 0,
      person_a_timezone: a.birth_timezone ?? null,
      person_a_latitude: a.birth_latitude ?? 0, person_a_longitude: a.birth_longitude ?? 0,
      person_b_id: selectedPersonB?.id ?? null,
      person_b_year: b.birth_year ?? 0, person_b_month: b.birth_month ?? 1, person_b_day: b.birth_day ?? 1,
      person_b_hour: b.birth_hour ?? 12, person_b_minute: b.birth_minute ?? 0, person_b_second: b.birth_second ?? 0,
      person_b_timezone: b.birth_timezone ?? null,
      person_b_latitude: b.birth_latitude ?? 0, person_b_longitude: b.birth_longitude ?? 0,
      comparison_mode: comparisonMode,
    }
  }, [selectedPersonA, selectedPersonB, comparisonMode])

  const hasBothPersons = !!(selectedPersonA || profile?.birth_year) && !!(selectedPersonB || profile?.birth_year)

  // ---------------------------------------------------------------------------
  // Same-person guard
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (selectedPersonA?.id && selectedPersonB?.id && selectedPersonA.id === selectedPersonB.id) {
      setSamePersonWarning(true)
    } else {
      setSamePersonWarning(false)
    }
  }, [selectedPersonA?.id, selectedPersonB?.id])

  // ---------------------------------------------------------------------------
  // Responsive layout effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setIsNarrow(window.innerWidth < 800)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // ---------------------------------------------------------------------------
  // Populate form from selected person A (for hidden Flatpickr / advanced fields)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const data = selectedPersonA || profile
    if (!data) return
    if (data && data.birth_latitude !== undefined && data.birth_latitude !== null) setLatitude(data.birth_latitude)
    if (data && data.birth_longitude !== undefined && data.birth_longitude !== null) setLongitude(data.birth_longitude)
    if (data && data.birth_year){
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
      setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
    }
    if (data && data.birth_timezone){
      setTimezone(data.birth_timezone)
    }
    if (!isLoadingHistoryRef.current) {
      setActiveInterpretationId(null)
      setCachedSummary('')
      setShowSummary(false)
      setAdditionalQuestion('')
      setFollowups([])
      setCurrentFollowup('')
    }
  }, [profile, selectedPersonA])

  // ---------------------------------------------------------------------------
  // Unmount cleanup: revoke active blob URL
  // ---------------------------------------------------------------------------
  useEffect(() => () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Initial mount: clear summary state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  // ---------------------------------------------------------------------------
  // Logout cleanup: combine chart cleanup + page state reset
  // ---------------------------------------------------------------------------
  const combinedLogoutCleanup = useCallback(() => {
    chartLogoutCleanup()
    setResp(null)
    setCachedSummary('')
  }, [chartLogoutCleanup])
  useLogoutCleanup(combinedLogoutCleanup)

  useEffect(() => {
    if (prevProfileIdRef.current && !profile?.id) {
      combinedLogoutCleanup()
    }
    prevProfileIdRef.current = profile?.id
  }, [profile?.id, combinedLogoutCleanup])

  // ---------------------------------------------------------------------------
  // Selection change: clear previous chart and interpretation state
  // (MUST run before auto-fetch so it clears stale state first)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasInitializedSelectionResetRef.current) {
      hasInitializedSelectionResetRef.current = true
      return
    }
    const previousUrl = imageUrlRef.current
    imageUrlRef.current = null
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
    setChartImage(null)
    activeChartCacheKeyRef.current = null
    setImageError('')
    if (!isLoadingHistoryRef.current) setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
    try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch(_) {}
  }, [selectedPersonA?.id, selectedPersonB?.id, comparisonMode, profile?.id])

  // ---------------------------------------------------------------------------
  // Auto-fetch chart graphic when both persons selected
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedPersonA && !authInitialized) {
      console.debug('[Synastrie] autoFetch waiting for auth initialization')
      return
    }

    // Need both person data sources ready (own profile or saved person)
    if (!selectedPersonA && !authInitialized) {
      return
    }

    // Need at least Profile A (own profile) to be loaded
    if (!selectedPersonA && !profile?.birth_year) {
      return
    }

    const idsPayload = {
      person_a_id: selectedPersonA?.id ?? null,
      person_b_id: selectedPersonB?.id ?? null,
      comparison_mode: comparisonMode,
    }

    const size = computeGraphicSize()
    const key = computeCacheKey(idsPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      setImageError('')
      displayChartBlob(cached.blob)
      activeChartCacheKeyRef.current = key
    } else {
      setChartImage(null)
      fetchGraphic(idsPayload)
    }
  }, [authInitialized, selectedPersonA, selectedPersonB, comparisonMode, computeCacheKey, computeGraphicSize, displayChartBlob, fetchGraphic, setImageError, setChartImage, chartCacheRef, activeChartCacheKeyRef])

  // ---------------------------------------------------------------------------
  // Comparison mode change: reset interpretation state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isLoadingHistoryRef.current) setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [comparisonMode])

  // ---------------------------------------------------------------------------
  // Clear history-loading guard flag inside React's effect queue, AFTER the
  // selection-change and comparison-mode effects above have already run
  // with the flag still set.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (historyLoadingClearToken > 0) {
      isLoadingHistoryRef.current = false
    }
  }, [historyLoadingClearToken])

  // ---------------------------------------------------------------------------
  // Main handler: new interpretation or followup question
  // ---------------------------------------------------------------------------
  const handleInterpret = useCallback(async () => {
    const idsPayload = {
      person_a_id: selectedPersonA?.id ?? null,
      person_b_id: selectedPersonB?.id ?? null,
      comparison_mode: comparisonMode,
    }

    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(idsPayload, reqSize)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!chartImage && activeChartCacheKeyRef.current === cacheKey
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)

    // ── Followup path ──────────────────────────────────────────────────────
    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || maxFollowupsReached) return

      setShowSummary(true)
      streamedSummaryRef.current = ''

      try {
        await submitFollowup(activeInterpretationId, normalizedFollowup, cachedSummary, {
          onDelta: (fullContent) => {
            setCachedSummary(fullContent)
          },
          onDone: (_answerText) => {
            // The last onDelta already set the full display text
          },
          onError: (err) => {
            setResp({ ok: false, error: err.message })
          },
        })
      } catch (_) {
        // errors handled by onError callback
      }
      return
    }

    // ── New interpretation path ─────────────────────────────────────────────

    // Guard: same-person selection
    if (samePersonWarning) return

    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)
    streamedSummaryRef.current = ''

    const payload = normalizedAdditionalQuestion
      ? { ...idsPayload, additional_question: normalizedAdditionalQuestion }
      : idsPayload

    // If no cached graphic and no current graphic displayed, clear the image area
    if (!cachedGraphic && !hasCurrentGraphic) {
      const previousUrl = imageUrlRef.current
      setChartImage(null)
      imageUrlRef.current = null
      activeChartCacheKeyRef.current = null
      try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch (_) {}
    }

    // Start SSE interpretation stream
    await startStream('/synastry/stream', payload, {
      onMeta: (metaData) => {
        setResp({ ok: true, status: 200, data: { ...metaData, summary: streamedSummaryRef.current } })
      },
      onSummaryDelta: (content) => {
        streamedSummaryRef.current += content
        setCachedSummary(streamedSummaryRef.current)
        setResp(prev => {
          const baseData = prev?.data || {}
          return { ok: true, status: 200, data: { ...baseData, summary: streamedSummaryRef.current } }
        })
      },
      onDone: (fullSummary) => {
        const final = fullSummary || streamedSummaryRef.current
        streamedSummaryRef.current = final
        setCachedSummary(final)
        setResp(prev => {
          const baseData = prev?.data || {}
          return { ok: true, status: 200, data: { ...baseData, summary: final } }
        })
      },
      onSaved: (interpretationId) => {
        setActiveInterpretationId(interpretationId)
      },
      onError: (err) => {
        setResp({ ok: false, error: err.message })
      },
    })

    // After stream: ensure graphic is loaded
    const postCached = chartCacheRef.current.get(cacheKey)
    if (postCached) {
      if (!hasCurrentGraphic) {
        displayChartBlob(postCached.blob)
      }
      activeChartCacheKeyRef.current = cacheKey
    } else if (hasCurrentGraphic) {
      activeChartCacheKeyRef.current = cacheKey
    } else {
      await fetchGraphic(idsPayload)
    }
  }, [
    selectedPersonA, selectedPersonB, comparisonMode, computeGraphicSize, computeCacheKey, chartImage,
    activeChartCacheKeyRef, additionalQuestion, activeInterpretationId,
    currentFollowup, maxFollowupsReached, cachedSummary, samePersonWarning,
    submitFollowup, startStream, chartCacheRef, imageUrlRef,
    displayChartBlob, fetchGraphic, setChartImage, setImageError,
  ])

  // ---------------------------------------------------------------------------
  // Derived values for JSX rendering
  // ---------------------------------------------------------------------------
  const baseSummary = resp && (resp.data && (resp.data.summary || resp.data.summary_html))
    ? (resp.data.summary || resp.data.summary_html)
    : 'Kein Summary vorhanden'
  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError ? '' : (loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  // ---------------------------------------------------------------------------
  // JSX render
  // ---------------------------------------------------------------------------
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Synastrie</h3>
        <WikiPageShortcut pageName="Synastrie" originPage="synastrie" originLabel="Synastrie" />
      </div>
      <PersonSelector label="Person A" helperText="Erste Person für den Vergleich wählen" index="A" labelColor="#1a56db" />
      <PersonSelector label="Person B" helperText="Zweite Person für den Vergleich wählen" index="B" labelColor="#9b1b30" excludeUserPersonId={profile?.id} hideOwnProfile />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
          <SynastrieControls
            comparisonMode={comparisonMode}
            onComparisonModeChange={setComparisonMode}
            isStreaming={isStreaming}
            personASelected={!!selectedPersonA}
            personBSelected={!!selectedPersonB}
            samePerson={samePersonWarning}
          />
          <div style={{ marginTop: 8, marginBottom: 8 , display: 'none' }}>
          <label>Datum & Uhrzeit</label>
          <Flatpickr
            value={datetimeLocal}
            options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
            onChange={(dates) => {
              const date = dates && dates[0]
              if (!date) return
              const y = date.getFullYear(); const m = date.getMonth()+1; const d = date.getDate()
              const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
              setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
              setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
            }}
          />
          </div>
          {showAdvanced && (
            <>
              <label>Timezone</label>
              <input className="tz-input" value={timezone} onChange={e=>setTimezone(e.target.value)} />
              <label>Latitude</label>
              <input value={latitude} onChange={e=>setLatitude(e.target.value)} />
              <label>Longitude</label>
              <input value={longitude} onChange={e=>setLongitude(e.target.value)} />
            </>
          )}
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType="synastry"
              userPersonsId={selectedPersonA?.id ?? null}
              refreshToken={activeInterpretationId || dropdownRefreshToken}
              selectedInterpretationId={activeInterpretationId}
              onClear={() => {
                setActiveInterpretationId(null)
                setCachedSummary('')
                setShowSummary(false)
                setAdditionalQuestion('')
                setFollowups([])
                setCurrentFollowup('')
              }}
              onLoad={async (interp) => {
                isLoadingHistoryRef.current = true
                setActiveInterpretationId(interp.id)
                // Restore Person A
                if (interp.user_persons_id) {
                  selectionA.selectPersonId(interp.user_persons_id)
                } else {
                  selectionA.selectPersonId(null)
                }
                // Restore Person A date/time/location from interpretation
                if (interp.interp_year) setYear(interp.interp_year)
                if (interp.interp_month) setMonth(interp.interp_month)
                if (interp.interp_day) setDay(interp.interp_day)
                if (interp.interp_hour != null) setHour(interp.interp_hour)
                if (interp.interp_minute != null) setMinute(interp.interp_minute)
                if (interp.location_latitude != null) setLatitude(interp.location_latitude)
                if (interp.location_longitude != null) setLongitude(interp.location_longitude)
                // Restore comparison mode
                setComparisonMode(interp.comparison_mode || 'hh')
                // Restore Person B from user_person_id_2 (single-record synastry)
                if (interp.user_person_id_2) {
                  selectionB.selectPersonId(interp.user_person_id_2)
                } else {
                  selectionB.selectPersonId(null)
                }
                // Restore text content
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
                if (content) {
                  setCachedSummary(content)
                  // Defer showSummary: allow comparisonMode + selection-change
                  // effects to settle before revealing the loaded summary.
                  setTimeout(() => setShowSummary(true), 0)
                }
                // Defer clearing the ref until React processes all state updates
                setHistoryLoadingClearToken(t => t + 1)
                const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
                if (firstUserMsg?.content) setAdditionalQuestion(firstUserMsg.content)
                const followupMsgs = (interp.messages || [])
                  .filter(m => m.role === 'user' && m.position > 1)
                  .sort((a, b) => a.position - b.position)
                setFollowups(followupMsgs.map(m => ({ question: m.content })))
                setCurrentFollowup('')
              }}
            />
          )}
          <label><b>Optionale Zusatzfrage</b></label>
          <textarea
            value={additionalQuestion}
            onChange={(event) => setAdditionalQuestion(event.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH))}
            maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
            rows={3}
            placeholder="Optional: Worauf soll die KI bei der Auswertung besonders eingehen?"
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
                <MarkdownRenderer>{summaryText || (loading ? 'Analyse wird erstellt ...' : '')}</MarkdownRenderer>
              </div>
            </div>
          ) : null}
          {cachedSummary && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <button
                onClick={() => {
                  const subject = selectedPersonA || profile
                  const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                  printInterpretationAsPdf('Synastrie', summaryRef.current, { personName: selectedPersonA?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: chartImage })
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
            <div style={{ marginTop: 12 }}>
              <label><b>Zusatzfrage {followups.length + 1}</b> {profile?.is_poweruser ? <span style={{ color: '#c00' }}>*</span> : null}</label>
              <textarea
                value={currentFollowup}
                onChange={profile?.is_poweruser ? (e) => setCurrentFollowup(e.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH)) : undefined}
                maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
                rows={3}
                placeholder="Ihre Frage zur Vertiefung der Auswertung"
                style={{ width: '100%', resize: 'vertical' }}
                disabled={!profile?.is_poweruser || loading || (activeInterpretationId ? followups.length >= 10 : false)}
              />
              {!profile?.is_poweruser && (
                <div style={{ marginTop: 4, color: '#c00', fontSize: 12 }}>Zusatzfragen sind nur für zahlende Mitglieder verfügbar. <a href="https://buymeacoffee.com/shinengakic" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.</div>
              )}
              {profile?.is_poweruser && <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{currentFollowup.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>}
            </div>
          )}
          {profile?.is_poweruser && activeInterpretationId && followups.length >= 10 && (
            <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Maximale Anzahl von 10 Zusatzfragen erreicht.</div>
          )}
          <div style={{marginTop:8, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <button
              onClick={handleInterpret}
              disabled={loading || samePersonWarning || (activeInterpretationId ? (!profile?.is_poweruser || !currentFollowup.trim() || followups.length >= 10) : !hasBothPersons)}
            >
              {loading ? <LoadingSpinner /> : (activeInterpretationId ? 'Auswertung vertiefen' : 'Synastrie interpretieren')}
            </button>
            {activeInterpretationId && (
              <button
                onClick={async () => {
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
                }}
                disabled={loading}
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', color: '#b42318', cursor: 'pointer' }}
              >
                Auswertung löschen
              </button>
            )}
          </div>

        </div>
        <div style={{ flex: '1 1 360px', minWidth: 240, maxWidth: 750 }}>
          <div style={{ border: '1px solid #dde1e7', marginTop: (isNarrow ? 0 : -170), borderRadius: 12, padding: 12, minHeight: 320, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Synastrie Diagramm</h4>
            {imageLoading && <LoadingSpinner message="Synastrie wird gerendert…" />}
            {imageError && <ErrorMessage message={imageError} />}
            {chartImage && !imageLoading && (
              <img src={chartImage} alt="Synastrie Diagramm" style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: 'contain' }} />
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>Wähle zwei Personen aus, um das Vergleichs-Diagramm anzuzeigen und eine Partneranalyse zu erhalten.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

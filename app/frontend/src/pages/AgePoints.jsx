import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import InterpretationPage from '../components/InterpretationPage'
import { useInterpretationPage } from '../hooks/useInterpretationPage'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { post, postWithSignal } from '../services/api'
import { streamInterpret } from '../hooks/useInterpretationStream'
import { streamFollowup } from '../hooks/useInterpretations'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { ErrorMessage } from '../components/ErrorMessage'

const sharedAgePointsTransitCache = new Map()
const AP_MARKER_ROTATION_OFFSET = -130

export default function AgePoints() {
  const hookState = useInterpretationPage({
    graphicEndpoint: '/age-points/graphic',
    cacheKeyPrefix: 'age-points',
  })

  const [localLoading, setLocalLoading] = useState(false)
  const [chartImage, setChartImage] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [agePointOptions, setAgePointOptions] = useState([])
  const [selectedAgePointIndex, setSelectedAgePointIndex] = useState(0)
  const [agePointsLoading, setAgePointsLoading] = useState(false)
  const [agePointsError, setAgePointsError] = useState('')
  const [userSelectedAgePoint, setUserSelectedAgePoint] = useState(false)
  const [agePointLabel, setAgePointLabel] = useState('')
  const [apMarker, setApMarker] = useState(null)
  const [showComputeSummary, setShowComputeSummary] = useState(false)

  const followupBaseRef = useRef('')
  const localSummaryRef = useRef(null)
  const imageUrlRef = useRef(null)
  const chartCacheRef = useRef(sharedAgePointsTransitCache)
  const graphicAbortRef = useRef(null)

  const { selectedPersonId } = usePersonSelection()

  const {
    profile, selectedPerson,
    year, setYear, month, setMonth, day, setDay,
    hour, setHour, minute, setMinute, second, setSecond,
    timezone, setTimezone, latitude, setLatitude, longitude, setLongitude,
    datetimeLocal, setDatetimeLocal,
    resp, setResp,
    cachedSummary, setCachedSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
  } = hookState

  const activeSubject = useMemo(() => {
    if (selectedPersonId !== null) return selectedPerson || null
    return profile || null
  }, [selectedPersonId, selectedPerson, profile])

  const formatAgePointLabel = useCallback((point) => {
    if (!point) return ''
    const label = point.lab ? ` – ${point.lab}` : ''
    return `${point.day}.${point.mon}.${point.year}${label}`
  }, [])

  const computeDefaultAgePointIndex = useCallback((options) => {
    if (!Array.isArray(options) || options.length === 0) return 0
    const now = new Date()
    const targetIndex = options.findIndex(point => {
      const pointYear = Number(point.year)
      const pointMonth = Number(point.mon)
      const pointDay = Number(point.day)
      if (!Number.isFinite(pointYear) || !Number.isFinite(pointMonth) || !Number.isFinite(pointDay)) return false
      return new Date(pointYear, pointMonth - 1, pointDay) > now
    })
    return targetIndex !== -1 ? targetIndex : 0
  }, [])

  const displayChartBlob = useCallback((blob) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
  }, [])

  const computeGraphicSize = useCallback(() => {
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    return Math.min(1200, Math.round(750 * Math.max(1, ratio)))
  }, [])

  const agePointsRequestPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: parseInt(day, 10),
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
    timezone: timezone || null,
    latitude: Number.isFinite(parseFloat(latitude)) ? parseFloat(latitude) : 0,
    longitude: Number.isFinite(parseFloat(longitude)) ? parseFloat(longitude) : 0,
  }), [selectedPerson?.id, year, month, day, hour, minute, second, timezone, latitude, longitude])

  const selectedAgePoint = agePointOptions[selectedAgePointIndex] || null

  const buildTransitPayloadForAgePoint = useCallback(() => {
    if (!selectedAgePoint) return null
    const toNumber = (value, fallback = 0) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    const transitYear = toNumber(selectedAgePoint.year)
    const transitMonth = toNumber(selectedAgePoint.mon)
    const transitDay = toNumber(selectedAgePoint.day)
    const birthYear = toNumber(year, new Date().getFullYear())
    const birthMonth = toNumber(month, 1)
    const birthDay = toNumber(day, 1)
    const birthHour = toNumber(hour, 12)
    const birthMinute = toNumber(minute, 0)
    const birthSecond = toNumber(second, 0)
    const normalizedLat = parseFloat(latitude)
    const normalizedLon = parseFloat(longitude)
    const location = {
      latitude: Number.isFinite(normalizedLat) ? normalizedLat : 0,
      longitude: Number.isFinite(normalizedLon) ? normalizedLon : 0,
    }
    return {
      person_id: selectedPerson?.id ?? null,
      birthday: { year: birthYear, month: birthMonth, day: birthDay, hour: birthHour, minute: birthMinute, second: birthSecond, timezone: timezone || null },
      birth_location: location,
      transitdate: { year: transitYear, month: transitMonth, day: transitDay, hour: 12, minute: 0, second: 0, timezone: timezone || null },
      transit_location: location,
    }
  }, [selectedPerson?.id, selectedAgePoint, year, month, day, hour, minute, second, latitude, longitude, timezone])

  const fetchAgePointTransit = useCallback(async () => {
    const payload = buildTransitPayloadForAgePoint()
    if (!payload) return
    setChartLoading(true)
    setChartError('')
    setApMarker(null)
    setAgePointLabel(formatAgePointLabel(selectedAgePoint))
    try {
      const reqSize = computeGraphicSize()
      const markerPayload = {
        ...agePointsRequestPayload,
        transit_year: payload.transitdate.year,
        transit_month: payload.transitdate.month,
        transit_day: payload.transitdate.day,
        transit_hour: payload.transitdate.hour,
        transit_minute: payload.transitdate.minute,
        transit_second: payload.transitdate.second,
      }
      const cacheKey = JSON.stringify({ payload, width: reqSize, height: reqSize, markerPayload })
      const cached = chartCacheRef.current.get(cacheKey)
      if (cached) {
        displayChartBlob(cached.blob)
        setApMarker(cached.marker || null)
        return
      }
      try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
      const controller = new AbortController()
      graphicAbortRef.current = controller
      const graphicResp = await postWithSignal(`/transits/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
      if (!graphicResp.ok) throw new Error(`Graphic request failed (${graphicResp.status})`)
      const markerResp = await post('/age-points/ap-marker', markerPayload)
      const markerData = await markerResp.json()
      if (!markerResp.ok) throw new Error(markerData?.detail || `Marker request failed (${markerResp.status})`)
      const blob = await graphicResp.blob()
      const marker = {
        xPercent: Number(markerData?.x_percent),
        yPercent: Number(markerData?.y_percent),
        drawDegree: Number(markerData?.draw_degree),
      }
      chartCacheRef.current.set(cacheKey, { blob, marker })
      displayChartBlob(blob)
      setApMarker(marker)
    } catch (err) {
      if (err.name === 'AbortError') {
        console.debug('[AgePoints] fetchAgePointTransit aborted')
      } else {
        setChartError(err.message || 'Alterspunkt-Chart konnte nicht geladen werden')
      }
      if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null }
      setChartImage(null)
      setApMarker(null)
    } finally {
      graphicAbortRef.current = null
      setChartLoading(false)
    }
  }, [buildTransitPayloadForAgePoint, selectedAgePoint, displayChartBlob, formatAgePointLabel, computeGraphicSize, agePointsRequestPayload])

  // Form population
  useEffect(() => {
    const data = activeSubject
    if (!data) return
    if (data?.birth_latitude != null) setLatitude(data.birth_latitude)
    if (data?.birth_longitude != null) setLongitude(data.birth_longitude)
    if (data?.birth_year) {
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
      setDatetimeLocal(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`)
    }
    if (data?.birth_timezone) setTimezone(data.birth_timezone)
  }, [activeSubject])

  // Subject change: reset state
  useEffect(() => {
    setSelectedAgePointIndex(0)
    setAgePointOptions([])
    setResp(null)
    setChartImage(null)
    setApMarker(null)
    setShowComputeSummary(false)
    setCachedSummary('')
    setChartError('')
    setChartLoading(false)
    setActiveInterpretationId(null)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [selectedPersonId, selectedPerson])

  // Unmount cleanup
  useEffect(() => () => {
    if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null }
  }, [])

  // Abort on subject change
  useEffect(() => {
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
    graphicAbortRef.current = null
  }, [selectedPersonId, selectedPerson])

  // Initial mount clear
  useEffect(() => {
    setShowComputeSummary(false)
    setCachedSummary('')
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  // Fetch age point options
  useEffect(() => {
    let active = true
    setAgePointsLoading(true)
    setAgePointsError('')
    const load = async () => {
      try {
        const resp2 = await post('/age-points/full', agePointsRequestPayload)
        if (!resp2.ok) throw new Error(`Status ${resp2.status}`)
        const data = await resp2.json()
        if (!active) return
        if (Array.isArray(data)) {
          setAgePointOptions(data)
          setSelectedAgePointIndex(computeDefaultAgePointIndex(data))
          setUserSelectedAgePoint(false)
        } else {
          setAgePointOptions([])
          setSelectedAgePointIndex(0)
          setUserSelectedAgePoint(false)
        }
      } catch (err) {
        if (!active) return
        setAgePointOptions([])
        setSelectedAgePointIndex(0)
        setAgePointsError(err.message || 'Alterspunkte konnten nicht geladen werden')
      } finally {
        if (active) setAgePointsLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [agePointsRequestPayload, computeDefaultAgePointIndex])

  // Auto-select default age point
  useEffect(() => {
    if (userSelectedAgePoint) return
    if (!agePointOptions.length) return
    const newIndex = computeDefaultAgePointIndex(agePointOptions)
    if (newIndex !== selectedAgePointIndex) setSelectedAgePointIndex(newIndex)
  }, [agePointOptions, selectedAgePointIndex, userSelectedAgePoint, computeDefaultAgePointIndex])

  // Auto-fetch chart when age point changes
  useEffect(() => {
    if (agePointsLoading) return
    if (!selectedAgePoint) return
    fetchAgePointTransit()
  }, [agePointsLoading, selectedAgePointIndex, selectedAgePoint, fetchAgePointTransit])

  const fetchAgePoints = useCallback(async () => {
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)
    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || followups.length >= 10) return
      setLocalLoading(true)
      setShowComputeSummary(true)
      followupBaseRef.current = cachedSummary
      const questionText = normalizedFollowup
      const questionNumber = followups.length + 1
      const separatorPrefix = `\n\n---\n\n**Zusatzfrage ${questionNumber}:** ${questionText}\n\n`
      let streamedText = ''
      try {
        await streamFollowup(activeInterpretationId, normalizedFollowup, {
          onDelta: (chunk) => {
            streamedText += chunk
            setCachedSummary(followupBaseRef.current + separatorPrefix + streamedText)
          },
          onDone: (summary) => {
            const finalText = summary || streamedText
            setCachedSummary(followupBaseRef.current + separatorPrefix + finalText)
            setFollowups(prev => [...prev, { question: questionText }])
            setCurrentFollowup('')
          },
          onError: (err) => { setResp({ ok: false, error: err.message }) },
        })
      } finally { setLocalLoading(false) }
      return
    }

    setLocalLoading(true)
    setResp(null)
    setCachedSummary('')
    setShowComputeSummary(true)
    const sel = agePointOptions[selectedAgePointIndex] || null
    if (!sel) {
      setResp({ ok: false, error: 'Bitte Alterspunkt auswählen' })
      setLocalLoading(false)
      return
    }
    const toNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
    const payload = {
      ...agePointsRequestPayload,
      target_year: toNumber(sel.year),
      target_month: toNumber(sel.mon),
      target_day: toNumber(sel.day),
      ...(normalizedAdditionalQuestion ? { additional_question: normalizedAdditionalQuestion } : {}),
    }

    try {
      try {
        let streamedSummary = ''
        let metaData = null
        await streamInterpret('/age-points/stream', payload, {
          onMeta: (data) => {
            metaData = data
            setResp({ ok: true, data: { ...data, summary: streamedSummary } })
          },
          onSummaryDelta: (content) => {
            streamedSummary += content
            setCachedSummary(streamedSummary)
            setResp(prev => {
              const baseData = prev?.data || metaData || {}
              return { ok: true, data: { ...baseData, summary: streamedSummary } }
            })
          },
          onDone: (summary) => {
            streamedSummary = summary || streamedSummary
            setCachedSummary(streamedSummary)
            setResp(prev => {
              const baseData = prev?.data || metaData || {}
              return { ok: true, data: { ...baseData, summary: streamedSummary } }
            })
          },
          onSaved: (id) => setActiveInterpretationId(id),
        })
      } catch (streamErr) {
        const r = await post('/age-points', payload)
        const data = await r.json()
        if (!r.ok) {
          setResp({ ok: false, status: r.status, data, error: data?.detail || `Request failed (${r.status})` })
          setCachedSummary('')
        } else {
          setResp({ ok: true, status: r.status, data })
        }
        if (r.ok && data) {
          const summary = data.summary || data.summary_html || ''
          setCachedSummary(summary)
        }
      }
    } catch (e) {
      setResp({ ok: false, error: e.message })
    } finally {
      setLocalLoading(false)
    }
  }, [additionalQuestion, currentFollowup, followups, agePointOptions, selectedAgePointIndex, agePointsRequestPayload, activeInterpretationId])

  const handleHistoryLoad = (interp) => {
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
    if (content) { setCachedSummary(content); setShowComputeSummary(true) }
    const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
    if (firstUserMsg?.content) setAdditionalQuestion(firstUserMsg.content)
    const followupMsgs = (interp.messages || [])
      .filter(m => m.role === 'user' && m.position > 1)
      .sort((a, b) => a.position - b.position)
    setFollowups(followupMsgs.map(m => ({ question: m.content })))
    setCurrentFollowup('')
    if (interp.interp_year && interp.interp_month && interp.interp_day) {
      const idx = agePointOptions.findIndex(ap =>
        Number(ap.year) === interp.interp_year &&
        Number(ap.mon) === interp.interp_month &&
        Number(ap.day) === interp.interp_day
      )
      if (idx !== -1) { setSelectedAgePointIndex(idx); setUserSelectedAgePoint(true) }
    }
  }

  const chartChildren = apMarker && Number.isFinite(apMarker.xPercent) && Number.isFinite(apMarker.yPercent) ? (
    <img
      src="/age-points/ap-graphic"
      alt="Alterspunkt Marker"
      style={{
        position: 'absolute',
        left: `${apMarker.xPercent}%`,
        top: `${apMarker.yPercent}%`,
        width: isNarrow ? 12 : 26,
        height: isNarrow ? 12 : 26,
        transform: `translate(-50%, -50%) rotate(${(Number.isFinite(apMarker.drawDegree) ? apMarker.drawDegree + 180 + AP_MARKER_ROTATION_OFFSET : 0)}deg)`,
        transformOrigin: '50% 50%',
        pointerEvents: 'none',
      }}
    />
  ) : null

  const computeSummaryText = (resp && resp.data && (resp.data.summary || resp.data.summary_html)) ? (resp.data.summary || resp.data.summary_html) : ''
  const computeSummaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const summaryError = computeSummaryError
  const summaryText = computeSummaryError ? '' : (cachedSummary || computeSummaryText || (localLoading ? 'Analyse wird erstellt ...' : ''))

  const pageState = {
    ...hookState,
    loading: localLoading || chartLoading,
    chartImage,
    imageLoading: chartLoading,
    imageError: chartError,
    showSummary: showComputeSummary,
    setShowSummary: setShowComputeSummary,
    summaryRef: localSummaryRef,
    summaryError, summaryText,
  }

  return (
    <InterpretationPage
      title="Age Points"
      wikiPageName="Alterspunkte"
      wikiOriginPage="agepoints"
      wikiOriginLabel="Alterspunkte"
      historyContextType="age_points"
      interpretButtonLabel="Alterspunkte berechnen"
      chartLoadingMessage="Alterspunkt-Chart wird gerendert…"
      chartFallbackMessage="Wähle links einen Alterspunkt aus, um das Chart rechts anzuzeigen."
      onInterpret={fetchAgePoints}
      onHistoryLoad={handleHistoryLoad}
      chartTitle="Alterspunkt Chart"
      chartMarginTop={-156}
      chartMinHeight={420}
      chartChildren={chartChildren}
      questionPlaceholder="Optional: Welche zusätzliche Frage soll die KI zu diesem Alterspunkt beantworten?"
      state={pageState}
    >
      <label><b>Alterspunkte</b></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        {agePointOptions.length > 0 ? (
          <select
            value={selectedAgePointIndex}
            onChange={e => { setSelectedAgePointIndex(Number(e.target.value)); setUserSelectedAgePoint(true) }}
            disabled={agePointsLoading}
            style={{ flex: '1 1 220px', minWidth: 220, maxWidth: 400, padding: '4px 8px' }}
          >
            {agePointOptions.map((point, idx) => (
              <option key={`age-point-${idx}`} value={idx}>{formatAgePointLabel(point)}</option>
            ))}
          </select>
        ) : (
          <select disabled style={{ flex: '1 1 220px', minWidth: 220, maxWidth: 400, padding: '4px 8px' }}>
            <option>{agePointsLoading ? 'Lade Alterspunkte…' : 'Keine Alterspunkte verfügbar'}</option>
          </select>
        )}
      </div>
      {agePointsError && <ErrorMessage message={agePointsError} />}
      <p style={{ marginTop: 0, marginBottom: 8, visibility: agePointLabel && chartImage ? 'visible' : 'hidden' }}><strong>Alterspunkt:</strong> {agePointLabel || ' '}</p>
    </InterpretationPage>
  )
}

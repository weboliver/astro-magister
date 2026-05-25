import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { post, postStream, postWithSignal } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import PersonSelector from '../components/PersonSelector'
import WikiPageShortcut from '../components/WikiPageShortcut'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { ADDITIONAL_QUESTION_MAX_LENGTH, normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from '../components/InterpretationHistoryDropdown'
import { streamFollowup, deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'

const sharedAgePointsTransitCache = new Map()
const AP_MARKER_ROTATION_OFFSET = -130

function formatDateTimeValue(year, month, day, hour, minute, second) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`
}

export default function AgePoints(){
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
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
  const [agePointOptions, setAgePointOptions] = useState([])
  const [selectedAgePointIndex, setSelectedAgePointIndex] = useState(0)
  const [agePointsLoading, setAgePointsLoading] = useState(false)
  const [agePointsError, setAgePointsError] = useState('')
  const [userSelectedAgePoint, setUserSelectedAgePoint] = useState(false)
  const [chartImage, setChartImage] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [agePointLabel, setAgePointLabel] = useState('')
  const [cachedSummary, setCachedSummary] = useState('')
  const [apMarker, setApMarker] = useState(null)
  const [showComputeSummary, setShowComputeSummary] = useState(false)
  const [additionalQuestion, setAdditionalQuestion] = useState('')
  const [activeInterpretationId, setActiveInterpretationId] = useState(null)
  const [dropdownRefreshToken, setDropdownRefreshToken] = useState(0)
  const [followups, setFollowups] = useState([])
  const [currentFollowup, setCurrentFollowup] = useState('')
  const followupBaseRef = useRef('')
  const summaryRef = useRef(null)
  const imageUrlRef = useRef(null)
  const chartCacheRef = useRef(sharedAgePointsTransitCache)
  const graphicAbortRef = useRef(null)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 800 : false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setIsNarrow(window.innerWidth < 800)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const { profile } = useAuth()
  const { selectedPerson, selectedPersonId } = usePersonSelection()

  const activeSubject = useMemo(() => {
    if (selectedPersonId !== null) {
      return selectedPerson || null
    }
    return profile || null
  }, [selectedPersonId, selectedPerson, profile])

  const activeSubjectKey = useMemo(() => {
    if (selectedPersonId !== null) {
      if (!selectedPerson) return `person:${selectedPersonId}:loading`
      return [
        'person',
        selectedPersonId,
        selectedPerson.birth_year ?? '',
        selectedPerson.birth_month ?? '',
        selectedPerson.birth_day ?? '',
        selectedPerson.birth_hour ?? '',
        selectedPerson.birth_minute ?? '',
        selectedPerson.birth_second ?? '',
        selectedPerson.birth_city ?? '',
        selectedPerson.birth_latitude ?? '',
        selectedPerson.birth_longitude ?? '',
        selectedPerson.birth_timezone ?? '',
      ].join(':')
    }
    return [
      'profile',
      profile?.id ?? 'none',
      profile?.birth_year ?? '',
      profile?.birth_month ?? '',
      profile?.birth_day ?? '',
      profile?.birth_hour ?? '',
      profile?.birth_minute ?? '',
      profile?.birth_second ?? '',
      profile?.birth_city ?? '',
      profile?.birth_latitude ?? '',
      profile?.birth_longitude ?? '',
      profile?.birth_timezone ?? '',
    ].join(':')
  }, [selectedPersonId, selectedPerson, profile])

  const agePointsRequestPayload = useMemo(() => {
    const parsedLatitude = parseFloat(latitude)
    const parsedLongitude = parseFloat(longitude)
    return {
      person_id: selectedPerson?.id ?? null,
      year: parseInt(year,10),
      month: parseInt(month,10),
      day: parseInt(day,10),
      hour: parseInt(hour,10),
      minute: parseInt(minute,10),
      second: parseInt(second,10),
      timezone: timezone || null,
      latitude: Number.isFinite(parsedLatitude) ? parsedLatitude : 0,
      longitude: Number.isFinite(parsedLongitude) ? parsedLongitude : 0,
      
    }
  }, [selectedPerson?.id, year, month, day, hour, minute, second, timezone, latitude, longitude])

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
      const pointDate = new Date(pointYear, pointMonth - 1, pointDay)
      return pointDate > now
    })
    return targetIndex !== -1 ? targetIndex : 0
  }, [])

  const displayChartBlob = useCallback((blob) => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
  }, [])

  const computeGraphicSize = useCallback(() => {
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    return Math.min(1200, Math.round(750 * Math.max(1, ratio)))
  }, [])

  useEffect(()=>{
    const data = activeSubject
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
      if (data && data.birth_timezone){
        setTimezone(data.birth_timezone)
      }
    }
  }, [activeSubjectKey, activeSubject])

  useEffect(() => {
    if (selectedPersonId !== null && !selectedPerson) return
    setUserSelectedAgePoint(false)
    setSelectedAgePointIndex(0)
    setAgePointOptions([])
    setResp(null)
    setChartImage(null)
    setApMarker(null)
    setShowComputeSummary(false)
    setCachedSummary('')
    setChartError('')
    setChartLoading(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [activeSubjectKey, selectedPersonId, selectedPerson])

  useEffect(() => () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (selectedPersonId !== null && !selectedPerson) return
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
  }, [activeSubjectKey, selectedPersonId, selectedPerson])

  useEffect(() => {
    // Ensure compute-summary textarea is hidden/cleared when the page is first opened
    setShowComputeSummary(false)
    setCachedSummary('')
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  useEffect(() => {
    let active = true
    setAgePointsLoading(true)
    setAgePointsError('')
    const load = async () => {
      try {
        const resp = await post('/age-points/full', agePointsRequestPayload)
        if (!resp.ok) {
          throw new Error(`Status ${resp.status}`)
        }
        const data = await resp.json()
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
        if (active) {
          setAgePointsLoading(false)
        }
      }
    }
    load()
    return () => { active = false }
  }, [agePointsRequestPayload, computeDefaultAgePointIndex])

  useEffect(() => {
    if (userSelectedAgePoint) return
    if (!agePointOptions.length) return
    const newIndex = computeDefaultAgePointIndex(agePointOptions)
    if (newIndex !== selectedAgePointIndex) {
      setSelectedAgePointIndex(newIndex)
    }
  }, [agePointOptions, selectedAgePointIndex, userSelectedAgePoint, computeDefaultAgePointIndex])

  async function fetchAgePoints(){
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)
    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || followups.length >= 10) return
      setLoading(true)
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
      } finally {
        setLoading(false)
      }
      return
    }
    setLoading(true)
    setResp(null)
    setCachedSummary('')
    setShowComputeSummary(true)
    const sel = agePointOptions[selectedAgePointIndex] || null
    if (!sel) {
      setResp({ ok: false, error: 'Bitte Alterspunkt auswählen' })
      setLoading(false)
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

    async function postAgePointsStream(path, payload) {
      const response = await postStream(path, payload)

      if (!response.ok) {
        let detail = `Request failed (${response.status})`
        try {
          const errorBody = await response.json()
          detail = errorBody.detail || detail
        } catch (error) {
          const text = await response.text()
          if (text) detail = text
        }
        throw new Error(detail)
      }

      if (!response.body) {
        throw new Error('Streaming wird von diesem Browser nicht unterstützt')
      }

      return response
    }

    function parseSseBlock(block) {
      let event = 'message'
      const dataLines = []

      for (const rawLine of block.split(/\r?\n/)) {
        if (!rawLine) continue
        if (rawLine.startsWith('event:')) {
          event = rawLine.slice(6).trim()
          continue
        }
        if (rawLine.startsWith('data:')) {
          dataLines.push(rawLine.slice(5).trimStart())
        }
      }

      if (!dataLines.length) return null

      try {
        return { event, data: JSON.parse(dataLines.join('\n')) }
      } catch (error) {
        return null
      }
    }

    try {
      // Try stream endpoint first; if it does not exist or fails, fallback to normal POST
      try {
        const streamResp = await postAgePointsStream('/age-points/stream', payload)
        const reader = streamResp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let streamedSummary = ''
        let metaData = null

        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = blocks.pop() || ''

          for (const block of blocks) {
            const parsed = parseSseBlock(block)
            if (!parsed) continue

            if (parsed.event === 'meta') {
              metaData = parsed.data
              setResp({ ok: true, status: streamResp.status, data: { ...parsed.data, summary: streamedSummary } })
              continue
            }

            if (parsed.event === 'summary_delta') {
              streamedSummary += parsed.data.content || ''
              setCachedSummary(streamedSummary)
              setResp(prev => {
                const baseData = prev?.data || metaData || {}
                return { ok: true, status: streamResp.status, data: { ...baseData, summary: streamedSummary } }
              })
              continue
            }

            if (parsed.event === 'done') {
              streamedSummary = parsed.data.summary || streamedSummary
              setCachedSummary(streamedSummary)
              setResp(prev => {
                const baseData = prev?.data || metaData || {}
                return { ok: true, status: streamResp.status, data: { ...baseData, summary: streamedSummary } }
              })
              continue
            }

            if (parsed.event === 'saved') {
              setActiveInterpretationId(parsed.data.interpretation_id)
              continue
            }

            if (parsed.event === 'error') {
              throw new Error(parsed.data.detail || 'Streaming fehlgeschlagen')
            }
          }

          if (done) break
        }

      } catch (streamErr) {
        // Fallback: call regular POST once (no double-calls)
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
      setResp({ ok:false, error: e.message })
    } finally {
      setLoading(false)
    }
  }

    

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
      birthday: {
        year: birthYear,
        month: birthMonth,
        day: birthDay,
        hour: birthHour,
        minute: birthMinute,
        second: birthSecond,
        timezone: timezone || null,
      },
      birth_location: location,
      transitdate: {
        year: transitYear,
        month: transitMonth,
        day: transitDay,
        hour: 12,
        minute: 0,
        second: 0,
        timezone: timezone || null,
      },
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
      try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
      const controller = new AbortController()
      graphicAbortRef.current = controller
      const graphicResp = await postWithSignal(`/transits/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
      if (!graphicResp.ok) {
        throw new Error(`Graphic request failed (${graphicResp.status})`)
      }
      const markerResp = await post('/age-points/ap-marker', markerPayload)
      const markerData = await markerResp.json()
      if (!markerResp.ok) {
        throw new Error(markerData?.detail || `Marker request failed (${markerResp.status})`)
      }
      const blob = await graphicResp.blob()
      const marker = {
        xPercent: Number(markerData?.x_percent),
        yPercent: Number(markerData?.y_percent),
        drawDegree: Number(markerData?.draw_degree),
      }
      chartCacheRef.current.set(cacheKey, {
        blob,
        marker,
      })
      displayChartBlob(blob)
      setApMarker(marker)
    } catch (err) {
      if (err.name === 'AbortError') {
        console.debug('[AgePoints] fetchAgePointTransit aborted')
      } else {
        setChartError(err.message || 'Alterspunkt-Chart konnte nicht geladen werden')
      }
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current)
        imageUrlRef.current = null
      }
      setChartImage(null)
      setApMarker(null)
    } finally {
      graphicAbortRef.current = null
      setChartLoading(false)
    }
  }, [buildTransitPayloadForAgePoint, selectedAgePoint, displayChartBlob, formatAgePointLabel, computeGraphicSize, agePointsRequestPayload])

  useEffect(() => {
    if (agePointsLoading) return
    if (!selectedAgePoint) return
    fetchAgePointTransit()
  }, [agePointsLoading, selectedAgePointIndex, selectedAgePoint, fetchAgePointTransit])

  const computeSummaryText = (resp && resp.data && (resp.data.summary || resp.data.summary_html)) ? (resp.data.summary || resp.data.summary_html) : ''
  const computeSummaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Age Points</h3>
        <WikiPageShortcut pageName="Alterspunkte" originPage="agepoints" originLabel="Alterspunkte" />
      </div>
      <PersonSelector helperText="Person wählen, deren Age Points berechnet werden sollen" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: isNarrow ? 0 : 320, width: '100%' }}>
          <label><b>Alterspunkte</b></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            {agePointOptions.length > 0 ? (
              <select
                value={selectedAgePointIndex}
                onChange={e=>{ setSelectedAgePointIndex(Number(e.target.value)); setUserSelectedAgePoint(true) }}
                disabled={agePointsLoading}
                style={{ flex: '1 1 220px', minWidth: 220, padding: '4px 8px' }}
              >
                {agePointOptions.map((point, idx) => (
                  <option key={`age-point-${idx}`} value={idx}>{formatAgePointLabel(point)}</option>
                ))}
              </select>
            ) : (
              <select disabled style={{ flex: '1 1 220px', minWidth: 220, padding: '4px 8px' }}>
                <option>{agePointsLoading ? 'Lade Alterspunkte…' : 'Keine Alterspunkte verfügbar'}</option>
              </select>
            )}
          </div>
          {agePointsError && <p style={{ color: '#c00', margin: '0 0 8px 0' }}>{agePointsError}</p>}
          <div style={{marginTop:8, display: 'none'}}>
          <label>Datum & Uhrzeit</label>
          <Flatpickr
            value={datetimeLocal}
            options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
            onChange={(dates)=>{
              const date = dates && dates[0]
              if (!date) return
              const y = date.getFullYear(); const m = date.getMonth()+1; const d = date.getDate()
              const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
              setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
              setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
              }}
            />
          <label>Timezone</label>
          <input className="tz-input" value={timezone} onChange={e=>setTimezone(e.target.value)} />
          <label>Latitude</label>
          <input value={latitude} onChange={e=>setLatitude(e.target.value)} />
          <label>Longitude</label>
          <input value={longitude} onChange={e=>setLongitude(e.target.value)} />
          </div>
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType="age_points"
              userPersonsId={selectedPersonId ?? null}
              refreshToken={activeInterpretationId || dropdownRefreshToken}
              onLoad={(interp) => {
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
                // Erste Nutzerfrage ins Zusatzfrage-Feld laden
                const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
                if (firstUserMsg?.content) setAdditionalQuestion(firstUserMsg.content)
                // Folgefragen (position > 1) als disabled anzeigen
                const followupMsgs = (interp.messages || [])
                  .filter(m => m.role === 'user' && m.position > 1)
                  .sort((a, b) => a.position - b.position)
                setFollowups(followupMsgs.map(m => ({ question: m.content })))
                setCurrentFollowup('')
                // Passenden Alterspunkt im Dropdown selektieren
                if (interp.interp_year && interp.interp_month && interp.interp_day) {
                  const idx = agePointOptions.findIndex(ap =>
                    Number(ap.year) === interp.interp_year &&
                    Number(ap.mon) === interp.interp_month &&
                    Number(ap.day) === interp.interp_day
                  )
                  if (idx !== -1) { setSelectedAgePointIndex(idx); setUserSelectedAgePoint(true) }
                }
              }}
            />
          )}
          <label><b>Optionale Zusatzfrage</b></label>
          <textarea
            value={additionalQuestion}
            onChange={(event) => setAdditionalQuestion(event.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH))}
            maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
            rows={3}
            placeholder="Optional: Welche zusätzliche Frage soll die KI zu diesem Alterspunkt beantworten?"
            style={{ width: '100%', resize: 'vertical', background: activeInterpretationId ? '#f5f5f5' : undefined }}
            disabled={!!activeInterpretationId}
          />
          {!activeInterpretationId && (
            <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{additionalQuestion.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>
          )}
          {(showComputeSummary && (cachedSummary || resp || loading)) ? (
            <div style={{ marginTop: 12, background: '#f7f7f7', padding: 16, width: '94%', maxHeight: 420, borderRadius: 10, border: '1px solid #dde1e7', color: '#203244', overflowY: 'auto', overflowX: 'hidden' }}>
              {computeSummaryError ? (
                <div style={{ color: '#b42318', whiteSpace: 'pre-wrap' }}>{computeSummaryError}</div>
              ) : null}
              <div ref={summaryRef}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {computeSummaryError ? '' : (cachedSummary || computeSummaryText || (loading ? 'Analyse wird erstellt ...' : ''))}
                </ReactMarkdown>
              </div>
            </div>
          ) : null}
          {cachedSummary && (
            <div style={{ marginTop: 4, textAlign: 'right' }}>
              <button
                onClick={() => {
                  const subject = activeSubject
                  const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                  printInterpretationAsPdf(`Alterspunkt Auswertung – ${agePointLabel}`, summaryRef.current, { personName: selectedPerson?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: chartImage })
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
          {activeInterpretationId && followups.length < 10 && (
            <div style={{ marginTop: 12 }}>
              <label><b>Zusatzfrage {followups.length + 1}</b> <span style={{ color: '#c00' }}>*</span></label>
              <textarea
                value={currentFollowup}
                onChange={(e) => setCurrentFollowup(e.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH))}
                maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
                rows={3}
                placeholder="Ihre Frage zur Vertiefung der Auswertung"
                style={{ width: '100%', resize: 'vertical' }}
              />
              <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{currentFollowup.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>
            </div>
          )}
          {activeInterpretationId && followups.length >= 10 && (
            <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Maximale Anzahl von 10 Zusatzfragen erreicht.</div>
          )}
          <div style={{marginTop:8, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <button
              onClick={fetchAgePoints}
              disabled={loading || (activeInterpretationId ? (!currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? 'Lade...' : (activeInterpretationId ? 'Auswertung vertiefen' : 'Alterspunkt interpretieren')}
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
        <div style={{ flex: '1 1 360px', minWidth: isNarrow ? 0 : 320, width: '100%', maxWidth: isNarrow ? '100%' : 750 }}>
          <div style={{ border: '1px solid #dde1e7', borderRadius: 12, marginTop: (isNarrow ? 0 : -70), padding: 12, minHeight: isNarrow ? 'auto' : 420, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Alterspunkt Chart</h4>
            {agePointLabel && <p style={{ marginTop: 0, marginBottom: 8 }}><strong>Alterspunkt:</strong> {agePointLabel}</p>}
            {chartLoading && <p>Alterspunkt-Chart wird gerendert…</p>}
            {chartError && <p style={{ color: '#c00' }}>{chartError}</p>}
            {chartImage && !chartLoading && (
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <img src={chartImage} alt="Alterspunkt Chart" style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: isNarrow ? 360 : 750, objectFit: 'contain' }} />
                {apMarker && Number.isFinite(apMarker.xPercent) && Number.isFinite(apMarker.yPercent) && (
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
                )}
              </div>
            )}
            {!chartImage && !chartLoading && !chartError && (
              <div style={{ color: '#577', marginBottom: 12 }}>Wähle links einen Alterspunkt aus, um das Chart rechts anzuzeigen.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

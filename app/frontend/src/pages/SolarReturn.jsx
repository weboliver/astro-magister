import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from '../contexts/AuthContext'
import { postStream, postWithSignal } from '../services/api'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import PersonSelector from '../components/PersonSelector'
import WikiPageShortcut from '../components/WikiPageShortcut'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'
import { ADDITIONAL_QUESTION_MAX_LENGTH, normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from '../components/InterpretationHistoryDropdown'
import { streamFollowup, deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'

const sharedSolarReturnCache = new Map()
const STORAGE_KEY = 'astronex_solar_return_payload'

const markdownComponents = {
  h1: ({ node, ...props }) => <h1 style={{ margin: '0 0 12px', fontSize: '1.5rem', lineHeight: 1.2 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '20px 0 10px', fontSize: '1.2rem', lineHeight: 1.25 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '16px 0 8px', fontSize: '1.05rem', lineHeight: 1.3 }} {...props} />,
  p: ({ node, ...props }) => <p style={{ margin: '0 0 12px', lineHeight: 1.65 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ marginBottom: 6 }} {...props} />,
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#132238' }} {...props} />,
  em: ({ node, ...props }) => <em style={{ color: '#38506b' }} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote style={{ margin: '16px 0', padding: '8px 14px', borderLeft: '4px solid #9fb4c7', background: '#f3f7fb', color: '#31485f' }} {...props} />
  ),
  code: ({ inline, node, ...props }) =>
    inline
      ? <code style={{ background: '#eef3f8', padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }} {...props} />
      : <code style={{ display: 'block', background: '#eef3f8', padding: 12, borderRadius: 8, overflowX: 'auto' }} {...props} />,
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

async function postSolarReturnStream(path, payload) {
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

function formatDateTimeValue(year, month, day, hour, minute, second) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`
}

export default function SolarReturn(){
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [birthYear, setBirthYear] = useState(1990)
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthHour, setBirthHour] = useState(12)
  const [birthMinute, setBirthMinute] = useState(0)
  const [birthSecond, setBirthSecond] = useState(0)
  const [latitude, setLatitude] = useState(52.52)
  const [longitude, setLongitude] = useState(13.4050)
  const [targetYear, setTargetYear] = useState(new Date().getFullYear())
  const [timezone, setTimezone] = useState(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  const [datetimeLocal, setDatetimeLocal] = useState('')
  const [graphicSrc, setGraphicSrc] = useState('')
  const [graphicError, setGraphicError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [cachedSummary, setCachedSummary] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [additionalQuestion, setAdditionalQuestion] = useState('')
  const [activeInterpretationId, setActiveInterpretationId] = useState(null)
  const [dropdownRefreshToken, setDropdownRefreshToken] = useState(0)
  const [followups, setFollowups] = useState([])
  const [currentFollowup, setCurrentFollowup] = useState('')
  const followupBaseRef = useRef('')
  const summaryRef = useRef(null)
  const chartCacheRef = useRef(sharedSolarReturnCache)
  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 800 : false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setIsNarrow(window.innerWidth < 800)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  const { profile } = useAuth()
  const prevProfileIdRef = useRef(profile?.id)
  const { selectedPerson } = usePersonSelection()
  const displayGraphic = useCallback((src) => {
    setGraphicError('')
    setGraphicSrc(src)
  }, [])
  const availableTargetYears = useMemo(() => {
    const normalizedBirthYear = Number(birthYear)
    const currentYear = new Date().getFullYear()
    const startYear = Number.isFinite(normalizedBirthYear) ? normalizedBirthYear : currentYear
    const endYear = Math.max(startYear, currentYear + 20)
    const years = []
    for (let year = startYear; year <= endYear; year += 1) {
      years.push(year)
    }
    if (!years.includes(currentYear)) {
      years.push(currentYear)
      years.sort((a, b) => a - b)
    }
    return years
  }, [birthYear])
  const currentPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    birth_year: parseInt(birthYear,10),
    birth_month: parseInt(birthMonth,10),
    birth_day: parseInt(birthDay,10),
    birth_hour: parseInt(birthHour,10),
    birth_minute: parseInt(birthMinute,10),
    birth_second: parseInt(birthSecond,10),
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    target_year: parseInt(targetYear,10),
    timezone,
    datetime: datetimeLocal || undefined,
  }), [selectedPerson?.id, birthYear, birthMonth, birthDay, birthHour, birthMinute, birthSecond, latitude, longitude, targetYear, timezone, datetimeLocal])
  const computeCacheKey = useCallback((payload) => {
    const subjectId = selectedPerson?.id || profile?.id || 'manual'
    return JSON.stringify({ type: 'solar-return', subjectId, ...payload })
  }, [profile?.id, selectedPerson?.id])

  const persistPayload = useCallback((payload) => {
    if(typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ payload, datetimeLocal }))
  }, [datetimeLocal])

  useEffect(()=>{
    const data = selectedPerson || profile
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
      setBirthYear(y); setBirthMonth(m); setBirthDay(d); setBirthHour(hh); setBirthMinute(mm); setBirthSecond(ss)
      setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
    }
    if (data && data.birth_timezone){
      setTimezone(data.birth_timezone)
    }
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
    setGraphicSrc('')
    activeChartCacheKeyRef.current = null
    setGraphicError('')
    setCachedSummary('')
    setShowSummary(false)
    setActiveInterpretationId(null)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [profile, selectedPerson])

  useEffect(() => {
    // Ensure textarea is hidden/cleared when the page is first opened
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  useEffect(() => {
    if(typeof window === 'undefined'){
      setHydrated(true)
      return
    }

    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if(raw){
      try{
        const { payload, datetimeLocal: storedDatetime } = JSON.parse(raw)
        if(payload){
          if(payload.birth_year !== undefined) setBirthYear(payload.birth_year)
          if(payload.birth_month !== undefined) setBirthMonth(payload.birth_month)
          if(payload.birth_day !== undefined) setBirthDay(payload.birth_day)
          if(payload.birth_hour !== undefined) setBirthHour(payload.birth_hour)
          if(payload.birth_minute !== undefined) setBirthMinute(payload.birth_minute)
          if(payload.birth_second !== undefined) setBirthSecond(payload.birth_second)
          if(payload.latitude !== undefined) setLatitude(payload.latitude)
          if(payload.longitude !== undefined) setLongitude(payload.longitude)
          if(payload.target_year !== undefined) setTargetYear(payload.target_year)
          if(payload.timezone !== undefined) setTimezone(payload.timezone)
        }
        if(storedDatetime) setDatetimeLocal(String(storedDatetime).replace('T', ' '))
      }catch(err){
        console.error('Failed to hydrate solar return form', err)
      }
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!availableTargetYears.length) return
    if (availableTargetYears.includes(Number(targetYear))) return
    setTargetYear(availableTargetYears[0])
  }, [availableTargetYears, targetYear])

  const handleLogoutCleanup = useCallback(() => {
    chartCacheRef.current.clear()
    setResp(null)
    setGraphicSrc('')
    setGraphicError('')
    setHydrated(false)
    setCachedSummary('')
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
  }, [])
  useLogoutCleanup(handleLogoutCleanup)

  useEffect(() => {
    if (prevProfileIdRef.current && !profile?.id) {
      handleLogoutCleanup()
    }
    prevProfileIdRef.current = profile?.id
  }, [profile?.id, handleLogoutCleanup])

  useEffect(() => {
    if(!hydrated) return
    const key = computeCacheKey(currentPayload)
    if(!key) return
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      displayGraphic(cached.graphic)
      activeChartCacheKeyRef.current = key
      // Do NOT set cached summary here. Keep summary/text lazy until user clicks button.
      persistPayload(currentPayload)
    } else {
      setGraphicSrc('')
      activeChartCacheKeyRef.current = null
      // automatically fetch only the graphic (no summary)
      let cancelled = false
      const fetchAutoGraphic = async () => {
        setGraphicError('')
        try {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
          const graphicSize = Math.min(1200, Math.round(750 * Math.max(1, ratio)))
          const headers = { 'Content-Type': 'application/json' }
          const token = localStorage.getItem('token')
          if (token) headers['Authorization'] = `Bearer ${token}`
          const graphicRes = await postWithSignal(`/solar-return/graphic?width=${graphicSize}&height=${graphicSize}`, currentPayload, controller.signal)
          if (graphicRes.ok) {
            const blob = await graphicRes.blob()
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result)
              reader.onerror = reject
              reader.readAsDataURL(blob)
            })
            if (!cancelled) {
              // store graphic in cache but do not set summary so text stays unloaded
              chartCacheRef.current.set(key, { graphic: base64 })
              displayGraphic(base64)
              activeChartCacheKeyRef.current = key
              persistPayload(currentPayload)
            }
          } else if (!cancelled) {
            setGraphicError(`Graphic request failed (${graphicRes.status})`)
          }
          graphicAbortRef.current = null
        } catch (err) {
          if (err.name === 'AbortError') {
            console.debug('[SolarReturn] autoFetch aborted')
          } else if (!cancelled) {
            setGraphicError(err.message || 'Graphic konnte nicht geladen werden')
          }
        }
      }
      fetchAutoGraphic()
      return () => { cancelled = true }
    }
  }, [currentPayload, computeCacheKey, displayGraphic, hydrated, persistPayload])

  async function fetchSolar(){
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)
    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || followups.length >= 10) return
      setLoading(true)
      setShowSummary(true)
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
    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload
    const cacheKey = computeCacheKey(currentPayload)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!graphicSrc && activeChartCacheKeyRef.current === cacheKey

    setLoading(true); setResp(null)
    setGraphicError('')
    setCachedSummary('')
    setShowSummary(true)
    try{
      if (!cachedGraphic && !hasCurrentGraphic) {
        setGraphicSrc('')
        activeChartCacheKeyRef.current = null
      }

      const streamResp = await postSolarReturnStream('/solar-return/stream', payload)
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

      if (cachedGraphic) {
        if (!hasCurrentGraphic) {
          displayGraphic(cachedGraphic.graphic)
        }
        activeChartCacheKeyRef.current = cacheKey
        setCachedSummary(cachedGraphic.summary || streamedSummary)
        if (!cachedGraphic.summary) {
          chartCacheRef.current.set(cacheKey, { ...cachedGraphic, summary: streamedSummary || 'Kein Summary vorhanden' })
        }
        persistPayload(currentPayload)
      } else if (hasCurrentGraphic) {
        activeChartCacheKeyRef.current = cacheKey
        setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
        persistPayload(currentPayload)
      } else {
        const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
        const graphicSize = Math.min(1200, Math.round(750 * Math.max(1, ratio)))
        try {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const graphicRes = await postWithSignal(`/solar-return/graphic?width=${graphicSize}&height=${graphicSize}`, currentPayload, controller.signal)
          if (!graphicRes.ok) {
            setGraphicError(`Graphic request failed (${graphicRes.status})`)
          } else {
            const blob = await graphicRes.blob()
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result)
              reader.onerror = reject
              reader.readAsDataURL(blob)
            })
            const summaryText = streamedSummary || 'Kein Summary vorhanden'
            chartCacheRef.current.set(cacheKey, { graphic: base64 })
            setCachedSummary(summaryText)
            const currentKey = computeCacheKey(currentPayload)
            if (currentKey === cacheKey) {
              displayGraphic(base64)
              activeChartCacheKeyRef.current = cacheKey
              persistPayload(currentPayload)
            } else {
              console.debug('[SolarReturn] fetchSolar dropped display (stale)', { cacheKey, currentKey })
            }
            graphicAbortRef.current = null
          }
        } catch (imgErr) {
          if (imgErr.name === 'AbortError') {
            console.debug('[SolarReturn] fetchSolar aborted')
          } else {
            throw imgErr
          }
        }
      }
    }catch(e){
      setResp({ ok:false, error: e.message })
    }
    setLoading(false)
  }

  const baseSummary = resp && (resp.data && (resp.data.summary || resp.data.summary_html))
    ? (resp.data.summary || resp.data.summary_html)
    : 'Kein Summary vorhanden'
  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError ? '' : (loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Solar Jahr</h3>
        <WikiPageShortcut pageName="Solar Jahr" originPage="solar" originLabel="Solar Jahr" />
      </div>
      <PersonSelector helperText="Wähle hier eine gespeicherte Person für die Solar Return-Berechnung" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
            <div style={{ display: 'none' }}>
            <label>Datum & Uhrzeit</label>
            <Flatpickr
              value={datetimeLocal}
              options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
              onChange={(dates)=>{
                const date = dates && dates[0]
                if (!date) return
                const y = date.getFullYear(); const m = date.getMonth()+1; const d = date.getDate()
                const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
                setBirthYear(y); setBirthMonth(m); setBirthDay(d); setBirthHour(hh); setBirthMinute(mm); setBirthSecond(ss)
                setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
              }}
            />
              <label>Latitude</label>
              <input value={latitude} onChange={e=>setLatitude(e.target.value)} />
              <label>Longitude</label>
              <input value={longitude} onChange={e=>setLongitude(e.target.value)} />
              <label>Timezone</label>
              <input style={{color:'black'}} value={timezone} onChange={e=>setTimezone(e.target.value)} />
            </div>
            <label>Target Year</label>
            <select
              value={targetYear}
              onChange={e => {
                setTargetYear(Number(e.target.value))
                setActiveInterpretationId(null)
                setCachedSummary('')
                setShowSummary(false)
                setAdditionalQuestion('')
                setFollowups([])
                setCurrentFollowup('')
              }}
              style={{ padding: '4px 8px' }}
            >
              {availableTargetYears.map(yearOption => (
                <option key={`solar-return-target-year-${yearOption}`} value={yearOption}>{yearOption}</option>
              ))}
            </select>
            {profile?.id && (
              <InterpretationHistoryDropdown
                contextType="solar"
                userPersonsId={selectedPerson?.id ?? null}
                refreshToken={activeInterpretationId || dropdownRefreshToken}
                selectedInterpretationId={activeInterpretationId}
                yearOnly
                onClear={() => {
                  setActiveInterpretationId(null)
                  setCachedSummary('')
                  setShowSummary(false)
                  setAdditionalQuestion('')
                  setFollowups([])
                  setCurrentFollowup('')
                }}
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
                  if (content) { setCachedSummary(content); setShowSummary(true) }
                  if (interp.interp_year) setTargetYear(interp.interp_year)
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
              placeholder="Optional: Worauf soll die KI beim Solarjahr besonders eingehen?"
              style={{ width: '100%', resize: 'vertical', background: activeInterpretationId ? '#f5f5f5' : undefined }}
              disabled={!!activeInterpretationId}
            />
            {!activeInterpretationId && (
              <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{additionalQuestion.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>
            )}
            {(showSummary && (cachedSummary || resp || loading)) ? (
              <div style={{ marginTop: 12, background: '#f7f7f7', padding: 16, width: '94%', maxHeight: 420, borderRadius: 10, border: '1px solid #dde1e7', color: '#203244', overflowY: 'auto', overflowX: 'hidden' }}>
                {summaryError ? (
                  <div style={{ color: '#b42318', whiteSpace: 'pre-wrap' }}>{summaryError}</div>
                ) : null}
                <div ref={summaryRef}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {summaryText || (loading ? 'Analyse wird erstellt ...' : '')}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {cachedSummary && (
              <div style={{ marginTop: 4, textAlign: 'right' }}>
                <button
                  onClick={() => {
                    const subject = selectedPerson || profile
                    const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                    printInterpretationAsPdf('Solar Jahr', summaryRef.current, { personName: selectedPerson?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: graphicSrc || null })
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
                onClick={fetchSolar}
                disabled={loading || (activeInterpretationId ? (!currentFollowup.trim() || followups.length >= 10) : false)}
              >
                {loading ? 'Lade...' : (activeInterpretationId ? 'Auswertung vertiefen' : 'Solar Jahr interpretieren')}
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
          <div
            style={{
              border: '1px solid #dde1e7',
              borderRadius: 12,
              padding: 12,
              minHeight: 420,
              marginTop: (isNarrow ? 0 : -70),
              background: '#fff',
              boxShadow: '0 2px 12px rgba(15,23,42,0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <strong>Solar Jahr Diagramm</strong>
            {graphicError && <p style={{ color: 'crimson', margin: 0 }}>{graphicError}</p>}
            {graphicSrc ? (
              <img
                src={graphicSrc}
                alt="Solar Jahr"
                style={{ width: '100%' }}
              />
            ) : (
              <div style={{ color: '#577' }}>
                Klicke auf "Solar Jahr interpretieren", um das Diagramm rechts neben dem Formular anzuzeigen.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

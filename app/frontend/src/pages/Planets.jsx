import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { postStream, postWithSignal } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import PersonSelector from '../components/PersonSelector'
import WikiPageShortcut from '../components/WikiPageShortcut'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'
import { ADDITIONAL_QUESTION_MAX_LENGTH, normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from '../components/InterpretationHistoryDropdown'
import { streamFollowup, deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'
import { formatDateTimeValue } from '../utils/dateTime'

import { parseSseBlock } from '../utils/sseParser'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { ErrorMessage } from '../components/ErrorMessage'
import { PoweruserNoticeLink } from '../components/PoweruserNotice'

const sharedPlanetsCache = new Map()
const STORAGE_KEY = 'astronex_planets_chart_payload'

async function postPlanetsStream(path, payload) {
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

export default function Planets(){
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth()+1)
  const [day, setDay] = useState(new Date().getDate())
  const [hour, setHour] = useState(12)
  const [minute, setMinute] = useState(0)
  const [second, setSecond] = useState(0)
  const [datetimeLocal, setDatetimeLocal] = useState('')
  const [latitude, setLatitude] = useState(52.52)
  const [longitude, setLongitude] = useState(13.4050)
  const [timezone, setTimezone] = useState(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  const [chartImage, setChartImage] = useState(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
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
  const imageUrlRef = useRef(null)
  const chartCacheRef = useRef(sharedPlanetsCache)
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
  const prevProfileIdRef = useRef(profile?.id)
  const { selectedPerson } = usePersonSelection()
  const displayChartBlob = useCallback((blob) => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
    }
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
  }, [])
  const currentPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    year: parseInt(year,10),
    month: parseInt(month,10),
    day: parseInt(day,10),
    hour: parseInt(hour,10),
    minute: parseInt(minute,10),
    second: parseInt(second,10),
    timezone: timezone || null,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
  }), [selectedPerson?.id, year, month, day, hour, minute, second, timezone, latitude, longitude])
  const computeGraphicSize = useCallback(() => {
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    return Math.min(1200, Math.round(750 * Math.max(1, ratio)))
  }, [])
  const computeCacheKey = useCallback((payload, size) => {
    const subjectId = selectedPerson?.id || profile?.id || 'manual'
    return JSON.stringify({ type: 'planets', subjectId, ...payload, width: size, height: size })
  }, [profile?.id, selectedPerson?.id])

  const persistPayload = useCallback((payload) => {
    if(typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ payload, datetimeLocal }))
  }, [datetimeLocal])


  useEffect(() => () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
    }
  }, [])

  useEffect(() => {
    // Ensure textarea is hidden/cleared when the page is first opened
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  const handleLogoutCleanup = useCallback(() => {
    chartCacheRef.current.clear()
    setChartImage(null)
    setResp(null)
    setImageError('')
    setImageLoading(false)
    setHydrated(false)
    setCachedSummary('')
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  }, [])
  useLogoutCleanup(handleLogoutCleanup)

  useEffect(() => {
    if (prevProfileIdRef.current && !profile?.id) {
      handleLogoutCleanup()
    }
    prevProfileIdRef.current = profile?.id
  }, [profile?.id, handleLogoutCleanup])

  useEffect(() => {
    if (!hydrated) return
    const size = computeGraphicSize()
    const key = computeCacheKey(currentPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      setImageError('')
      displayChartBlob(cached.blob)
      // Do NOT set cached summary here. Keep summary/text lazy until user clicks button.
      persistPayload(currentPayload)
    } else {
      setChartImage(null)
      setCachedSummary('')
      // automatically fetch only the graphic (no summary)
      const fetchAutoGraphic = async () => {
        setImageLoading(true)
        setImageError('')
        try {
          // abort any previous in-flight graphic request
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const reqSize = computeGraphicSize()
          const cacheKey = computeCacheKey(currentPayload, reqSize)
          const cached2 = chartCacheRef.current.get(cacheKey)
          if (cached2) {
            graphicAbortRef.current = null
            displayChartBlob(cached2.blob)
            return
          }
          const headers = { 'Content-Type': 'application/json' }
          const token = localStorage.getItem('token')
          if (token) headers['Authorization'] = `Bearer ${token}`
          const graphicResp = await postWithSignal(`/horoscope/graphic?width=${reqSize}&height=${reqSize}`, currentPayload, controller.signal)
          if (!graphicResp.ok) {
            throw new Error(`Graphic request failed (${graphicResp.status})`)
          }
          const blob = await graphicResp.blob()
          // store blob in cache but do not set summary so text stays unloaded
          chartCacheRef.current.set(cacheKey, { blob })
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            displayChartBlob(blob)
            persistPayload(currentPayload)
          } else {
            console.debug('[Planets] autoFetch dropped display (stale)', { cacheKey, currentKey })
          }
          graphicAbortRef.current = null
        } catch (err) {
          if (err.name === 'AbortError') {
            console.debug('[Planets] autoFetch aborted')
          } else {
            setImageError(err.message || 'Graphic konnte nicht geladen werden')
          }
        } finally {
          setImageLoading(false)
        }
      }
      fetchAutoGraphic()
    }
  }, [hydrated, currentPayload, computeCacheKey, computeGraphicSize, displayChartBlob, persistPayload])

  useEffect(() => {
    // abort any ongoing graphic request when selection/profile changes
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
    setChartImage(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(false)
  }, [selectedPerson?.id, profile?.id])

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHydrated(true)
      return
    }
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed.payload) {
          const payload = parsed.payload
          if (payload.year !== undefined) setYear(payload.year)
          if (payload.month !== undefined) setMonth(payload.month)
          if (payload.day !== undefined) setDay(payload.day)
          if (payload.hour !== undefined) setHour(payload.hour)
          if (payload.minute !== undefined) setMinute(payload.minute)
          if (payload.second !== undefined) setSecond(payload.second)
          if (payload.latitude !== undefined) setLatitude(payload.latitude)
          if (payload.longitude !== undefined) setLongitude(payload.longitude)
          if (payload.timezone !== undefined) setTimezone(payload.timezone)
        }
        if (parsed.datetimeLocal) {
          setDatetimeLocal(String(parsed.datetimeLocal).replace('T', ' '))
        }
      } catch (_error) {
        // ignore
      }
    }
    setHydrated(true)
  }, [])

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
      setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
      setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
    }
    if (data && data.birth_timezone){
      setTimezone(data.birth_timezone)
    }
    setActiveInterpretationId(null)
    setCachedSummary('')
    setShowSummary(false)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [profile, selectedPerson])

  async function fetchPlanets(){
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
    setLoading(true)
    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)

    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(payload, reqSize)
    try {
      console.debug('[Planets] fetchPlanets start', { cacheKey, payload })
      const cached = chartCacheRef.current.get(cacheKey)
      let skipGraphic = false
      if (cached) {
        displayChartBlob(cached.blob)
        skipGraphic = true
      }

      if (!skipGraphic) {
        setChartImage(null)
        if (imageUrlRef.current) {
          URL.revokeObjectURL(imageUrlRef.current)
          imageUrlRef.current = null
        }
        setImageLoading(true)
      } else {
        setImageLoading(false)
      }

      const streamResp = await postPlanetsStream('/planets/stream', payload)
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

      try {
        const summaryText = streamedSummary || 'Kein Summary vorhanden'
        if (skipGraphic) {
          setCachedSummary(summaryText)
          persistPayload(payload)
        } else {
          console.debug('[Planets] fetchPlanets graphic start', { cacheKey, payload })
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const graphicResp = await postWithSignal(`/horoscope/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
          if (!graphicResp.ok) {
            throw new Error(`Graphic request failed (${graphicResp.status})`)
          }
          const blob = await graphicResp.blob()
          chartCacheRef.current.set(cacheKey, { blob })
          setCachedSummary(summaryText)
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            displayChartBlob(blob)
            persistPayload(payload)
          } else {
            console.debug('[Planets] fetchPlanets dropped display (stale)', { cacheKey, currentKey })
          }
          graphicAbortRef.current = null
        }
      } catch (imgErr) {
        if (imgErr.name === 'AbortError') {
          console.debug('[Planets] fetchPlanets aborted')
        } else {
          setImageError(imgErr.message || 'Graphic konnte nicht geladen werden')
        }
      }
    } catch(e) {
      setResp({ ok:false, error: e.message })
    } finally {
      setLoading(false)
      setImageLoading(false)
    }
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
        <h3 style={{ marginBottom: 0 }}>Planeten</h3>
        <WikiPageShortcut pageName="Planeten" originPage="planets" originLabel="Planeten" />
      </div>
      <PersonSelector helperText="Person für die Planetenberechnung wählen" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
          <div style={{ display: 'none' }}>
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
            <label>Timezone</label>
            <input className="tz-input" value={timezone} onChange={e=>setTimezone(e.target.value)} />
            <label>Latitude</label>
            <input value={latitude} onChange={e=>setLatitude(e.target.value)} />
            <label>Longitude</label>
            <input value={longitude} onChange={e=>setLongitude(e.target.value)} />
          </div>
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType="planets"
              userPersonsId={selectedPerson?.id ?? null}
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
            placeholder="Optional: Worauf soll die KI bei der Interpretation besonders eingehen?"
            style={{ width: '100%', resize: 'vertical', background: activeInterpretationId ? '#f5f5f5' : undefined }}
            disabled={!!activeInterpretationId}
          />
          {!activeInterpretationId && (
            <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{additionalQuestion.length}/{ADDITIONAL_QUESTION_MAX_LENGTH}</div>
          )}
            {(showSummary && (cachedSummary || resp || loading)) ? (
              <div style={{ marginTop: 12, background: '#f7f7f7', padding: 16, width: '94%', maxHeight: 420, borderRadius: 10, border: '1px solid #dde1e7', color: '#203244', overflowY: 'auto', overflowX: 'hidden' }}>
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
                    const subject = selectedPerson || profile
                    const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                    printInterpretationAsPdf('Planeten Positionen', summaryRef.current, { personName: selectedPerson?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: chartImage })
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
              onClick={fetchPlanets}
              disabled={loading || (activeInterpretationId ? (!profile?.is_poweruser || !currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? <LoadingSpinner /> : (activeInterpretationId ? 'Auswertung vertiefen' : 'Planeten Positionen interpretieren')}
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
          <div style={{ border: '1px solid #dde1e7', borderRadius: 12, marginTop: (isNarrow ? 0 : -70), padding: 12, minHeight: 420, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Planeten Positionen</h4>
            {imageLoading && <LoadingSpinner message="Horoskop wird gerendert…" />}
            {imageError && <ErrorMessage message={imageError} />}
            {chartImage && !imageLoading && (
              <img src={chartImage} alt="Planeten Positionen" style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: 'cover' }} />
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>Klicke auf «Planeten Positionen interpretieren», um das Chart rechts neben dem Formular anzuzeigen.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

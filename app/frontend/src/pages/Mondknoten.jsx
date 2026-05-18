/**
 * Mondknoten - Moon Node (Rahu/Ketu) horoscope page for calculating and interpreting the lunar nodes in the birth chart.
 * @component
 * @returns {JSX.Element} Rendered Mondknoten page
 * @hook useState - Manages response, loading, date/time, location, chart image, summary, followups
 * @hook useEffect - Handles responsive layout, loads user data, fetches chart automatically, manages selections
 * @hook useCallback - Revokes object URLs, computes graphic size, cache key, handles logout cleanup
 * @hook useMemo - Computes current payload for API requests
 * @hook useRef - Tracks followup base, summary ref, image URL, chart cache, abort controller, revocation timeout
 */
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

const sharedMondknotenCache = new Map()

async function postMondknotenStream(path, payload) {
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

export default function Mondknoten(){
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
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
  const [chartImage, setChartImage] = useState(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
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
  const chartCacheRef = useRef(sharedMondknotenCache)
  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)
  const hasInitializedSelectionResetRef = useRef(false)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 800 : false)

  const revokeTimeoutRef = useRef(null)
  const revokeObjectUrlLater = useCallback((url) => {
    if (!url || typeof window === 'undefined') return
    const candidate = url
    window.setTimeout(() => {
      try {
        if (imageUrlRef.current === candidate) {
          console.debug('[Mondknoten] skip revoke of active URL')
          return
        }
        URL.revokeObjectURL(candidate)
        console.debug('[Mondknoten] revoked object URL')
      } catch (e) {
        console.debug('[Mondknoten] revoke failed', e)
      }
    }, 500)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setIsNarrow(window.innerWidth < 800)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  const { profile, initialized: authInitialized } = useAuth()
  const prevProfileIdRef = useRef(profile?.id)
  const { selectedPerson } = usePersonSelection()
  const displayChartBlob = useCallback((blob) => {
    const previousUrl = imageUrlRef.current
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
    revokeObjectUrlLater(previousUrl)
  }, [revokeObjectUrlLater])
  const currentPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: parseInt(day, 10),
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
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
    return JSON.stringify({ type: 'nodes', subjectId, ...payload, width: size, height: size })
  }, [profile?.id, selectedPerson?.id])

  const handleLogoutCleanup = useCallback(() => {
    const previousUrl = imageUrlRef.current
    chartCacheRef.current.clear()
    setResp(null)
    setImageError('')
    setChartImage(null)
    activeChartCacheKeyRef.current = null
    imageUrlRef.current = null
    revokeObjectUrlLater(previousUrl)
    setCachedSummary('')
  }, [])
  useLogoutCleanup(handleLogoutCleanup)

  useEffect(() =>{
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

  useEffect(() => () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
    }
  }, [])

  useEffect(() => {
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  useEffect(() => {
    if (prevProfileIdRef.current && !profile?.id) {
      handleLogoutCleanup()
    }
    prevProfileIdRef.current = profile?.id
  }, [profile?.id, handleLogoutCleanup])

  useEffect(() => {
    if (!selectedPerson && !authInitialized) {
      console.debug('[Mondknoten] autoFetch waiting for auth initialization')
      return
    }

    const size = computeGraphicSize()

    const sourcePerson = selectedPerson || profile
    if (sourcePerson) {
      if ((sourcePerson.birth_year && sourcePerson.birth_year !== currentPayload.year) ||
          (sourcePerson.birth_month && sourcePerson.birth_month !== currentPayload.month) ||
          (sourcePerson.birth_day && sourcePerson.birth_day !== currentPayload.day) ||
          (sourcePerson.birth_hour !== undefined && sourcePerson.birth_hour !== null && sourcePerson.birth_hour !== currentPayload.hour) ||
          (sourcePerson.birth_minute !== undefined && sourcePerson.birth_minute !== null && sourcePerson.birth_minute !== currentPayload.minute) ||
          (sourcePerson.birth_second !== undefined && sourcePerson.birth_second !== null && sourcePerson.birth_second !== currentPayload.second) ||
          (sourcePerson.birth_latitude !== undefined && sourcePerson.birth_latitude !== null && parseFloat(sourcePerson.birth_latitude) !== currentPayload.latitude) ||
          (sourcePerson.birth_longitude !== undefined && sourcePerson.birth_longitude !== null && parseFloat(sourcePerson.birth_longitude) !== currentPayload.longitude) ||
          (sourcePerson.birth_timezone && sourcePerson.birth_timezone !== currentPayload.timezone)) {
        console.debug('[Mondknoten] autoFetch waiting for source person state sync')
        return
      }
    }

    const key = computeCacheKey(currentPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      setImageError('')
      displayChartBlob(cached.blob)
      activeChartCacheKeyRef.current = key
    } else {
      setChartImage(null)
      setCachedSummary('')
      const fetchAutoGraphic = async () => {
        setImageLoading(true)
        setImageError('')
        try {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const reqSize = computeGraphicSize()
          const cacheKey = computeCacheKey(currentPayload, reqSize)
          console.debug('[Mondknoten] autoFetch start', { cacheKey, subjectId: selectedPerson?.id || profile?.id, payload: currentPayload })
          const cached2 = chartCacheRef.current.get(cacheKey)
          if (cached2) {
            displayChartBlob(cached2.blob)
            graphicAbortRef.current = null
            return
          }
          const graphicResp = await postWithSignal(`/nodes/graphic?width=${reqSize}&height=${reqSize}`, currentPayload, controller.signal)
          if (!graphicResp.ok) {
            throw new Error(`Graphic request failed (${graphicResp.status})`)
          }
          const blob = await graphicResp.blob()
          chartCacheRef.current.set(cacheKey, { blob })
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            console.debug('[Mondknoten] autoFetch display', { cacheKey })
            displayChartBlob(blob)
            activeChartCacheKeyRef.current = cacheKey
          } else {
            console.debug('[Mondknoten] autoFetch dropped display (stale)', { cacheKey, currentKey })
          }
          graphicAbortRef.current = null
        } catch (err) {
          if (err.name === 'AbortError') {
            console.debug('[Mondknoten] autoFetch aborted')
          } else {
            setImageError(err.message || 'Graphic konnte nicht geladen werden')
          }
        } finally {
          setImageLoading(false)
        }
      }
      fetchAutoGraphic()
    }
  }, [authInitialized, currentPayload, computeCacheKey, computeGraphicSize, displayChartBlob, profile, selectedPerson])


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
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
    revokeObjectUrlLater(previousUrl)
  }, [selectedPerson?.id, profile?.id])

  async function fetchMondknoten(){
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(currentPayload, reqSize)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!chartImage && activeChartCacheKeyRef.current === cacheKey
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
    setLoading(true); setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)
    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload
    if (!cachedGraphic && !hasCurrentGraphic) {
      const previousUrl = imageUrlRef.current
      setChartImage(null)
      imageUrlRef.current = null
      activeChartCacheKeyRef.current = null
      setImageLoading(true)
      revokeObjectUrlLater(previousUrl)
    } else {
      setImageLoading(false)
    }

    try{
      const streamResp = await postMondknotenStream('/nodes/stream', payload)
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

      try{
        const cached = chartCacheRef.current.get(cacheKey)
        if (cached) {
          if (!hasCurrentGraphic) {
            displayChartBlob(cached.blob)
          }
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
        } else if (hasCurrentGraphic) {
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
        } else {
          console.debug('[Mondknoten] fetchMondknoten graphic start', { cacheKey, payload })
          try {
            try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
            const controller = new AbortController()
            graphicAbortRef.current = controller
            const graphicResp = await postWithSignal(`/nodes/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
            if (!graphicResp.ok) {
              throw new Error(`Graphic request failed (${graphicResp.status})`)
            }
            const blob = await graphicResp.blob()
            const summaryText = streamedSummary || 'Kein Summary vorhanden'
            chartCacheRef.current.set(cacheKey, { blob })
            setCachedSummary(summaryText)
            const currentKey = computeCacheKey(currentPayload, reqSize)
            if (currentKey === cacheKey) {
              console.debug('[Mondknoten] fetchMondknoten display', { cacheKey })
              displayChartBlob(blob)
              activeChartCacheKeyRef.current = cacheKey
            } else {
              console.debug('[Mondknoten] fetchMondknoten dropped display (stale)', { cacheKey, currentKey })
            }
            graphicAbortRef.current = null
          } catch (imgErr) {
            if (imgErr.name === 'AbortError') {
              console.debug('[Mondknoten] fetchMondknoten aborted')
            } else {
              throw imgErr
            }
          }
        }
      }catch(imgErr){
        setImageError(imgErr.message || 'Graphic konnte nicht geladen werden')
      }
    }catch(e){
      setResp({ ok:false, error: e.message })
    }finally{
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
        <h3 style={{ marginBottom: 0 }}>Mondknoten Horoskop</h3>
        <WikiPageShortcut pageName="Mondknoten" originPage="mondknoten" originLabel="Mondknoten" />
      </div>
      <PersonSelector helperText="Person für die Mondknoten-Berechnung wählen" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
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
              contextType="nodes"
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
                  const subject = selectedPerson || profile
                  const birthDate = subject ? `${subject.birth_day ?? '?'}.${subject.birth_month ?? '?'}.${subject.birth_year ?? '?'}` : ''
                  printInterpretationAsPdf('Mondknoten Horoskop', summaryRef.current, { personName: selectedPerson?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: chartImage })
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
              onClick={fetchMondknoten}
              disabled={loading || (activeInterpretationId ? (!profile?.is_poweruser || !currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? <LoadingSpinner /> : (activeInterpretationId ? 'Auswertung vertiefen' : 'Mondknoten interpretieren')}
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
          <div style={{ border: '1px solid #dde1e7', marginTop: (isNarrow ? 0 : -70), borderRadius: 12, padding: 12, minHeight: 320, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Mondknoten Diagramm</h4>
            {imageLoading && <LoadingSpinner message="Mondknoten wird gerendert…" />}
            {imageError && <ErrorMessage message={imageError} />}
            {chartImage && !imageLoading && (
              <img src={chartImage} alt="Mondknoten Diagramm" style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: 'cover' }} />
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>Klicke auf «Mondknoten interpretieren», um das Chart rechts neben dem Formular anzuzeigen und eine Auswertung zu erhalten.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
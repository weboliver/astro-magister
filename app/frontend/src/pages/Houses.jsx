import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { postWithSignal } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import PersonSelector from '../components/PersonSelector'
import WikiPageShortcut from '../components/WikiPageShortcut'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'

const sharedHousesCache = new Map()
const STORAGE_KEY = 'astronex_houses_chart_payload'

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

async function postHousesStream(path, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  }
  const token = localStorage.getItem('token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

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

export default function Houses(){
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
  const imageUrlRef = useRef(null)
  const chartCacheRef = useRef(sharedHousesCache)
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
    return JSON.stringify({ type: 'houses', subjectId, ...payload, width: size, height: size })
  }, [profile?.id, selectedPerson?.id])
  const persistPayload = useCallback((payload) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, datetimeLocal }))
  }, [datetimeLocal])

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
          const graphicResp = await postWithSignal(`/houses/graphic?width=${reqSize}&height=${reqSize}`, currentPayload, controller.signal)
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
            console.debug('[Houses] autoFetch dropped display (stale)', { cacheKey, currentKey })
          }
          graphicAbortRef.current = null
        } catch (err) {
          if (err.name === 'AbortError') {
            console.debug('[Houses] autoFetch aborted')
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
    // Ensure textarea is hidden/cleared when the page is first opened
    setCachedSummary('')
    setShowSummary(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHydrated(true)
      return
    }
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      try{
        const parsed = JSON.parse(stored)
        if (parsed.year !== undefined) setYear(parsed.year)
        if (parsed.month !== undefined) setMonth(parsed.month)
        if (parsed.day !== undefined) setDay(parsed.day)
        if (parsed.hour !== undefined) setHour(parsed.hour)
        if (parsed.minute !== undefined) setMinute(parsed.minute)
        if (parsed.second !== undefined) setSecond(parsed.second)
        if (parsed.latitude !== undefined) setLatitude(parsed.latitude)
        if (parsed.longitude !== undefined) setLongitude(parsed.longitude)
        if (parsed.timezone !== undefined) setTimezone(parsed.timezone)
        if (parsed.datetimeLocal) setDatetimeLocal(String(parsed.datetimeLocal).replace('T', ' '))
      }catch(_){ }
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
    if (data && data.residence_timezone){ setTimezone(data.residence_timezone) }
    else if (data && data.birth_timezone){ setTimezone(data.birth_timezone) }
  }, [profile, selectedPerson])

  async function fetchHouses(){
    const payload = currentPayload
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(payload, reqSize)
    const cached = chartCacheRef.current.get(cacheKey)

    setLoading(true)
    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)

    let skipGraphic = false
    if (cached) {
      displayChartBlob(cached.blob)
      if (cached.summary) {
        setCachedSummary(cached.summary)
        persistPayload(payload)
        setLoading(false)
        setImageLoading(false)
        return
      }
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

    try{
      const streamResp = await postHousesStream('/houses/stream', payload)
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
            setResp((prev) => {
              const baseData = prev?.data || metaData || {}
              return { ok: true, status: streamResp.status, data: { ...baseData, summary: streamedSummary } }
            })
            continue
          }

          if (parsed.event === 'done') {
            streamedSummary = parsed.data.summary || streamedSummary
            setCachedSummary(streamedSummary)
            setResp((prev) => {
              const baseData = prev?.data || metaData || {}
              return { ok: true, status: streamResp.status, data: { ...baseData, summary: streamedSummary } }
            })
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
          chartCacheRef.current.set(cacheKey, { ...cached, summary: summaryText })
          setCachedSummary(summaryText)
          persistPayload(payload)
        } else {
          console.debug('[Houses] fetchHouses graphic start', { cacheKey, payload })
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const graphicResp = await postWithSignal(`/houses/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
          if (!graphicResp.ok) {
            throw new Error(`Graphic request failed (${graphicResp.status})`)
          }
          const blob = await graphicResp.blob()
          chartCacheRef.current.set(cacheKey, { blob, summary: summaryText })
          setCachedSummary(summaryText)
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            displayChartBlob(blob)
            persistPayload(payload)
          } else {
            console.debug('[Houses] fetchHouses dropped display (stale)', { cacheKey, currentKey })
          }
          graphicAbortRef.current = null
        }
      } catch (imgErr) {
        if (imgErr.name === 'AbortError') {
          console.debug('[Houses] fetchHouses aborted')
        } else {
          setImageError(imgErr.message || 'Graphic konnte nicht geladen werden')
        }
      }
    }catch(e){
      setResp({ ok:false, error: e.message })
    }finally{
      setLoading(false)
      setImageLoading(false)
    }
  }

  const passiveSummary = resp
    ? resp.data
      ? typeof resp.data === 'string'
        ? resp.data
        : resp.data.summary || resp.data.summary_html || 'Kein Summary vorhanden'
      : resp.error || 'Kein Summary vorhanden'
    : ''
  const summaryContent = cachedSummary || passiveSummary
  const summaryText = loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Häuser</h3>
        <WikiPageShortcut pageName="Häuser" originPage="houses" originLabel="Häuser" />
      </div>
      <PersonSelector helperText="Wähle eine gespeicherte Person für das Haus-Chart" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
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
          <div style={{ display: 'none' }}>
            <label>Timezone</label>
            <input className="tz-input" value={timezone} onChange={e=>setTimezone(e.target.value)} />
            <label>Latitude</label>
            <input value={latitude} onChange={e=>setLatitude(e.target.value)} />
            <label>Longitude</label>
            <input value={longitude} onChange={e=>setLongitude(e.target.value)} />
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={fetchHouses} disabled={loading}>{loading ? 'Lade...' : 'Häuser Positionen interpretieren'}</button>
          </div>
          {(showSummary && (cachedSummary || resp || loading)) ? (
            <div style={{ marginTop: 12, background: '#f7f7f7', padding: 16, width: '90%', maxHeight: 420, borderRadius: 10, border: '1px solid #dde1e7', color: '#203244', overflowY: 'auto', overflowX: 'hidden' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {summaryText || (loading ? 'Analyse wird erstellt ...' : '')}
              </ReactMarkdown>
            </div>
          ) : null}
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 240, maxWidth: 750 }}>
          <div style={{ border: '1px solid #dde1e7', borderRadius: 12, marginTop: (isNarrow ? 0 : -70), padding: 12, minHeight: 420, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Häuser Chart</h4>
            {imageLoading && <p>Die Häusergrafik wird gerendert…</p>}
            {imageError && <p style={{ color: '#c00' }}>{imageError}</p>}
            {chartImage && !imageLoading && (
              <img
                src={chartImage}
                alt="Häuserspitzengrafik"
                style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: 'cover' }}
              />
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>Klicke auf «Häuser Positionen berechnen», um die Häusergrafik rechts neben dem Formular anzuzeigen.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

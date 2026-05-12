import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { postStream, postWithSignal } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
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

const sharedTransitsCache = new Map()
const STORAGE_KEY = 'astronex_transits_payload'

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

async function postTransitsStream(path, payload) {
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

// revokeObjectUrlLater moved into component to avoid revoking the active URL

export default function Transits(){
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const now = new Date()
  const initialTYear = now.getFullYear()
  const initialTMonth = now.getMonth()+1
  const initialTDay = now.getDate()
  const initialTHour = now.getHours()
  const initialTMinute = now.getMinutes()
  const initialTSecond = now.getSeconds()
  const initialTDatetimeLocal = formatDateTimeValue(initialTYear, initialTMonth, initialTDay, initialTHour, initialTMinute, initialTSecond)
  const [byear, setByear] = useState(1990)
  const [bmonth, setBmonth] = useState(1)
  const [bday, setBday] = useState(1)
  const [bhour, setBhour] = useState(12)
  const [bminute, setBminute] = useState(0)
  const [bsecond, setBsecond] = useState(0)
  const [bdatetimeLocal, setBdatetimeLocal] = useState('')
  const [btimezone, setBtimezone] = useState(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  const [blat, setBlat] = useState(52.52)
  const [blon, setBlon] = useState(13.4050)
  const [tyear, setTyear] = useState(initialTYear)
  const [tmonth, setTmonth] = useState(initialTMonth)
  const [tday, setTday] = useState(initialTDay)
  const [thour, setThour] = useState(initialTHour)
  const [tminute, setTminute] = useState(initialTMinute)
  const [tsecond, setTsecond] = useState(initialTSecond)
  const [tdatetimeLocal, setTdatetimeLocal] = useState(initialTDatetimeLocal)
  const [ttimezone, setTtimezone] = useState(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  const [tlat, setTlat] = useState(52.52)
  const [tlon, setTlon] = useState(13.4050)
  const [filter, setFilter] = useState('pluto,neptune,uranus,jupiter,saturn,mars,venus,merkur,node,lilith,chiron')
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
  const chartCacheRef = useRef(sharedTransitsCache)
  const revokeTimeoutRef = useRef(null)
  const revokeObjectUrlLater = useCallback((url) => {
    if (!url || typeof window === 'undefined') return
    const candidate = url
    // give the browser a bit more time to start loading before revoking
    window.setTimeout(() => {
      try {
        if (imageUrlRef.current === candidate) {
          console.debug('[Transits] skip revoke of active URL')
          return
        }
        URL.revokeObjectURL(candidate)
        console.debug('[Transits] revoked object URL')
      } catch (e) {
        console.debug('[Transits] revoke failed', e)
      }
    }, 500)
  }, [])
  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)
  const hasInitializedSelectionResetRef = useRef(false)
  const activeInterpretationIdRef = useRef(null)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 800 : false)

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
  const pendingAutoFetchRef = useRef(false)
  // Keep ref in sync with state during render so effects can read the current value
  // without needing to add activeInterpretationId to their dependency arrays.
  activeInterpretationIdRef.current = activeInterpretationId
  const displayChartBlob = useCallback((blob) => {
    const previousUrl = imageUrlRef.current
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
    revokeObjectUrlLater(previousUrl)
  }, [revokeObjectUrlLater])
  const normalizedFilter = useMemo(() => {
    if (!filter) return null
    const list = filter.split(',').map(s=>s.trim()).filter(Boolean)
    return list.length ? list : null
  }, [filter])
  const transitPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    birthday: { year: parseInt(byear,10), month: parseInt(bmonth,10), day: parseInt(bday,10), hour: parseInt(bhour,10), minute: parseInt(bminute,10), second: parseInt(bsecond,10), timezone: btimezone },
    birth_location: { latitude: parseFloat(blat), longitude: parseFloat(blon) },
    transitdate: { year: parseInt(tyear,10), month: parseInt(tmonth,10), day: parseInt(tday,10), hour: parseInt(thour,10), minute: parseInt(tminute,10), second: parseInt(tsecond,10), timezone: ttimezone },
    transit_location: { latitude: parseFloat(tlat), longitude: parseFloat(tlon) },
    filterplanets: normalizedFilter
  }), [selectedPerson?.id, byear, bmonth, bday, bhour, bminute, bsecond, btimezone, blat, blon, tyear, tmonth, tday, thour, tminute, tsecond, ttimezone, tlat, tlon, normalizedFilter])
  const computeGraphicSize = useCallback(() => {
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    return Math.min(1200, Math.round(750 * Math.max(1, ratio)))
  }, [])
  const computeCacheKey = useCallback((payload, size) => {
    const subjectId = selectedPerson?.id || profile?.id || 'manual'
    return JSON.stringify({ type: 'transits', subjectId, ...payload, width: size, height: size })
  }, [profile?.id, selectedPerson?.id])
  const persistPayload = useCallback((payload) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, bdatetimeLocal, tdatetimeLocal, autoFetchTransits: false }))
  }, [bdatetimeLocal, tdatetimeLocal])

  const fetchTransitGraphic = useCallback(async (options = {}) => {
    const { force = false } = options
    setImageLoading(true)
    setImageError('')
    try {
      try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
      const controller = new AbortController()
      graphicAbortRef.current = controller
      const reqSize = computeGraphicSize()
      const cacheKey = computeCacheKey(transitPayload, reqSize)
      const cached = chartCacheRef.current.get(cacheKey)
      if (cached && cached.blob && !force) {
        graphicAbortRef.current = null
        displayChartBlob(cached.blob)
        activeChartCacheKeyRef.current = cacheKey
        persistPayload(transitPayload)
        return
      }
      const graphicResp = await postWithSignal(`/transits/graphic?width=${reqSize}&height=${reqSize}`, transitPayload, controller.signal)
      if (!graphicResp.ok) {
        throw new Error(`Graphic request failed (${graphicResp.status})`)
      }
      const blob = await graphicResp.blob()
      const existing = chartCacheRef.current.get(cacheKey) || {}
      chartCacheRef.current.set(cacheKey, { ...existing, blob })
      const currentKey = computeCacheKey(transitPayload, reqSize)
      if (currentKey === cacheKey) {
        displayChartBlob(blob)
        activeChartCacheKeyRef.current = cacheKey
        persistPayload(transitPayload)
      }
      graphicAbortRef.current = null
    } catch (err) {
      if (err.name === 'AbortError') {
        console.debug('[Transits] graphic fetch aborted')
      } else {
        setImageError(err.message || 'Graphic konnte nicht geladen werden')
      }
    } finally {
      setImageLoading(false)
    }
  }, [computeCacheKey, computeGraphicSize, displayChartBlob, persistPayload, transitPayload])

  useEffect(() => () => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
    }
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
        if (parsed.birthday){
          if (parsed.birthday.year !== undefined) setByear(parsed.birthday.year)
          if (parsed.birthday.month !== undefined) setBmonth(parsed.birthday.month)
          if (parsed.birthday.day !== undefined) setBday(parsed.birthday.day)
          if (parsed.birthday.hour !== undefined) setBhour(parsed.birthday.hour)
          if (parsed.birthday.minute !== undefined) setBminute(parsed.birthday.minute)
          if (parsed.birthday.second !== undefined) setBsecond(parsed.birthday.second)
          if (parsed.birthday.timezone !== undefined) setBtimezone(parsed.birthday.timezone)
        }
        if (parsed.birth_location){
          if (parsed.birth_location.latitude !== undefined) setBlat(parsed.birth_location.latitude)
          if (parsed.birth_location.longitude !== undefined) setBlon(parsed.birth_location.longitude)
        }
        if (parsed.transitdate){
          if (parsed.transitdate.year !== undefined) setTyear(parsed.transitdate.year)
          if (parsed.transitdate.month !== undefined) setTmonth(parsed.transitdate.month)
          if (parsed.transitdate.day !== undefined) setTday(parsed.transitdate.day)
          if (parsed.transitdate.hour !== undefined) setThour(parsed.transitdate.hour)
          if (parsed.transitdate.minute !== undefined) setTminute(parsed.transitdate.minute)
          if (parsed.transitdate.second !== undefined) setTsecond(parsed.transitdate.second)
          if (parsed.transitdate.timezone !== undefined) setTtimezone(parsed.transitdate.timezone)
        }
        if (parsed.transit_location){
          if (parsed.transit_location.latitude !== undefined) setTlat(parsed.transit_location.latitude)
          if (parsed.transit_location.longitude !== undefined) setTlon(parsed.transit_location.longitude)
        }
        if (parsed.autoFetchTransits){
          pendingAutoFetchRef.current = true
          parsed.autoFetchTransits = false
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
          }
        }
        if (parsed.bdatetimeLocal) setBdatetimeLocal(String(parsed.bdatetimeLocal).replace('T', ' '))
        if (parsed.tdatetimeLocal) setTdatetimeLocal(String(parsed.tdatetimeLocal).replace('T', ' '))
        if (Array.isArray(parsed.filterplanets)) {
          setFilter(parsed.filterplanets.join(','))
        }
      }catch(_){ }
    }
    setHydrated(true)
  }, [])

  useEffect(()=>{
    const data = selectedPerson || profile
    if (!data) return
    if (data.birth_latitude !== undefined && data.birth_latitude !== null){ setBlat(data.birth_latitude) }
    if (data.birth_longitude !== undefined && data.birth_longitude !== null){ setBlon(data.birth_longitude) }
    if (data.residence_latitude !== undefined && data.residence_latitude !== null){ setTlat(data.residence_latitude) } else if (data.birth_latitude !== undefined && data.birth_latitude !== null){ setTlat(data.birth_latitude) }
    if (data.residence_longitude !== undefined && data.residence_longitude !== null){ setTlon(data.residence_longitude) } else if (data.birth_longitude !== undefined && data.birth_longitude !== null){ setTlon(data.birth_longitude) }
    if (data.birth_year){
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      setByear(y); setBmonth(m); setBday(d); setBhour(hh); setBminute(mm); setBsecond(ss)
      setBdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
    }
    if (data.residence_timezone){
      setTtimezone(data.residence_timezone)
      setBtimezone(data.birth_timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'))
    } else if (data.birth_timezone){
      setBtimezone(data.birth_timezone)
      setTtimezone(data.birth_timezone)
    }
    setActiveInterpretationId(null)
    setCachedSummary('')
    setShowSummary(false)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [profile, selectedPerson])

  const fetchTransits = useCallback(async () => {
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(transitPayload, reqSize)
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
    const aiPayload = normalizedAdditionalQuestion
      ? { ...transitPayload, additional_question: normalizedAdditionalQuestion }
      : transitPayload

    setLoading(true); setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)
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
      const streamResp = await postTransitsStream('/transits/stream', aiPayload)
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
        if (cachedGraphic) {
          if (!hasCurrentGraphic) {
            displayChartBlob(cachedGraphic.blob)
          }
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
          persistPayload(transitPayload)
        } else if (hasCurrentGraphic) {
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
          persistPayload(transitPayload)
        } else {
          console.debug('[Transits] fetchTransits graphic start', { cacheKey, transitPayload })
          await fetchTransitGraphic()
          const summaryText = streamedSummary || 'Kein Summary vorhanden'
          setCachedSummary(summaryText)
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
  }, [additionalQuestion, currentFollowup, followups, transitPayload, computeGraphicSize, computeCacheKey, displayChartBlob, chartImage, persistPayload, activeInterpretationId])

  useEffect(() => {
    if (!hydrated) return
    if (!selectedPerson && !authInitialized) {
      console.debug('[Transits] autoFetch waiting for auth initialization')
      return
    }

    const sourcePerson = selectedPerson || profile
    if (sourcePerson) {
      if ((sourcePerson.birth_year && sourcePerson.birth_year !== transitPayload.birthday.year) ||
          (sourcePerson.birth_month && sourcePerson.birth_month !== transitPayload.birthday.month) ||
          (sourcePerson.birth_day && sourcePerson.birth_day !== transitPayload.birthday.day) ||
          (sourcePerson.birth_hour !== undefined && sourcePerson.birth_hour !== null && sourcePerson.birth_hour !== transitPayload.birthday.hour) ||
          (sourcePerson.birth_minute !== undefined && sourcePerson.birth_minute !== null && sourcePerson.birth_minute !== transitPayload.birthday.minute) ||
          (sourcePerson.birth_second !== undefined && sourcePerson.birth_second !== null && sourcePerson.birth_second !== transitPayload.birthday.second) ||
          (sourcePerson.birth_latitude !== undefined && sourcePerson.birth_latitude !== null && parseFloat(sourcePerson.birth_latitude) !== transitPayload.birth_location.latitude) ||
          (sourcePerson.birth_longitude !== undefined && sourcePerson.birth_longitude !== null && parseFloat(sourcePerson.birth_longitude) !== transitPayload.birth_location.longitude) ||
          (sourcePerson.birth_timezone && sourcePerson.birth_timezone !== transitPayload.birthday.timezone)) {
        console.debug('[Transits] autoFetch waiting for source person state sync')
        return
      }
    }

    const size = computeGraphicSize()
    const key = computeCacheKey(transitPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      setImageError('')
      displayChartBlob(cached.blob)
      activeChartCacheKeyRef.current = key
      // Do NOT set cached summary here. Keep summary/text lazy until user clicks button.
    } else {
      setChartImage(null)
      // Only clear the summary if no saved interpretation is currently displayed.
      // When onLoad sets a new transit date and cachedSummary simultaneously,
      // the transitPayload change would otherwise wipe out the just-loaded summary.
      if (!activeInterpretationIdRef.current) {
        setCachedSummary('')
      }
      // automatically fetch only the graphic (no summary)
      fetchTransitGraphic()
    }
  }, [authInitialized, hydrated, transitPayload, computeCacheKey, computeGraphicSize, displayChartBlob, fetchTransitGraphic, profile, selectedPerson])

  useEffect(() => {
    if (!hydrated) return
    if (pendingAutoFetchRef.current) {
      pendingAutoFetchRef.current = false
      fetchTransits()
    }
  }, [hydrated, fetchTransits])

  useEffect(() => {
    if (!hasInitializedSelectionResetRef.current) {
      hasInitializedSelectionResetRef.current = true
      return
    }
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch(e){}
    graphicAbortRef.current = null
    const previousUrl = imageUrlRef.current
    imageUrlRef.current = null
    setChartImage(null)
    activeChartCacheKeyRef.current = null
    setImageError('')
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
    revokeObjectUrlLater(previousUrl)
  }, [selectedPerson?.id, profile?.id])

  useEffect(() => {
    // Ensure textarea is hidden/cleared when the page is first opened
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  const handleLogoutCleanup = useCallback(() => {
    const previousUrl = imageUrlRef.current
    chartCacheRef.current.clear()
    setChartImage(null)
    setResp(null)
    setImageError('')
    setImageLoading(false)
    activeChartCacheKeyRef.current = null
    setFilter('pluto,neptune,uranus,jupiter,saturn,mars,venus,merkur,sun,node,lilith,chiron')
    setCachedSummary('')
    imageUrlRef.current = null
    revokeObjectUrlLater(previousUrl)
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

  const baseSummary = resp && (resp.data && (resp.data.summary || resp.data.summary_html))
    ? (resp.data.summary || resp.data.summary_html)
    : 'Kein Summary vorhanden'
  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError ? '' : (loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Transite</h3>
        <WikiPageShortcut pageName="Transite" originPage="transits" originLabel="Transite" />
      </div>
      <PersonSelector helperText="Geburtsperson für Transitberechnungen auswählen" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
          <div style={{ display: 'none' }}>
          <h4 style={{marginTop:2, marginBottom:2}}>Geburtstag</h4>
          <label>Datum & Uhrzeit</label>
          <Flatpickr
            value={bdatetimeLocal}
            options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
            onChange={(dates)=>{
              const date = dates && dates[0]
              if (!date) return
              const y = date.getFullYear(); const m = date.getMonth()+1; const d = date.getDate()
              const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
              setByear(y); setBmonth(m); setBday(d); setBhour(hh); setBminute(mm); setBsecond(ss)
              setBdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
            }}
          />
            <label>Timezone</label>
            <input style={{color:'black'}} value={btimezone} onChange={e=>setBtimezone(e.target.value)} />
            <label>Lat</label>
            <input value={blat} onChange={e=>setBlat(e.target.value)} />
            <label>Lon</label>
            <input value={blon} onChange={e=>setBlon(e.target.value)} />
          </div>

          <h4 style={{marginTop:2, marginBottom:2}}>Transit</h4>
          <label>Datum & Uhrzeit</label>
          <Flatpickr
            value={tdatetimeLocal}
            options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
            onChange={(dates)=>{
              const date = dates && dates[0]
              if (!date) return
              const y = date.getFullYear(); const m = date.getMonth()+1; const d = date.getDate()
              const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
              if (y !== tyear || m !== tmonth || d !== tday) {
                setActiveInterpretationId(null)
                setCachedSummary('')
                setShowSummary(false)
                setAdditionalQuestion('')
                setFollowups([])
                setCurrentFollowup('')
              }
              setTyear(y); setTmonth(m); setTday(d); setThour(hh); setTminute(mm); setTsecond(ss)
              setTdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
            }}
          />
          <div style={{ display: 'none' }}>
            <label>Timezone</label>
            <input style={{color:'black'}} value={ttimezone} onChange={e=>setTtimezone(e.target.value)} />
            <label>Lat</label>
            <input value={tlat} onChange={e=>setTlat(e.target.value)} />
            <label>Lon</label>
            <input value={tlon} onChange={e=>setTlon(e.target.value)} />

            <label style={{marginTop:12}}>Filter planets (comma-separated names or ids)</label>
            <input value={filter} onChange={e=>setFilter(e.target.value)} />
          </div>
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType="transits"
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
                // Transit-Datum und Uhrzeit wiederherstellen
                if (interp.interp_year && interp.interp_month && interp.interp_day) {
                  const y = interp.interp_year, m = interp.interp_month, d = interp.interp_day
                  const hh = interp.interp_hour ?? 0, mm = interp.interp_minute ?? 0
                  setTyear(y); setTmonth(m); setTday(d); setThour(hh); setTminute(mm); setTsecond(0)
                  setTdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, 0))
                }
                // Erste Nutzerfrage ins Zusatzfrage-Feld laden
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
            placeholder="Optional: Welche konkrete Transit-Frage soll die KI zusätzlich beantworten?"
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
                  printInterpretationAsPdf('Transite', summaryRef.current, { personName: selectedPerson?.name || profile?.username || 'Eigenes Profil', birthDate, birthCity: subject?.birth_city || '', birthRegionCode: subject?.birth_region || '', birthCountryCode: subject?.birth_country || '', additionalQuestion, imageUrl: chartImage })
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

          <div style={{marginTop:8, display:'flex', flexWrap:'wrap', gap:8}}>
            <button
              onClick={fetchTransits}
              disabled={loading || imageLoading || (activeInterpretationId ? (!currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? 'Lade...' : (activeInterpretationId ? 'Auswertung vertiefen' : 'Transite Interpretieren')}
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
            <button style={{display: 'none'}} onClick={() => fetchTransitGraphic({ force: true })} disabled={imageLoading || loading}>{imageLoading ? 'Grafik lädt...' : 'Nur Grafik aktualisieren'}</button>
          </div>
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 240, maxWidth: 750 }}>
          <div style={{ border: '1px solid #dde1e7', borderRadius: 12, marginTop: (isNarrow ? 0 : -70), padding: 12, minHeight: 420, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Transits Chart</h4>
            {imageLoading && <p>Transit-Chart wird gerendert…</p>}
            {imageError && <p style={{ color: '#c00' }}>{imageError}</p>}
            {chartImage && !imageLoading && (
              <img src={chartImage} alt="Transit Chart" style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: 'cover' }} />
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>Klicke auf «Transite Interpretieren», um das Chart rechts neben dem Formular anzuzeigen.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

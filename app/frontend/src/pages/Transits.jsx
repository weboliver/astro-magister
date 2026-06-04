import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import InterpretationPage from '../components/InterpretationPage'
import { useAuth } from '../contexts/AuthContext'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'
import { postWithSignal } from '../services/api'
import { streamInterpret } from '../hooks/useInterpretationStream'
import { streamFollowup, deleteInterpretation } from '../hooks/useInterpretations'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'
import { formatDateTimeValue } from '../utils/dateTime'

const sharedTransitsCache = new Map()
const STORAGE_KEY = 'astronex_transits_payload'

export default function Transits() {
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const now = useMemo(() => new Date(), [])
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
  const [tyear, setTyear] = useState(now.getFullYear())
  const [tmonth, setTmonth] = useState(now.getMonth() + 1)
  const [tday, setTday] = useState(now.getDate())
  const [thour, setThour] = useState(now.getHours())
  const [tminute, setTminute] = useState(now.getMinutes())
  const [tsecond, setTsecond] = useState(now.getSeconds())
  const [tdatetimeLocal, setTdatetimeLocal] = useState(formatDateTimeValue(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()))
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
    window.setTimeout(() => {
      try {
        if (imageUrlRef.current === url) return
        URL.revokeObjectURL(url)
      } catch (e) {}
    }, 500)
  }, [])

  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)
  const hasInitializedSelectionResetRef = useRef(false)
  const activeInterpretationIdRef = useRef(null)
  activeInterpretationIdRef.current = activeInterpretationId

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

  const displayChartBlob = useCallback((blob) => {
    const previousUrl = imageUrlRef.current
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
    revokeObjectUrlLater(previousUrl)
  }, [revokeObjectUrlLater])

  const normalizedFilter = useMemo(() => {
    if (!filter) return null
    const list = filter.split(',').map(s => s.trim()).filter(Boolean)
    return list.length ? list : null
  }, [filter])

  const transitPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    birthday: { year: parseInt(byear, 10), month: parseInt(bmonth, 10), day: parseInt(bday, 10), hour: parseInt(bhour, 10), minute: parseInt(bminute, 10), second: parseInt(bsecond, 10), timezone: btimezone },
    birth_location: { latitude: parseFloat(blat), longitude: parseFloat(blon) },
    transitdate: { year: parseInt(tyear, 10), month: parseInt(tmonth, 10), day: parseInt(tday, 10), hour: parseInt(thour, 10), minute: parseInt(tminute, 10), second: parseInt(tsecond, 10), timezone: ttimezone },
    transit_location: { latitude: parseFloat(tlat), longitude: parseFloat(tlon) },
    filterplanets: normalizedFilter,
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
      try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
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
      try {
        const parsed = JSON.parse(stored)
        if (parsed.birthday) {
          if (parsed.birthday.year !== undefined) setByear(parsed.birthday.year)
          if (parsed.birthday.month !== undefined) setBmonth(parsed.birthday.month)
          if (parsed.birthday.day !== undefined) setBday(parsed.birthday.day)
          if (parsed.birthday.hour !== undefined) setBhour(parsed.birthday.hour)
          if (parsed.birthday.minute !== undefined) setBminute(parsed.birthday.minute)
          if (parsed.birthday.second !== undefined) setBsecond(parsed.birthday.second)
          if (parsed.birthday.timezone !== undefined) setBtimezone(parsed.birthday.timezone)
        }
        if (parsed.birth_location) {
          if (parsed.birth_location.latitude !== undefined) setBlat(parsed.birth_location.latitude)
          if (parsed.birth_location.longitude !== undefined) setBlon(parsed.birth_location.longitude)
        }
        if (parsed.transitdate) {
          if (parsed.transitdate.year !== undefined) setTyear(parsed.transitdate.year)
          if (parsed.transitdate.month !== undefined) setTmonth(parsed.transitdate.month)
          if (parsed.transitdate.day !== undefined) setTday(parsed.transitdate.day)
          if (parsed.transitdate.hour !== undefined) setThour(parsed.transitdate.hour)
          if (parsed.transitdate.minute !== undefined) setTminute(parsed.transitdate.minute)
          if (parsed.transitdate.second !== undefined) setTsecond(parsed.transitdate.second)
          if (parsed.transitdate.timezone !== undefined) setTtimezone(parsed.transitdate.timezone)
        }
        if (parsed.transit_location) {
          if (parsed.transit_location.latitude !== undefined) setTlat(parsed.transit_location.latitude)
          if (parsed.transit_location.longitude !== undefined) setTlon(parsed.transit_location.longitude)
        }
        if (parsed.autoFetchTransits) {
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
      } catch (_) { }
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    const data = selectedPerson || profile
    if (!data) return
    if (data.birth_latitude !== undefined && data.birth_latitude !== null) setBlat(data.birth_latitude)
    if (data.birth_longitude !== undefined && data.birth_longitude !== null) setBlon(data.birth_longitude)
    if (data.residence_latitude !== undefined && data.residence_latitude !== null) setTlat(data.residence_latitude)
    else if (data.birth_latitude !== undefined && data.birth_latitude !== null) setTlat(data.birth_latitude)
    if (data.residence_longitude !== undefined && data.residence_longitude !== null) setTlon(data.residence_longitude)
    else if (data.birth_longitude !== undefined && data.birth_longitude !== null) setTlon(data.birth_longitude)
    if (data.birth_year) {
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      setByear(y); setBmonth(m); setBday(d); setBhour(hh); setBminute(mm); setBsecond(ss)
      setBdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
    }
    if (data.residence_timezone) {
      setTtimezone(data.residence_timezone)
      setBtimezone(data.birth_timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'))
    } else if (data.birth_timezone) {
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

  // Auto-fetch chart graphic
  useEffect(() => {
    if (!hydrated) return
    if (!selectedPerson && !authInitialized) return

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
    } else {
      setChartImage(null)
      if (!activeInterpretationIdRef.current) {
        setCachedSummary('')
      }
      fetchTransitGraphic()
    }
  }, [authInitialized, hydrated, transitPayload, computeCacheKey, computeGraphicSize, displayChartBlob, fetchTransitGraphic, profile, selectedPerson])

  // Selection change: clear chart and interpretation state
  useEffect(() => {
    if (!hasInitializedSelectionResetRef.current) {
      hasInitializedSelectionResetRef.current = true
      return
    }
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
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

  // Initial mount clear
  useEffect(() => {
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
    try {
      let streamedSummary = ''
      let metaData = null
      await streamInterpret('/transits/stream', aiPayload, {
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

      try {
        if (cachedGraphic) {
          if (!hasCurrentGraphic) displayChartBlob(cachedGraphic.blob)
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
          persistPayload(transitPayload)
        } else if (hasCurrentGraphic) {
          activeChartCacheKeyRef.current = cacheKey
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
          persistPayload(transitPayload)
        } else {
          await fetchTransitGraphic()
          setCachedSummary(streamedSummary || 'Kein Summary vorhanden')
        }
      } catch (imgErr) {
        setImageError(imgErr.message || 'Graphic konnte nicht geladen werden')
      }
    } catch (e) {
      setResp({ ok: false, error: e.message })
    } finally {
      setLoading(false)
      setImageLoading(false)
    }
  }, [additionalQuestion, currentFollowup, followups, transitPayload, computeGraphicSize, computeCacheKey, displayChartBlob, chartImage, persistPayload, activeInterpretationId])

  // Pending auto-fetch from sessionStorage hydration
  useEffect(() => {
    if (!hydrated) return
    if (pendingAutoFetchRef.current) {
      pendingAutoFetchRef.current = false
      fetchTransits()
    }
  }, [hydrated, fetchTransits])

  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const baseSummary = resp && (resp.data && (resp.data.summary || resp.data.summary_html))
    ? (resp.data.summary || resp.data.summary_html)
    : 'Kein Summary vorhanden'
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError ? '' : (loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

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
    if (content) { setCachedSummary(content); setShowSummary(true) }
    if (interp.interp_year && interp.interp_month && interp.interp_day) {
      const y = interp.interp_year, m = interp.interp_month, d = interp.interp_day
      const hh = interp.interp_hour ?? 0, mm = interp.interp_minute ?? 0
      setTyear(y); setTmonth(m); setTday(d); setThour(hh); setTminute(mm); setTsecond(0)
      setTdatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, 0))
    }
    const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
    if (firstUserMsg?.content) setAdditionalQuestion(firstUserMsg.content)
    const followupMsgs = (interp.messages || [])
      .filter(m => m.role === 'user' && m.position > 1)
      .sort((a, b) => a.position - b.position)
    setFollowups(followupMsgs.map(m => ({ question: m.content })))
    setCurrentFollowup('')
  }

  const pageState = {
    resp, setResp,
    year: byear, setYear: setByear,
    month: bmonth, setMonth: setBmonth,
    day: bday, setDay: setBday,
    hour: bhour, setHour: setBhour,
    minute: bminute, setMinute: setBminute,
    second: bsecond, setSecond: setBsecond,
    timezone: btimezone, setTimezone: setBtimezone,
    latitude: blat, setLatitude: setBlat,
    longitude: blon, setLongitude: setBlon,
    datetimeLocal: bdatetimeLocal, setDatetimeLocal: setBdatetimeLocal,
    showAdvanced: false,
    setShowAdvanced: () => {},
    cachedSummary, setCachedSummary,
    showSummary, setShowSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow,
    profile,
    selectedPerson,
    startStream: null,
    isStreaming: false,
    loading: loading || imageLoading,
    chartImage, imageLoading, imageError,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
    maxFollowupsReached: followups.length >= 10,
    summaryRef,
    summaryError, summaryText,
  }

  return (
    <InterpretationPage
      title="Transite"
      wikiPageName="Transite"
      wikiOriginPage="transits"
      wikiOriginLabel="Transite"
      historyContextType="transits"
      interpretButtonLabel="Transite Interpretieren"
      chartMarginTop={-136}
      chartLoadingMessage="Transit-Chart wird gerendert…"
      chartFallbackMessage="Klicke auf «Transite Interpretieren», um das Chart rechts neben dem Formular anzuzeigen."
      onInterpret={fetchTransits}
      onHistoryLoad={handleHistoryLoad}
      imageObjectFit="cover"
      chartMinHeight={420}
      questionPlaceholder="Optional: Welche konkrete Transit-Frage soll die KI zusätzlich beantworten?"
      state={pageState}
    >
      <h4 style={{ marginTop: 2, marginBottom: 2 }}>Transit</h4>
      <label style={{ marginBottom: 20, marginRight: 20 }}>Datum &amp; Uhrzeit</label>
      <Flatpickr
        value={tdatetimeLocal}
        options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
        style={{ width: '100%', maxWidth: 395 }}
        onChange={(dates) => {
          const date = dates && dates[0]
          if (!date) return
          const y = date.getFullYear(); const m = date.getMonth() + 1; const d = date.getDate()
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
        <input style={{ color: 'black' }} value={ttimezone} onChange={e => setTtimezone(e.target.value)} />
        <label>Lat</label>
        <input value={tlat} onChange={e => setTlat(e.target.value)} />
        <label>Lon</label>
        <input value={tlon} onChange={e => setTlon(e.target.value)} />
        <label style={{ marginTop: 12 }}>Filter planets (comma-separated names or ids)</label>
        <input value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
    </InterpretationPage>
  )
}

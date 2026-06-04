import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import InterpretationPage from '../components/InterpretationPage'
import { useInterpretationPage } from '../hooks/useInterpretationPage'
import { useLogoutCleanup } from '../utils/logoutCache'
import { postWithSignal } from '../services/api'
import { streamInterpret } from '../hooks/useInterpretationStream'
import { streamFollowup } from '../hooks/useInterpretations'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'

const sharedSolarReturnCache = new Map()
const STORAGE_KEY = 'astronex_solar_return_payload'

export default function SolarReturn() {
  const hookState = useInterpretationPage({
    graphicEndpoint: '/solar-return/graphic',
    cacheKeyPrefix: 'solar-return',
  })

  const [localLoading, setLocalLoading] = useState(false)
  const [graphicSrc, setGraphicSrc] = useState('')
  const [graphicError, setGraphicError] = useState('')
  const [targetYear, setTargetYear] = useState(new Date().getFullYear())
  const [hydrated, setHydrated] = useState(false)
  const followupBaseRef = useRef('')
  const localSummaryRef = useRef(null)
  const chartCacheRef = useRef(sharedSolarReturnCache)
  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)

  const {
    profile, selectedPerson,
    year: birthYear, setYear: setBirthYear,
    month: birthMonth, setMonth: setBirthMonth,
    day: birthDay, setDay: setBirthDay,
    hour: birthHour, setHour: setBirthHour,
    minute: birthMinute, setMinute: setBirthMinute,
    second: birthSecond, setSecond: setBirthSecond,
    timezone, setTimezone, latitude, setLatitude, longitude, setLongitude,
    datetimeLocal, setDatetimeLocal,
    resp, setResp,
    cachedSummary, setCachedSummary, showSummary, setShowSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
  } = hookState

  const availableTargetYears = useMemo(() => {
    const normalizedBirthYear = Number(birthYear)
    const currentYear = new Date().getFullYear()
    const startYear = Number.isFinite(normalizedBirthYear) ? normalizedBirthYear : currentYear
    const endYear = Math.max(startYear, currentYear + 20)
    const years = []
    for (let y = startYear; y <= endYear; y++) years.push(y)
    if (!years.includes(currentYear)) { years.push(currentYear); years.sort((a, b) => a - b) }
    return years
  }, [birthYear])

  const currentPayload = useMemo(() => ({
    person_id: selectedPerson?.id ?? null,
    birth_year: parseInt(birthYear, 10),
    birth_month: parseInt(birthMonth, 10),
    birth_day: parseInt(birthDay, 10),
    birth_hour: parseInt(birthHour, 10),
    birth_minute: parseInt(birthMinute, 10),
    birth_second: parseInt(birthSecond, 10),
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    target_year: parseInt(targetYear, 10),
    timezone,
    datetime: datetimeLocal || undefined,
  }), [selectedPerson?.id, birthYear, birthMonth, birthDay, birthHour, birthMinute, birthSecond, latitude, longitude, targetYear, timezone, datetimeLocal])

  const computeCacheKey = useCallback((payload) => {
    const subjectId = selectedPerson?.id || profile?.id || 'manual'
    return JSON.stringify({ type: 'solar-return', subjectId, ...payload })
  }, [profile?.id, selectedPerson?.id])

  const persistPayload = useCallback((payload) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ payload, datetimeLocal }))
  }, [datetimeLocal])

  const displayGraphic = useCallback((src) => {
    setGraphicError('')
    setGraphicSrc(src)
  }, [])

  const handleLogoutCleanup = useCallback(() => {
    chartCacheRef.current.clear()
    setResp(null)
    setGraphicSrc('')
    setGraphicError('')
    setHydrated(false)
    setCachedSummary('')
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
    graphicAbortRef.current = null
  }, [])
  useLogoutCleanup(handleLogoutCleanup)

  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return }
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const { payload, datetimeLocal: storedDatetime } = JSON.parse(raw)
        if (payload) {
          if (payload.birth_year !== undefined) setBirthYear(payload.birth_year)
          if (payload.birth_month !== undefined) setBirthMonth(payload.birth_month)
          if (payload.birth_day !== undefined) setBirthDay(payload.birth_day)
          if (payload.birth_hour !== undefined) setBirthHour(payload.birth_hour)
          if (payload.birth_minute !== undefined) setBirthMinute(payload.birth_minute)
          if (payload.birth_second !== undefined) setBirthSecond(payload.birth_second)
          if (payload.latitude !== undefined) setLatitude(payload.latitude)
          if (payload.longitude !== undefined) setLongitude(payload.longitude)
          if (payload.target_year !== undefined) setTargetYear(payload.target_year)
          if (payload.timezone !== undefined) setTimezone(payload.timezone)
        }
        if (storedDatetime) setDatetimeLocal(String(storedDatetime).replace('T', ' '))
      } catch (err) { console.error('Failed to hydrate solar return form', err) }
    }
    setHydrated(true)
  }, [])

  // Sync person/profile birth data into form fields when selection changes
  useEffect(() => {
    const data = selectedPerson || profile
    if (!data) return
    if (data.birth_latitude != null) setLatitude(data.birth_latitude)
    if (data.birth_longitude != null) setLongitude(data.birth_longitude)
    if (data.birth_year) {
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      setBirthYear(y); setBirthMonth(m); setBirthDay(d)
      setBirthHour(hh); setBirthMinute(mm); setBirthSecond(ss)
      setDatetimeLocal(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`)
    }
    if (data.birth_timezone) setTimezone(data.birth_timezone)
    setActiveInterpretationId(null)
    setCachedSummary('')
    setShowSummary(false)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [profile, selectedPerson])

  useEffect(() => {
    if (!availableTargetYears.length) return
    if (availableTargetYears.includes(Number(targetYear))) return
    setTargetYear(availableTargetYears[0])
  }, [availableTargetYears, targetYear])

  useEffect(() => {
    if (!hydrated) return
    const key = computeCacheKey(currentPayload)
    if (!key) return
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      displayGraphic(cached.graphic)
      activeChartCacheKeyRef.current = key
      persistPayload(currentPayload)
    } else {
      setGraphicSrc('')
      activeChartCacheKeyRef.current = null
      let cancelled = false
      const fetchAutoGraphic = async () => {
        setGraphicError('')
        try {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
          const graphicSize = Math.min(1200, Math.round(750 * Math.max(1, ratio)))
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
          if (err.name !== 'AbortError' && !cancelled) {
            setGraphicError(err.message || 'Graphic konnte nicht geladen werden')
          }
        }
      }
      fetchAutoGraphic()
      return () => { cancelled = true }
    }
  }, [currentPayload, computeCacheKey, displayGraphic, hydrated, persistPayload])

  const fetchSolar = useCallback(async () => {
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)
    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || followups.length >= 10) return
      setLocalLoading(true)
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
      } finally { setLocalLoading(false) }
      return
    }

    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload
    const cacheKey = computeCacheKey(currentPayload)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!graphicSrc && activeChartCacheKeyRef.current === cacheKey

    setLocalLoading(true); setResp(null)
    setGraphicError('')
    setCachedSummary('')
    setShowSummary(true)

    try {
      if (!cachedGraphic && !hasCurrentGraphic) {
        setGraphicSrc('')
        activeChartCacheKeyRef.current = null
      }

      let streamedSummary = ''
      let metaData = null
      await streamInterpret('/solar-return/stream', payload, {
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

      if (cachedGraphic) {
        if (!hasCurrentGraphic) displayGraphic(cachedGraphic.graphic)
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
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
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
            }
            graphicAbortRef.current = null
          }
        } catch (imgErr) {
          if (imgErr.name !== 'AbortError') throw imgErr
        }
      }
    } catch (e) {
      setResp({ ok: false, error: e.message })
    }
    setLocalLoading(false)
  }, [additionalQuestion, currentFollowup, followups, currentPayload, computeCacheKey, graphicSrc, displayGraphic, persistPayload, activeInterpretationId])

  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const baseSummary = resp && (resp.data && (resp.data.summary || resp.data.summary_html))
    ? (resp.data.summary || resp.data.summary_html)
    : 'Kein Summary vorhanden'
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError ? '' : (localLoading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  const pageState = {
    ...hookState,
    loading: localLoading,
    chartImage: graphicSrc,
    imageLoading: false,
    imageError: graphicError,
    summaryRef: localSummaryRef,
    summaryError, summaryText,
  }

  return (
    <InterpretationPage
      title="Solar Jahr"
      wikiPageName="Solar Jahr"
      wikiOriginPage="solar"
      wikiOriginLabel="Solar Jahr"
      historyContextType="solar"
      interpretButtonLabel="Solar Jahr interpretieren"
      chartLoadingMessage="Solar Jahr wird gerendert…"
      chartFallbackMessage='Klicke auf "Solar Jahr interpretieren", um das Diagramm rechts neben dem Formular anzuzeigen.'
      onInterpret={fetchSolar}
      state={pageState}
      chartMarginTop={-102}
      chartMinHeight={420}
      chartHistoryYearOnly
      questionPlaceholder="Optional: Worauf soll die KI beim Solarjahr besonders eingehen?"
    >
      <label style={{ marginBottom: 20, marginRight: 20 }}>Target Year</label>
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
        style={{ padding: '4px 4px', marginBottom: 6 }}
      >
        {availableTargetYears.map(yearOption => (
          <option key={`solar-return-target-year-${yearOption}`} value={yearOption}>{yearOption}</option>
        ))}
      </select>
    </InterpretationPage>
  )
}

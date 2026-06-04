import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import InterpretationPage from '../components/InterpretationPage'
import { useInterpretationPage } from '../hooks/useInterpretationPage'
import { useLogoutCleanup } from '../utils/logoutCache'
import { postWithSignal } from '../services/api'
import { streamInterpret } from '../hooks/useInterpretationStream'
import { streamFollowup, deleteInterpretation } from '../hooks/useInterpretations'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'
import { formatDateTimeValue } from '../utils/dateTime'

const sharedHousesCache = new Map()
const STORAGE_KEY = 'astronex_houses_chart_payload'

export default function Houses() {
  const hookState = useInterpretationPage({
    graphicEndpoint: '/houses/graphic',
    cacheKeyPrefix: 'houses',
  })

  const [localLoading, setLocalLoading] = useState(false)
  const [chartImage, setChartImage] = useState(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const followupBaseRef = useRef('')
  const imageUrlRef = useRef(null)
  const chartCacheRef = useRef(sharedHousesCache)
  const graphicAbortRef = useRef(null)
  const localSummaryRef = useRef(null)

  const {
    profile, authInitialized, selectedPerson,
    year, setYear, month, setMonth, day, setDay,
    hour, setHour, minute, setMinute, second, setSecond,
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
    return JSON.stringify({ type: 'houses', subjectId, ...payload, width: size, height: size })
  }, [profile?.id, selectedPerson?.id])

  const persistPayload = useCallback((payload) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, datetimeLocal }))
  }, [datetimeLocal])

  const displayChartBlob = useCallback((blob) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
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
    if (typeof window === 'undefined') {
      setHydrated(true)
      return
    }
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
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
      } catch (_) { }
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const size = computeGraphicSize()
    const key = computeCacheKey(currentPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      setImageError('')
      displayChartBlob(cached.blob)
      persistPayload(currentPayload)
    } else {
      setChartImage(null)
      setCachedSummary('')
      const fetchAutoGraphic = async () => {
        setImageLoading(true)
        setImageError('')
        try {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
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
          const graphicResp = await postWithSignal(`/houses/graphic?width=${reqSize}&height=${reqSize}`, currentPayload, controller.signal)
          if (!graphicResp.ok) {
            throw new Error(`Graphic request failed (${graphicResp.status})`)
          }
          const blob = await graphicResp.blob()
          chartCacheRef.current.set(cacheKey, { blob })
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            displayChartBlob(blob)
            persistPayload(currentPayload)
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
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
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
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
  }, [])

  const fetchHouses = useCallback(async () => {
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
      } finally {
        setLocalLoading(false)
      }
      return
    }

    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(payload, reqSize)
    const cached = chartCacheRef.current.get(cacheKey)

    setLocalLoading(true)
    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)

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

    try {
      let streamedSummary = ''
      let metaData = null
      await streamInterpret('/houses/stream', payload, {
        onMeta: (data) => {
          metaData = data
          setResp({ ok: true, data: { ...data, summary: streamedSummary } })
        },
        onSummaryDelta: (content) => {
          streamedSummary += content
          setCachedSummary(streamedSummary)
          setResp((prev) => {
            const baseData = prev?.data || metaData || {}
            return { ok: true, data: { ...baseData, summary: streamedSummary } }
          })
        },
        onDone: (summary) => {
          streamedSummary = summary || streamedSummary
          setCachedSummary(streamedSummary)
          setResp((prev) => {
            const baseData = prev?.data || metaData || {}
            return { ok: true, data: { ...baseData, summary: streamedSummary } }
          })
        },
        onSaved: (id) => setActiveInterpretationId(id),
      })

      try {
        const summaryText = streamedSummary || 'Kein Summary vorhanden'
        if (skipGraphic) {
          setCachedSummary(summaryText)
          persistPayload(payload)
        } else {
          try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
          const controller = new AbortController()
          graphicAbortRef.current = controller
          const graphicResp = await postWithSignal(`/houses/graphic?width=${reqSize}&height=${reqSize}`, payload, controller.signal)
          if (!graphicResp.ok) throw new Error(`Graphic request failed (${graphicResp.status})`)
          const blob = await graphicResp.blob()
          chartCacheRef.current.set(cacheKey, { blob })
          setCachedSummary(summaryText)
          const currentKey = computeCacheKey(currentPayload, reqSize)
          if (currentKey === cacheKey) {
            displayChartBlob(blob)
            persistPayload(payload)
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
    } catch (e) {
      setResp({ ok: false, error: e.message })
    } finally {
      setLocalLoading(false)
      setImageLoading(false)
    }
  }, [additionalQuestion, currentFollowup, followups, currentPayload, computeGraphicSize, computeCacheKey, displayChartBlob, persistPayload, activeInterpretationId])

  const passiveSummary = resp
    ? resp.data
      ? typeof resp.data === 'string'
        ? resp.data
        : resp.data.summary || resp.data.summary_html || 'Kein Summary vorhanden'
      : resp.error || 'Kein Summary vorhanden'
    : ''
  const summaryError = resp && resp.ok === false ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden') : ''
  const summaryContent = cachedSummary || passiveSummary
  const summaryText = summaryError ? '' : (localLoading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  const pageState = {
    ...hookState,
    loading: localLoading || imageLoading,
    chartImage, imageLoading, imageError,
    summaryRef: localSummaryRef,
    summaryError, summaryText,
  }

  return (
    <InterpretationPage
      title="Häuser"
      wikiPageName="Häuser"
      wikiOriginPage="houses"
      wikiOriginLabel="Häuser"
      historyContextType="houses"
      interpretButtonLabel="Häuser Positionen interpretieren"
      chartLoadingMessage="Die Häusergrafik wird gerendert…"
      chartFallbackMessage="Klicke auf «Häuser Positionen interpretieren», um die Häusergrafik rechts neben dem Formular anzuzeigen."
      onInterpret={fetchHouses}
      imageObjectFit="cover"
      chartMinHeight={420}
      questionPlaceholder="Optional: Worauf soll die KI bei der Häuser-Interpretation besonders achten?"
      state={pageState}
    />
  )
}

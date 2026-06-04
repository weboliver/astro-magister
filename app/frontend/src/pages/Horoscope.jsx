import React, { useEffect, useRef, useCallback, useMemo } from 'react'
import { useInterpretationPage } from '../hooks/useInterpretationPage'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationPage from '../components/InterpretationPage'

export default function Horoscope() {
  const state = useInterpretationPage({
    graphicEndpoint: '/horoscope/graphic',
    cacheKeyPrefix: 'horoscope',
  })

  const { selectedPerson } = usePersonSelection()

  const {
    year, month, day, hour, minute, second,
    timezone, latitude, longitude,
    profile, authInitialized,
    startStream, loading,
    resp, setResp, cachedSummary, setCachedSummary,
    showSummary, setShowSummary, additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    chartImage, imageError, setImageError, setChartImage,
    displayChartBlob, computeGraphicSize, computeCacheKey,
    chartCacheRef, graphicAbortRef, activeChartCacheKeyRef, imageUrlRef,
    fetchGraphic,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
    submitFollowup, maxFollowupsReached,
    streamedSummaryRef, hasInitializedSelectionResetRef,
  } = state

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

  // Form population from selected person or profile
  useEffect(() => {
    const data = selectedPerson || profile
    if (!data) return
    if (data && data.birth_latitude !== undefined && data.birth_latitude !== null) state.setLatitude(data.birth_latitude)
    if (data && data.birth_longitude !== undefined && data.birth_longitude !== null) state.setLongitude(data.birth_longitude)
    if (data && data.birth_year) {
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      state.setYear(y); state.setMonth(m); state.setDay(d); state.setHour(hh); state.setMinute(mm); state.setSecond(ss)
      state.setDatetimeLocal(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`)
    }
    if (data && data.birth_timezone) {
      state.setTimezone(data.birth_timezone)
    }
    setActiveInterpretationId(null)
    setCachedSummary('')
    setShowSummary(false)
    setAdditionalQuestion('')
    setFollowups([])
    setCurrentFollowup('')
  }, [profile, selectedPerson])

  // Auto-fetch chart graphic when payload changes
  useEffect(() => {
    if (!selectedPerson && !authInitialized) return

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
        return
      }
    }

    const key = computeCacheKey(currentPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      state.setImageError('')
      displayChartBlob(cached.blob)
      activeChartCacheKeyRef.current = key
    } else {
      setChartImage(null)
      setCachedSummary('')
      fetchGraphic(currentPayload)
    }
  }, [authInitialized, currentPayload, computeCacheKey, computeGraphicSize, displayChartBlob, profile, selectedPerson, fetchGraphic, chartCacheRef, activeChartCacheKeyRef])

  // Selection change: clear previous chart and interpretation state
  useEffect(() => {
    if (!hasInitializedSelectionResetRef.current) {
      hasInitializedSelectionResetRef.current = true
      return
    }
    const previousUrl = imageUrlRef.current
    imageUrlRef.current = null
    try { if (graphicAbortRef.current) graphicAbortRef.current.abort() } catch (e) { }
    graphicAbortRef.current = null
    setChartImage(null)
    activeChartCacheKeyRef.current = null
    setImageError('')
    setCachedSummary('')
    setShowSummary(false)
    setFollowups([])
    setCurrentFollowup('')
    try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch (_) { }
  }, [selectedPerson?.id, profile?.id])

  const handleInterpret = useCallback(async () => {
    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(currentPayload, reqSize)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!chartImage && activeChartCacheKeyRef.current === cacheKey
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)

    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || maxFollowupsReached) return

      setShowSummary(true)
      streamedSummaryRef.current = ''

      await submitFollowup(activeInterpretationId, normalizedFollowup, cachedSummary, {
        onDelta: (fullContent) => {
          setCachedSummary(fullContent)
        },
        onDone: () => {},
        onError: (err) => {
          setResp({ ok: false, error: err.message })
        },
      })
      return
    }

    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)
    streamedSummaryRef.current = ''

    const payload = normalizedAdditionalQuestion
      ? { ...currentPayload, additional_question: normalizedAdditionalQuestion }
      : currentPayload

    if (!cachedGraphic && !hasCurrentGraphic) {
      const previousUrl = imageUrlRef.current
      setChartImage(null)
      imageUrlRef.current = null
      activeChartCacheKeyRef.current = null
      try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch (_) {}
    }

    await startStream('/horoscope/stream', payload, {
      onMeta: (metaData) => {
        setResp({ ok: true, status: 200, data: { ...metaData, summary: streamedSummaryRef.current } })
      },
      onSummaryDelta: (content) => {
        streamedSummaryRef.current += content
        setCachedSummary(streamedSummaryRef.current)
        setResp(prev => {
          const baseData = prev?.data || {}
          return { ok: true, status: 200, data: { ...baseData, summary: streamedSummaryRef.current } }
        })
      },
      onDone: (fullSummary) => {
        const final = fullSummary || streamedSummaryRef.current
        streamedSummaryRef.current = final
        setCachedSummary(final)
        setResp(prev => {
          const baseData = prev?.data || {}
          return { ok: true, status: 200, data: { ...baseData, summary: final } }
        })
      },
      onSaved: (interpretationId) => {
        setActiveInterpretationId(interpretationId)
      },
      onError: (err) => {
        setResp({ ok: false, error: err.message })
      },
    })

    const postCached = chartCacheRef.current.get(cacheKey)
    if (postCached) {
      if (!hasCurrentGraphic) {
        displayChartBlob(postCached.blob)
      }
      activeChartCacheKeyRef.current = cacheKey
    } else if (hasCurrentGraphic) {
      activeChartCacheKeyRef.current = cacheKey
    } else {
      await fetchGraphic(payload)
    }
  }, [
    currentPayload, computeGraphicSize, computeCacheKey, chartImage,
    activeChartCacheKeyRef, additionalQuestion, activeInterpretationId,
    currentFollowup, maxFollowupsReached, cachedSummary,
    submitFollowup, startStream, chartCacheRef, imageUrlRef,
    displayChartBlob, fetchGraphic, setChartImage, setImageError,
  ])

  return (
    <InterpretationPage
      title="Horoskop"
      wikiPageName="Horoskop"
      wikiOriginPage="horoscope"
      wikiOriginLabel="Horoskop"
      historyContextType="horoscope"
      interpretButtonLabel="Horoskop interpretieren"
      interpretButtonLoadingLabel=""
      chartLoadingMessage="Horoskop wird gerendert…"
      chartFallbackMessage="Klicke auf «Horoskop interpretieren», um das Chart rechts neben dem Formular anzuzeigen und eine Auswertung zu erhalten."
      onInterpret={handleInterpret}
      state={state}
    />
  )
}

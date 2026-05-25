import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useInterpretationPage } from '../hooks/useInterpretationPage'
import { useSynastrySelection } from '../contexts/SynastrySelectionContext'
import { normalizeAdditionalQuestion } from '../utils/aiPrompt'
import InterpretationPage from '../components/InterpretationPage'
import PersonSelector from '../components/PersonSelector'
import SynastrieControls from '../components/SynastrieControls'

export default function Synastrie() {
  const state = useInterpretationPage({
    graphicEndpoint: '/synastry/graphic',
    cacheKeyPrefix: 'synastry',
  })

  const selectionA = useSynastrySelection('A')
  const selectionB = useSynastrySelection('B')
  const selectedPersonA = selectionA.selectedPerson
  const selectedPersonB = selectionB.selectedPerson

  const [comparisonMode, setComparisonMode] = useState('hh')
  const [samePersonWarning, setSamePersonWarning] = useState(false)
  const isLoadingHistoryRef = useRef(false)
  const [historyLoadingClearToken, setHistoryLoadingClearToken] = useState(0)

  const {
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

  const currentPayload = useMemo(() => {
    const a = selectedPersonA || profile || {}
    const b = selectedPersonB || profile || {}
    return {
      person_a_id: selectedPersonA?.id ?? null,
      person_a_name: selectedPersonA?.name || profile?.name || localStorage.getItem('username') || 'Person A',
      person_a_year: a.birth_year ?? 0,
      person_a_month: a.birth_month ?? 1,
      person_a_day: a.birth_day ?? 1,
      person_a_hour: a.birth_hour ?? 12,
      person_a_minute: a.birth_minute ?? 0,
      person_a_second: a.birth_second ?? 0,
      person_a_timezone: a.birth_timezone ?? null,
      person_a_latitude: a.birth_latitude ?? 0,
      person_a_longitude: a.birth_longitude ?? 0,
      person_b_id: selectedPersonB?.id ?? null,
      person_b_name: selectedPersonB?.name || 'Person B',
      person_b_year: b.birth_year ?? 0,
      person_b_month: b.birth_month ?? 1,
      person_b_day: b.birth_day ?? 1,
      person_b_hour: b.birth_hour ?? 12,
      person_b_minute: b.birth_minute ?? 0,
      person_b_second: b.birth_second ?? 0,
      person_b_timezone: b.birth_timezone ?? null,
      person_b_latitude: b.birth_latitude ?? 0,
      person_b_longitude: b.birth_longitude ?? 0,
      comparison_mode: comparisonMode,
    }
  }, [selectedPersonA, selectedPersonB, comparisonMode, profile])

  useEffect(() => {
    if (selectedPersonA?.id && selectedPersonB?.id && selectedPersonA.id === selectedPersonB.id) {
      setSamePersonWarning(true)
    } else {
      setSamePersonWarning(false)
    }
  }, [selectedPersonA?.id, selectedPersonB?.id])

  useEffect(() => {
    const data = selectedPersonA || profile
    if (!data) return
    if (data?.birth_latitude != null) state.setLatitude(data.birth_latitude)
    if (data?.birth_longitude != null) state.setLongitude(data.birth_longitude)
    if (data?.birth_year) {
      const y = data.birth_year || 0
      const m = data.birth_month || 1
      const d = data.birth_day || 1
      const hh = data.birth_hour || 0
      const mm = data.birth_minute || 0
      const ss = data.birth_second || 0
      state.setYear(y); state.setMonth(m); state.setDay(d)
      state.setHour(hh); state.setMinute(mm); state.setSecond(ss)
      state.setDatetimeLocal(
        `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      )
    }
    if (data?.birth_timezone) state.setTimezone(data.birth_timezone)
    if (!isLoadingHistoryRef.current) {
      setActiveInterpretationId(null)
      setCachedSummary('')
      setShowSummary(false)
      setAdditionalQuestion('')
      setFollowups([])
      setCurrentFollowup('')
    }
  }, [profile, selectedPersonA])

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
    if (!isLoadingHistoryRef.current) {
      setShowSummary(false)
      setFollowups([])
      setCurrentFollowup('')
    }
    try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch (_) { }
  }, [selectedPersonA?.id, selectedPersonB?.id, comparisonMode, profile?.id])

  useEffect(() => {
    if (!selectedPersonA && !authInitialized) return
    if (!selectedPersonA && !profile?.birth_year) return

    const idsPayload = {
      person_a_id: selectedPersonA?.id ?? null,
      person_a_name: selectedPersonA?.name || profile?.name || localStorage.getItem('username') || 'Person A',
      person_b_id: selectedPersonB?.id ?? null,
      person_b_name: selectedPersonB?.name || 'Person B',
      comparison_mode: comparisonMode,
    }

    const size = computeGraphicSize()
    const key = computeCacheKey(idsPayload, size)
    const cached = chartCacheRef.current.get(key)
    if (cached) {
      state.setImageError('')
      displayChartBlob(cached.blob)
      activeChartCacheKeyRef.current = key
    } else {
      if (!isLoadingHistoryRef.current) {
        setCachedSummary('')
      }
      setChartImage(null)
      fetchGraphic(idsPayload)
    }
  }, [authInitialized, selectedPersonA, selectedPersonB, comparisonMode, computeCacheKey, computeGraphicSize, displayChartBlob, fetchGraphic, chartCacheRef, activeChartCacheKeyRef, isLoadingHistoryRef])

  useEffect(() => {
    if (!isLoadingHistoryRef.current) {
      setShowSummary(false)
      setFollowups([])
      setCurrentFollowup('')
    }
  }, [comparisonMode])

  useEffect(() => {
    if (historyLoadingClearToken > 0) {
      isLoadingHistoryRef.current = false
    }
  }, [historyLoadingClearToken])

  const handleInterpret = useCallback(async () => {
    const idsPayload = {
      person_a_id: selectedPersonA?.id ?? null,
      person_a_name: selectedPersonA?.name || profile?.name || localStorage.getItem('username') || 'Person A',
      person_b_id: selectedPersonB?.id ?? null,
      person_b_name: selectedPersonB?.name || 'Person B',
      comparison_mode: comparisonMode,
    }

    const reqSize = computeGraphicSize()
    const cacheKey = computeCacheKey(idsPayload, reqSize)
    const cachedGraphic = chartCacheRef.current.get(cacheKey)
    const hasCurrentGraphic = !!chartImage && activeChartCacheKeyRef.current === cacheKey
    const normalizedAdditionalQuestion = normalizeAdditionalQuestion(additionalQuestion)

    if (activeInterpretationId) {
      const normalizedFollowup = normalizeAdditionalQuestion(currentFollowup)
      if (!normalizedFollowup || maxFollowupsReached) return

      setShowSummary(true)
      streamedSummaryRef.current = ''

      await submitFollowup(activeInterpretationId, normalizedFollowup, cachedSummary, {
        onDelta: (fullContent) => { setCachedSummary(fullContent) },
        onDone: () => {},
        onError: (err) => { setResp({ ok: false, error: err.message }) },
      })
      return
    }

    if (samePersonWarning) return

    setResp(null)
    setImageError('')
    setCachedSummary('')
    setShowSummary(true)
    streamedSummaryRef.current = ''

    const payload = normalizedAdditionalQuestion
      ? { ...idsPayload, additional_question: normalizedAdditionalQuestion }
      : idsPayload

    if (!cachedGraphic && !hasCurrentGraphic) {
      const previousUrl = imageUrlRef.current
      setChartImage(null)
      imageUrlRef.current = null
      activeChartCacheKeyRef.current = null
      try { if (previousUrl) URL.revokeObjectURL(previousUrl) } catch (_) {}
    }

    await startStream('/synastry/stream', payload, {
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
      onSaved: (interpretationId) => { setActiveInterpretationId(interpretationId) },
      onError: (err) => { setResp({ ok: false, error: err.message }) },
    })

    const postCached = chartCacheRef.current.get(cacheKey)
    if (postCached) {
      if (!hasCurrentGraphic) displayChartBlob(postCached.blob)
      activeChartCacheKeyRef.current = cacheKey
    } else if (hasCurrentGraphic) {
      activeChartCacheKeyRef.current = cacheKey
    } else {
      await fetchGraphic(idsPayload)
    }
  }, [
    selectedPersonA, selectedPersonB, comparisonMode,
    computeGraphicSize, computeCacheKey, chartImage,
    activeChartCacheKeyRef, additionalQuestion, activeInterpretationId,
    currentFollowup, maxFollowupsReached, cachedSummary, samePersonWarning,
    submitFollowup, startStream, chartCacheRef, imageUrlRef,
    displayChartBlob, fetchGraphic, setChartImage, setImageError,
  ])

  const handleHistoryLoad = async (interp) => {
    isLoadingHistoryRef.current = true
    setActiveInterpretationId(interp.id)
    if (interp.user_persons_id) {
      selectionA.selectPersonId(interp.user_persons_id)
    } else {
      selectionA.selectPersonId(null)
    }
    if (interp.interp_year) state.setYear(interp.interp_year)
    if (interp.interp_month) state.setMonth(interp.interp_month)
    if (interp.interp_day) state.setDay(interp.interp_day)
    if (interp.interp_hour != null) state.setHour(interp.interp_hour)
    if (interp.interp_minute != null) state.setMinute(interp.interp_minute)
    if (interp.location_latitude != null) state.setLatitude(interp.location_latitude)
    if (interp.location_longitude != null) state.setLongitude(interp.location_longitude)
    setComparisonMode(interp.comparison_mode || 'hh')
    if (interp.user_person_id_2) {
      selectionB.selectPersonId(interp.user_person_id_2)
    } else {
      selectionB.selectPersonId(null)
    }
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
    if (content) {
      setCachedSummary(content)
      setTimeout(() => setShowSummary(true), 100)
    }
    setHistoryLoadingClearToken(t => t + 1)
    const firstUserMsg = (interp.messages || []).find(m => m.role === 'user')
    if (firstUserMsg?.content) state.setAdditionalQuestion(firstUserMsg.content)
    const followupMsgs = (interp.messages || [])
      .filter(m => m.role === 'user' && m.position > 1)
      .sort((a, b) => a.position - b.position)
    setFollowups(followupMsgs.map(m => ({ question: m.content })))
    setCurrentFollowup('')
  }

  return (
    <InterpretationPage
      title="Synastrie"
      wikiPageName="Synastrie"
      wikiOriginPage="synastrie"
      wikiOriginLabel="Synastrie"
      historyContextType="synastry"
      interpretButtonLabel="Synastrie interpretieren"
      chartLoadingMessage="Synastrie wird gerendert…"
      chartFallbackMessage="Wähle zwei Personen aus, um das Vergleichs-Diagramm anzuzeigen und eine Partneranalyse zu erhalten."
      onInterpret={handleInterpret}
      onHistoryLoad={handleHistoryLoad}
      historyUserPersonsId={selectedPersonA?.id ?? null}
      hidePersonSelector
      interpretDisabled={(!selectedPersonA && !profile?.birth_year) || (!selectedPersonB && !profile?.birth_year) || samePersonWarning}
      chartMarginTop={-285}
      state={state}
    >
      <PersonSelector label="Person A" helperText="Erste Person für den Vergleich wählen" index="A" labelColor="#1a56db" />
      <PersonSelector label="Person B" helperText="Zweite Person für den Vergleich wählen" index="B" labelColor="#9b1b30" excludeUserPersonId={profile?.id} hideOwnProfile />
      <SynastrieControls
        comparisonMode={comparisonMode}
        onComparisonModeChange={setComparisonMode}
        isStreaming={state.isStreaming}
        personASelected={!!selectedPersonA}
        personBSelected={!!selectedPersonB}
        samePerson={samePersonWarning}
      />
    </InterpretationPage>
  )
}

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useLogoutCleanup } from '../utils/logoutCache'
import { formatDateTimeValue } from '../utils/dateTime'
import { useInterpretationStream } from './useInterpretationStream'
import { useChartCache } from './useChartCache'
import { useFollowupManager } from './useFollowupManager'

export function useInterpretationPage({ graphicEndpoint, cacheKeyPrefix }) {
  const [resp, setResp] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [day, setDay] = useState(new Date().getDate())
  const [hour, setHour] = useState(12)
  const [minute, setMinute] = useState(0)
  const [second, setSecond] = useState(0)
  const [latitude, setLatitude] = useState(52.52)
  const [longitude, setLongitude] = useState(13.4050)
  const [timezone, setTimezone] = useState(
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  )
  const [datetimeLocal, setDatetimeLocal] = useState('')
  const [cachedSummary, setCachedSummary] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [additionalQuestion, setAdditionalQuestion] = useState('')
  const [activeInterpretationId, setActiveInterpretationId] = useState(null)
  const [dropdownRefreshToken, setDropdownRefreshToken] = useState(0)
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 800 : false
  )

  const { profile, initialized: authInitialized } = useAuth()
  const prevProfileIdRef = useRef(profile?.id)
  const { selectedPerson } = usePersonSelection()

  useEffect(() => {
    const source = selectedPerson || profile
    if (source?.birth_year) {
      setYear(source.birth_year)
      setMonth(source.birth_month || 1)
      setDay(source.birth_day || 1)
      setHour(source.birth_hour ?? 12)
      setMinute(source.birth_minute ?? 0)
      setSecond(source.birth_second ?? 0)
      if (source.birth_latitude != null) setLatitude(source.birth_latitude)
      if (source.birth_longitude != null) setLongitude(source.birth_longitude)
      if (source.birth_timezone) setTimezone(source.birth_timezone)
    }
  }, [selectedPerson, profile])

  const { startStream, isStreaming } = useInterpretationStream()

  const chartHooks = useChartCache({ graphicEndpointPath: graphicEndpoint, cacheKeyPrefix })

  const followupHooks = useFollowupManager()

  const loading = isStreaming || followupHooks.isFollowupLoading

  const streamedSummaryRef = useRef('')
  const summaryRef = useRef(null)
  const hasInitializedSelectionResetRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setIsNarrow(window.innerWidth < 800)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    return () => {
      if (chartHooks.imageUrlRef.current) {
        URL.revokeObjectURL(chartHooks.imageUrlRef.current)
      }
    }
  }, [chartHooks.imageUrlRef])

  useEffect(() => {
    setCachedSummary('')
    setShowSummary(false)
    followupHooks.setFollowups([])
    followupHooks.setCurrentFollowup('')
  }, [])

  const combinedLogoutCleanup = useMemo(() => {
    const fn = () => {
      chartHooks.handleLogoutCleanup()
      setResp(null)
      setCachedSummary('')
    }
    return fn
  }, [chartHooks.handleLogoutCleanup])

  useLogoutCleanup(combinedLogoutCleanup)

  useEffect(() => {
    if (prevProfileIdRef.current && !profile?.id) {
      combinedLogoutCleanup()
    }
    prevProfileIdRef.current = profile?.id
  }, [profile?.id, combinedLogoutCleanup])

  const baseSummary =
    resp && resp.data && (resp.data.summary || resp.data.summary_html)
      ? (resp.data.summary || resp.data.summary_html)
      : 'Kein Summary vorhanden'
  const summaryError =
    resp && resp.ok === false
      ? (resp.error || resp.data?.detail || 'Analyse konnte nicht geladen werden')
      : ''
  const summaryContent = cachedSummary || baseSummary
  const summaryText = summaryError
    ? ''
    : (loading && !cachedSummary && !resp?.data?.summary ? '' : summaryContent)

  return {
    resp, setResp,
    showAdvanced, setShowAdvanced,
    year, setYear, month, setMonth, day, setDay,
    hour, setHour, minute, setMinute, second, setSecond,
    latitude, setLatitude, longitude, setLongitude,
    timezone, setTimezone, datetimeLocal, setDatetimeLocal,
    cachedSummary, setCachedSummary,
    showSummary, setShowSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow, setIsNarrow,
    profile, authInitialized, selectedPerson,
    prevProfileIdRef,
    startStream, isStreaming,
    loading,
    ...chartHooks,
    followups: followupHooks.followups,
    setFollowups: followupHooks.setFollowups,
    currentFollowup: followupHooks.currentFollowup,
    setCurrentFollowup: followupHooks.setCurrentFollowup,
    isFollowupLoading: followupHooks.isFollowupLoading,
    submitFollowup: followupHooks.submitFollowup,
    maxFollowupsReached: followupHooks.maxFollowupsReached,
    streamedSummaryRef,
    summaryRef,
    hasInitializedSelectionResetRef,
    combinedLogoutCleanup,
    baseSummary, summaryError, summaryContent, summaryText,
  }
}

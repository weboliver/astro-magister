import React, { useState, useEffect, useCallback, useRef } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import '../styles/tz.css'
import PersonSelector from './PersonSelector'
import WikiPageShortcut from './WikiPageShortcut'
import { ADDITIONAL_QUESTION_MAX_LENGTH } from '../utils/aiPrompt'
import InterpretationHistoryDropdown from './InterpretationHistoryDropdown'
import { deleteInterpretation } from '../hooks/useInterpretations'
import { printInterpretationAsPdf } from '../utils/pdfExport'
import { formatDateTimeValue } from '../utils/dateTime'
import { LoadingSpinner } from './LoadingSpinner'
import { ErrorMessage } from './ErrorMessage'
import { PoweruserNoticeLink } from './PoweruserNotice'

function FollowupTextarea({ value, onChange, isPoweruser, loading, disabled: isDisabled, maxLength, placeholder, followupNumber }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)

  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setDraft(value)
    }
  }, [value])

  const handleChange = useCallback((e) => {
    const v = e.target.value.slice(0, maxLength)
    setDraft(v)
    onChange(v)
  }, [maxLength, onChange])

  const handleBlur = useCallback(() => {
    onChange(draft.slice(0, maxLength))
  }, [draft, onChange, maxLength])

  return (
    <div style={{ marginTop: 12 }}>
      <label><b>Zusatzfrage {followupNumber}</b> {isPoweruser ? <span style={{ color: '#c00' }}>*</span> : null}</label>
      <textarea
        ref={ref}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        maxLength={maxLength}
        rows={3}
        placeholder={placeholder}
        style={{ width: '100%', resize: 'vertical' }}
        disabled={isDisabled}
      />
      {!isPoweruser && (
        <div style={{ marginTop: 4, color: '#c00', fontSize: 12 }}>Zusatzfragen sind nur für zahlende Mitglieder verfügbar. <a href="https://buymeacoffee.com/shinengakic" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.</div>
      )}
      {isPoweruser && <div style={{ marginTop: 4, color: '#577', fontSize: 12, textAlign: 'right' }}>{draft.length}/{maxLength}</div>}
    </div>
  )
}

export default function InterpretationPage({
  title,
  wikiPageName,
  wikiOriginPage,
  wikiOriginLabel,
  historyContextType,
  interpretButtonLabel,
  interpretButtonLoadingLabel,
  chartLoadingMessage,
  chartFallbackMessage,
  children,
  onInterpret,
  onDelete,
  state,
  hidePersonSelector,
  onHistoryLoad,
  historyUserPersonsId,
  chartMarginTop,
  chartMinHeight,
  imageObjectFit,
  questionPlaceholder,
  chartChildren,
  chartTitle,
  chartHistoryYearOnly,
  interpretDisabled,
}) {
  if (!state) return null

  const {
    resp, setResp,
    year, setYear, month, setMonth, day, setDay,
    hour, setHour, minute, setMinute, second, setSecond,
    latitude, setLatitude, longitude, setLongitude,
    timezone, setTimezone, datetimeLocal, setDatetimeLocal,
    cachedSummary, setCachedSummary,
    showSummary, setShowSummary,
    additionalQuestion, setAdditionalQuestion,
    activeInterpretationId, setActiveInterpretationId,
    dropdownRefreshToken, setDropdownRefreshToken,
    isNarrow,
    profile,
    selectedPerson,
    startStream, isStreaming,
    loading,
    chartImage, imageLoading, imageError,
    followups, setFollowups, currentFollowup, setCurrentFollowup,
    maxFollowupsReached,
    summaryRef,
    summaryError, summaryText,
  } = state

  const handleDelete = async () => {
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
  }

  const defaultHistoryLoad = (interp) => {
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
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>{title}</h3>
        <WikiPageShortcut pageName={wikiPageName} originPage={wikiOriginPage} originLabel={wikiOriginLabel} />
      </div>
      {!hidePersonSelector && <PersonSelector helperText="Lade eine gespeicherte Person in das Formular" />}
      {children}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div className="container-400pt" style={{ flex: '1 1 360px', minWidth: 240 }}>
          <div style={{ marginTop: 8, marginBottom: 8, display: 'none' }}>
            <label>Datum & Uhrzeit</label>
            <Flatpickr
              value={datetimeLocal}
              options={{ enableTime: true, enableSeconds: true, time_24hr: true, dateFormat: 'Y-m-d H:i:S' }}
              onChange={(dates) => {
                const date = dates && dates[0]
                if (!date) return
                const y = date.getFullYear(); const m = date.getMonth() + 1; const d = date.getDate()
                const hh = date.getHours(); const mm = date.getMinutes(); const ss = date.getSeconds()
                setYear(y); setMonth(m); setDay(d); setHour(hh); setMinute(mm); setSecond(ss)
                setDatetimeLocal(formatDateTimeValue(y, m, d, hh, mm, ss))
              }}
            />
          </div>
          {state.showAdvanced && (
            <>
              <label>Timezone</label>
              <input className="tz-input" value={timezone} onChange={e => setTimezone(e.target.value)} />
              <label>Latitude</label>
              <input value={latitude} onChange={e => setLatitude(e.target.value)} />
              <label>Longitude</label>
              <input value={longitude} onChange={e => setLongitude(e.target.value)} />
            </>
          )}
          {profile?.id && (
            <InterpretationHistoryDropdown
              contextType={historyContextType}
              userPersonsId={historyUserPersonsId ?? selectedPerson?.id ?? null}
              refreshToken={activeInterpretationId || dropdownRefreshToken}
              selectedInterpretationId={activeInterpretationId}
              yearOnly={chartHistoryYearOnly}
              onClear={() => {
                setActiveInterpretationId(null)
                setCachedSummary('')
                setShowSummary(false)
                setAdditionalQuestion('')
                setFollowups([])
                setCurrentFollowup('')
              }}
              onLoad={onHistoryLoad || defaultHistoryLoad}
            />
          )}
          <label><b>Optionale Zusatzfrage</b></label>
          <textarea
            value={additionalQuestion}
            onChange={(event) => setAdditionalQuestion(event.target.value.slice(0, ADDITIONAL_QUESTION_MAX_LENGTH))}
            maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
            rows={3}
            placeholder={questionPlaceholder || "Optional: Worauf soll die KI bei der Auswertung besonders eingehen?"}
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
                  printInterpretationAsPdf(title, summaryRef.current, {
                    personName: selectedPerson?.name || profile?.username || 'Eigenes Profil',
                    birthDate,
                    birthCity: subject?.birth_city || '',
                    birthRegionCode: subject?.birth_region || '',
                    birthCountryCode: subject?.birth_country || '',
                    additionalQuestion,
                    imageUrl: chartImage,
                  })
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
            <FollowupTextarea
              value={currentFollowup}
              onChange={setCurrentFollowup}
              isPoweruser={profile?.is_poweruser}
              loading={loading}
              disabled={!profile?.is_poweruser || loading || followups.length >= 10}
              maxLength={ADDITIONAL_QUESTION_MAX_LENGTH}
              placeholder="Ihre Frage zur Vertiefung der Auswertung"
              followupNumber={followups.length + 1}
            />
          )}
          {profile?.is_poweruser && activeInterpretationId && followups.length >= 10 && (
            <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Maximale Anzahl von 10 Zusatzfragen erreicht.</div>
          )}
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              onClick={onInterpret}
              disabled={loading || interpretDisabled || (activeInterpretationId ? (!profile?.is_poweruser || !currentFollowup.trim() || followups.length >= 10) : false)}
            >
              {loading ? <LoadingSpinner /> : (activeInterpretationId ? 'Auswertung vertiefen' : interpretButtonLabel)}
            </button>
            {activeInterpretationId && (
              <button
                onClick={onDelete || handleDelete}
                disabled={loading}
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', color: '#b42318', cursor: 'pointer' }}
              >
                Auswertung löschen
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 240, maxWidth: 750 }}>
          <div style={{ border: '1px solid #dde1e7', marginTop: (isNarrow ? 0 : (chartMarginTop ?? -70)), borderRadius: 12, padding: 12, minHeight: chartMinHeight ?? 320, background: '#fff', boxShadow: '0 2px 12px rgba(15,23,42,0.12)' }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>{chartTitle || `${title} Diagramm`}</h4>
            {imageLoading && <LoadingSpinner message={chartLoadingMessage} />}
            {imageError && <ErrorMessage message={imageError} />}
            {chartImage && !imageLoading && (
              <div style={{ position: 'relative' }}>
                <img src={chartImage} alt={`${title} Diagramm`} style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 750, objectFit: imageObjectFit ?? 'contain' }} />
                {chartChildren}
              </div>
            )}
            {!chartImage && !imageLoading && !imageError && (
              <div style={{ color: '#577' }}>{chartFallbackMessage}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}



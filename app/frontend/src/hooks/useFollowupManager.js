/**
 * useFollowupManager.js - Followup question state machine with streaming and max-10 guard
 * @module useFollowupManager
 * @description Encapsulates the followup question state machine shared by
 *              Horoscope.jsx and Mondknoten.jsx. Manages the followups array,
 *              current input state, loading flag, and submit logic with
 *              streamFollowup integration.
 */

import { useState, useCallback, useMemo } from 'react'
import { streamFollowup } from './useInterpretations'

/**
 * React hook managing followup question state, streaming submission,
 * and a max-10 guard.
 *
 * @returns {object} Followup manager interface
 */
export function useFollowupManager() {
  const [followups, setFollowups] = useState([])
  const [currentFollowup, setCurrentFollowup] = useState('')
  const [isFollowupLoading, setIsFollowupLoading] = useState(false)

  /** True when 10 followup questions have already been asked. */
  const maxFollowupsReached = useMemo(
    () => followups.length >= 10,
    [followups.length],
  )

  /**
   * Submits a followup question to an existing interpretation session.
   *
   * @param {number} interpretationId - Active interpretation ID
   * @param {string} question - The question text (pre-trimmed by caller)
   * @param {string} baseSummary - The existing summary text to prepend
   * @param {object} callbacks
   * @param {(fullText: string) => void} callbacks.onDelta - Called with full
   *   display text (baseSummary + separator + streamed text so far)
   * @param {(summary: string) => void} callbacks.onDone - Called when streaming
   *   completes (receives final summary)
   * @param {(err: Error) => void} callbacks.onError - Called on error
   */
  const submitFollowup = useCallback(
    async (interpretationId, question, baseSummary, { onDelta, onDone, onError }) => {
      // Guard: no empty questions and max 10 followups
      if (!question.trim() || followups.length >= 10) {
        return
      }

      setIsFollowupLoading(true)

      const questionNumber = followups.length + 1
      const separatorPrefix =
        `\n\n---\n\n**Zusatzfrage ${questionNumber}:** ${question}\n\n`

      let streamedText = ''

      try {
        await streamFollowup(interpretationId, question, {
          onDelta: (chunk) => {
            streamedText += chunk
            if (onDelta) {
              onDelta(baseSummary + separatorPrefix + streamedText)
            }
          },
          onDone: (summary) => {
            const finalText = summary || streamedText
            setFollowups((prev) => [...prev, { question }])
            setCurrentFollowup('')
            if (onDone) {
              onDone(finalText)
            }
          },
          onError: (err) => {
            if (onError) onError(err)
          },
        })
      } finally {
        setIsFollowupLoading(false)
      }
    },
    [followups.length],
  )

  return {
    followups,
    setFollowups,
    currentFollowup,
    setCurrentFollowup,
    isFollowupLoading,
    submitFollowup,
    maxFollowupsReached,
  }
}

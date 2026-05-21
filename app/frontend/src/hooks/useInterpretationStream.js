/**
 * useInterpretationStream.js - SSE stream reading, parsing, and event dispatching hook
 * @module useInterpretationStream
 * @description Encapsulates the SSE stream read/parse/dispatch pattern shared by
 *              Horoscope.jsx and Mondknoten.jsx. The hook is stateless — callbacks
 *              receive only the incremental data, leaving accumulation to the
 *              caller. This keeps it reusable for both single-person and dual-person
 *              streams (Phase 19 Synastrie.jsx).
 */

import { useState, useCallback } from 'react'
import { postStream } from '../services/api'
import { parseSseBlock } from '../utils/sseParser'

/**
 * React hook providing SSE stream start capability with event dispatching.
 *
 * @returns {{ startStream: Function, isStreaming: boolean }}
 *   - `isStreaming` — true while an SSE stream is active
 *   - `startStream(path, payload, callbacks)` — initiates and reads the SSE stream
 */
export function useInterpretationStream() {
  const [isStreaming, setIsStreaming] = useState(false)

  /**
   * Initiates an SSE stream, reads all events, and dispatches to callbacks.
   *
   * @param {string} path - API endpoint path (e.g. '/horoscope/stream')
   * @param {object} payload - POST body payload
   * @param {object} callbacks
   * @param {(data: object) => void} callbacks.onMeta - Called on 'meta' event
   * @param {(content: string) => void} callbacks.onSummaryDelta - Called on 'summary_delta' event
   * @param {(summary: string) => void} callbacks.onDone - Called on 'done' event
   * @param {(id: number) => void} callbacks.onSaved - Called on 'saved' event
   * @param {(err: Error) => void} [callbacks.onError] - Called on error (optional)
   */
  const startStream = useCallback(async (path, payload, callbacks) => {
    const { onMeta, onSummaryDelta, onDone, onSaved, onError } = callbacks

    setIsStreaming(true)

    try {
      const streamResp = await postStream(path, payload)

      if (!streamResp.ok) {
        let detail = `Request failed (${streamResp.status})`
        try {
          const errorBody = await streamResp.json()
          detail = errorBody.detail || detail
        } catch (_) {
          try {
            const text = await streamResp.text()
            if (text) detail = text
          } catch (_) { /* keep status-based detail */ }
        }
        throw new Error(detail)
      }

      if (!streamResp.body) {
        throw new Error('Streaming wird von diesem Browser nicht unterstützt')
      }

      const reader = streamResp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (!parsed) continue

          if (parsed.event === 'meta') {
            onMeta(parsed.data)
          } else if (parsed.event === 'summary_delta') {
            onSummaryDelta(parsed.data.content || '')
          } else if (parsed.event === 'done') {
            onDone(parsed.data.summary || '')
          } else if (parsed.event === 'saved') {
            onSaved(parsed.data.interpretation_id)
          } else if (parsed.event === 'error') {
            throw new Error(parsed.data.detail || 'Streaming fehlgeschlagen')
          }
        }

        if (done) break
      }
    } catch (err) {
      if (onError) onError(err)
    } finally {
      setIsStreaming(false)
    }
  }, [])

  return { startStream, isStreaming }
}

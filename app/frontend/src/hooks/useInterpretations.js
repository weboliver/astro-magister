import { useState, useCallback } from 'react'
import { get, del, postStream } from '../services/api'

export function useInterpretations() {
  const [interpretations, setInterpretations] = useState([])
  const [loadingList, setLoadingList] = useState(false)

  const listInterpretations = useCallback(async (contextType, userPersonsId) => {
    setLoadingList(true)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (contextType) params.set('context_type', contextType)
      if (userPersonsId != null) params.set('user_persons_id', String(userPersonsId))
      const resp = await get(`/interpretations?${params}`)
      if (!resp.ok) return []
      const data = await resp.json()
      setInterpretations(data)
      return data
    } catch (_) {
      return []
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadInterpretation = useCallback(async (id) => {
    try {
      const resp = await get(`/interpretations/${id}`)
      if (!resp.ok) return null
      return resp.json()
    } catch (_) {
      return null
    }
  }, [])

  const deleteInterpretation = useCallback(async (id) => {
    try {
      const resp = await del(`/interpretations/${id}`)
      if (resp.ok) {
        setInterpretations((prev) => prev.filter((i) => i.id !== id))
      }
      return resp.ok
    } catch (_) {
      return false
    }
  }, [])

  return { interpretations, loadingList, listInterpretations, loadInterpretation, deleteInterpretation }
}

/**
 * Streams a followup message to an existing interpretation session.
 * Calls POST /interpretations/{id}/messages (SSE stream).
 *
 * @param {number} interpretationId
 * @param {string} question
 * @param {{ onDelta: (chunk: string) => void, onDone: (summary: string) => void, onError: (err: Error) => void }} callbacks
 */
export async function streamFollowup(interpretationId, question, { onDelta, onDone, onError } = {}) {
  let resp
  try {
    resp = await postStream(`/interpretations/${interpretationId}/messages`, { content: question })
  } catch (err) {
    if (onError) onError(err)
    return
  }

  if (!resp.ok) {
    let detail = `Request failed (${resp.status})`
    try {
      const body = await resp.json()
      detail = body.detail || detail
    } catch (_) {}
    if (onError) onError(new Error(detail))
    return
  }

  if (!resp.body) {
    if (onError) onError(new Error('Streaming wird von diesem Browser nicht unterstützt'))
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''

    for (const block of blocks) {
      let event = 'message'
      const dataLines = []
      for (const rawLine of block.split(/\r?\n/)) {
        if (!rawLine) continue
        if (rawLine.startsWith('event:')) { event = rawLine.slice(6).trim(); continue }
        if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trimStart())
      }
      if (!dataLines.length) continue

      let data = null
      try { data = JSON.parse(dataLines.join('\n')) } catch (_) { data = dataLines.join('\n') }

      if (event === 'summary_delta') {
        if (onDelta) onDelta(data?.content || '')
      } else if (event === 'done') {
        if (onDone) onDone(data?.summary || '')
      } else if (event === 'error') {
        if (onError) onError(new Error(data?.detail || 'Streaming fehlgeschlagen'))
      }
    }

    if (done) break
  }
}

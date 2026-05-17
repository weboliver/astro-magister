/**
 * sseParser.js - Server-Sent Events parsing utilities
 * @module sseParser
 * @description Functions for parsing SSE stream blocks and creating SSE handlers
 */

/**
 * Parses a single SSE block from a stream
 * @param {string} block - Raw SSE block text
 * @returns {{event: string, data: object}|null} Parsed event or null on error
 */
export function parseSseBlock(block) {
  let event = 'message'
  const dataLines = []

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine) continue
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice(6).trim()
      continue
    }
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trimStart())
    }
  }

  if (!dataLines.length) return null

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch (error) {
    return null
  }
}

export async function createSSEStreamHandler({
  postFn,
  path,
  onMeta,
  onSummaryDelta,
  onDone,
  onSaved,
  onError,
}) {
  const streamResp = await postFn(path)
  const reader = streamResp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamedSummary = ''
  let metaData = null

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''

    for (const block of blocks) {
      const parsed = parseSseBlock(block)
      if (!parsed) continue

      if (parsed.event === 'meta') {
        metaData = parsed.data
        onMeta({ data: parsed.data, streamedSummary, status: streamResp.status })
        continue
      }

      if (parsed.event === 'summary_delta') {
        streamedSummary += parsed.data.content || ''
        onSummaryDelta({ content: parsed.data.content, streamedSummary, metaData, status: streamResp.status })
        continue
      }

      if (parsed.event === 'done') {
        streamedSummary = parsed.data.summary || streamedSummary
        onDone({ summary: streamedSummary, metaData, status: streamResp.status })
        continue
      }

      if (parsed.event === 'saved') {
        onSaved({ interpretation_id: parsed.data.interpretation_id })
        continue
      }

      if (parsed.event === 'error') {
        throw new Error(parsed.data.detail || 'Streaming fehlgeschlagen')
      }
    }

    if (done) break
  }

  return { streamedSummary, metaData, status: streamResp.status }
}
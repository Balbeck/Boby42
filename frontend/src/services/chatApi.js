import { getVisitorId } from './identity'

const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { ChatResponse } from '../types/types.js' */

/**
 * Phase 2 of the two-call chat flow: send the question + the rows a prior
 * `fetchChatDocuments` returned, receive the RAG + LLM answer.
 *
 * The answer is streamed: the request sets `stream: true` and the backend
 * replies with NDJSON — `{type:'token',value}` lines then one terminal
 * `{type:'done', answer, sources, conversationId, messageId}` line. `onToken` is
 * called with each fragment (and the running full text) as it arrives; the
 * resolved value is the same `ChatResponse` shape the JSON path returned.
 *
 * @param {string} question
 * @param {{
 *   signal?: AbortSignal,
 *   conversationId?: string | null,
 *   language?: string,
 *   documents?: {name: string, type: 'md' | 'pdf', score?: number, url?: string}[],
 *   onToken?: (fragment: string, full: string) => void,
 * }} [options]
 * @returns {Promise<ChatResponse>}
 */
export async function sendMessage(
  question,
  { signal, conversationId, language, documents, onToken } = {},
) {
  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      language,
      // Always sent, even empty: an empty array means "nothing was found", which
      // the backend answers with its no-documents fallback (no LLM call) instead
      // of retrieving for itself.
      documents: documents ?? [],
      visitorId: getVisitorId(),
      stream: true,
      ...(conversationId ? { conversationId } : {}),
    }),
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  // NDJSON: {type:'token'} lines then a terminal {type:'done'} (or {type:'error'}).
  // `body` is non-null on a streamed 2xx response — asserted, not guarded.
  const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let final = /** @type {any} */ (null)

  /**
   * Parse and dispatch one NDJSON line. Written once so the trailing-buffer
   * flush below runs exactly the same logic as the read loop.
   *
   * @param {string} line
   */
  function handleLine(line) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      return
    }
    if (obj.type === 'token') {
      full += obj.value
      onToken?.(obj.value, full)
    } else if (obj.type === 'done') {
      final = obj
    } else if (obj.type === 'error') {
      throw new Error(obj.message || 'Error contacting the server')
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      handleLine(line)
    }
  }

  // The loop exits on the reader's `done` and would drop whatever is left in
  // `buffer`. The backend does terminate every line with a \n, but a writer or
  // proxy that ever omits the final newline would silently cost us the terminal
  // `done` frame — and with it `messageId` + `conversationId`: the answer would
  // still show (the concatenated tokens) while the 👍/👎 buttons vanish and the
  // next question opens a new conversation.
  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer.trim())

  // `sources` is passed through deliberately although no caller reads it today:
  // the documents on screen come from phase 1 (`POST /chat/documents`), and this
  // is the handle for a later reconciliation between what was shown and what the
  // prompt actually used.
  return {
    answer: final?.answer ?? full,
    sources: final?.sources ?? [],
    conversationId: final?.conversationId ?? conversationId ?? null,
    messageId: final?.messageId ?? null,
  }
}

/**
 * Phase 1 of the two-call chat flow: retrieval only over both stores (~2 s, no
 * LLM). Same shape as `POST /archiviste`.
 *
 * @param {string} question
 * @param {string} language - 'fr' | 'en' | 'origin'
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ count: number, documents: {name: string, score: number, type: 'md' | 'pdf', url: string}[] }>}
 */
export async function fetchChatDocuments(question, language, { signal } = {}) {
  const response = await fetch(`${API_URL}/chat/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      language,
      visitorId: getVisitorId(),
    }),
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

/**
 * Fetch one matched document's content from the `url` its row already carries
 * (the language is baked into that path by phase 1). Duplicated from
 * `archivisteApi.fetchDocument` on purpose — the two pages keep separate
 * transports (see frontend/CLAUDE.md).
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ name: string, content: string }>}
 */
export async function fetchDocumentContent(url, { signal } = {}) {
  const response = await fetch(`${API_URL}${url}`, { signal })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

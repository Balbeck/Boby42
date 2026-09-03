import { getVisitorId } from './identity'
import { apiUrl, getJson, postJson, throwIfNotOk } from './http'
import { readNdjson } from './ndjson'

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
 * The NDJSON reader loop (and its trailing-buffer guard) lives in
 * `services/ndjson.js`, shared with `ollamaApi.generate`; only the per-frame
 * handling below is chat-specific.
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
  // Its own fetch (not postJson): the raw Response is needed to stream the body.
  const response = await fetch(apiUrl('/chat'), {
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

  await throwIfNotOk(response)

  // NDJSON: {type:'token'} lines then a terminal {type:'done'} (or {type:'error'}).
  // A {type:'error'} frame throws from this callback; `readNdjson` does not catch
  // it, so it aborts the read and rejects this call.
  let full = ''
  let final = /** @type {any} */ (null)
  await readNdjson(response, (obj) => {
    if (obj.type === 'token') {
      full += obj.value
      onToken?.(obj.value, full)
    } else if (obj.type === 'done') {
      final = obj
    } else if (obj.type === 'error') {
      throw new Error(obj.message || 'Error contacting the server')
    }
  })

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
  return postJson(
    '/chat/documents',
    { question, language, visitorId: getVisitorId() },
    { signal },
  )
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
  return getJson(url, { signal })
}

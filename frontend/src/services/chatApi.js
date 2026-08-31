import { getVisitorId } from './identity'

const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { ChatResponse } from '../types/types.js' */

/**
 * Phase 2 of the two-call chat flow: send the question + the rows a prior
 * `fetchChatDocuments` returned, receive the complete RAG + LLM answer.
 *
 * @param {string} question
 * @param {{
 *   signal?: AbortSignal,
 *   conversationId?: string | null,
 *   language?: string,
 *   documents?: {name: string, type: 'md' | 'pdf', score?: number, url?: string}[],
 * }} [options]
 * @returns {Promise<ChatResponse>}
 */
export async function sendMessage(
  question,
  { signal, conversationId, language, documents } = {},
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
      ...(conversationId ? { conversationId } : {}),
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

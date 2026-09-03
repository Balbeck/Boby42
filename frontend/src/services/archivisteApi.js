import { getVisitorId } from './identity'
import { getJson, postJson } from './http'

/** @import { ArchivisteSearchResponse } from '../types/types.js' */

/**
 * @param {string} question
 * @param {string} language - 'fr' | 'en' | 'origin'
 * @param {{ signal?: AbortSignal, conversationId?: string | null }} [options]
 * @returns {Promise<ArchivisteSearchResponse>}
 */
export async function search(question, language, { signal, conversationId } = {}) {
  return postJson(
    '/archiviste',
    {
      question,
      language,
      visitorId: getVisitorId(),
      ...(conversationId ? { conversationId } : {}),
    },
    { signal },
  )
}

/**
 * @param {string} url - route déjà prête à l'emploi, renvoyée par search() ;
 *   la langue est portée par le path de cette URL (le backend l'y lit).
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ name: string, content: string }>}
 */
export async function fetchDocument(url, { signal } = {}) {
  return getJson(url, { signal })
}

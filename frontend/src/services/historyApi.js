import { getVisitorId } from './identity'

const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { ConversationSummary, ConversationDetail } from '../types/types.js' */

/**
 * Le visiteur anonyme est le seul périmètre de lecture côté backend : il est
 * donc envoyé en query param sur les deux appels, jamais dans un body (ce sont
 * des GET).
 *
 * @param {string} path
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<any>}
 */
async function get(path, { signal } = {}) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(
    `${API_URL}${path}${separator}visitorId=${encodeURIComponent(getVisitorId())}`,
    { signal },
  )

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

/**
 * Les conversations de ce navigateur, plus récente d'abord.
 *
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ConversationSummary[]>}
 */
export function listConversations(options) {
  return get('/conversations', options)
}

/**
 * Une conversation avec ses messages et les références de ses documents (jamais
 * leur contenu : il est rechargé paresseusement au dépli, comme après une
 * réponse fraîche). 404 si elle n'appartient pas à ce visiteur.
 *
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ConversationDetail>}
 */
export function getConversation(id, options) {
  return get(`/conversations/${encodeURIComponent(id)}`, options)
}

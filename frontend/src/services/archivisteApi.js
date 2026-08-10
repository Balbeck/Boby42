const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { ArchivisteSearchResponse } from '../types/types.js' */

/**
 * @param {string} question
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ArchivisteSearchResponse>}
 */
export async function search(question, { signal } = {}) {
  const response = await fetch(`${API_URL}/archiviste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

/**
 * @param {string} url - route déjà prête à l'emploi, renvoyée par search()
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ name: string, content: string }>}
 */
export async function fetchDocument(url, { signal } = {}) {
  const response = await fetch(`${API_URL}${url}`, { signal })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

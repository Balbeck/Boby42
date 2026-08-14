const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { ArchivisteSearchResponse } from '../types/types.js' */

/**
 * @param {string} question
 * @param {string} language - 'fr' | 'en'
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ArchivisteSearchResponse>}
 */
export async function search(question, language, { signal } = {}) {
  const response = await fetch(`${API_URL}/archiviste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, language }),
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
 * @param {string} language - 'fr' | 'en'
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ name: string, content: string }>}
 */
export async function fetchDocument(url, language, { signal } = {}) {
  const separator = url.includes('?') ? '&' : '?'
  const response = await fetch(`${API_URL}${url}${separator}language=${encodeURIComponent(language)}`, {
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

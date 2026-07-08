const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

/** @import { ChatResponse } from '../types/types.js' */

/**
 * @param {string} question
 * @returns {Promise<ChatResponse>}
 */
export async function sendMessage(question) {
  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }

  return response.json()
}

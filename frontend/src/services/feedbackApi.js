import { getVisitorId } from './identity'

const API_URL = import.meta.env.VITE_API_URL || ''

/** @import { FeedbackResponse } from '../types/types.js' */

/**
 * Sends a 👍 / 👎 on one assistant message. `rating` is `1` / `-1`, or `0` to
 * withdraw. `comment` is only meaningful with `-1` and is dropped by the backend
 * otherwise. The caller (the hooks) treats any rejection as a silent rollback —
 * feedback is a courtesy, an error dialog would be backwards.
 *
 * @param {string} messageId
 * @param {-1 | 0 | 1} rating
 * @param {string} [comment]
 * @returns {Promise<FeedbackResponse>}
 */
export async function sendFeedback(messageId, rating, comment) {
  const response = await fetch(`${API_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageId,
      rating,
      visitorId: getVisitorId(),
      ...(comment ? { comment } : {}),
    }),
  })

  if (!response.ok) {
    throw new Error('feedback failed')
  }

  return response.json()
}

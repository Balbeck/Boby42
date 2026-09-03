import { getVisitorId } from './identity'
import { postJson } from './http'

/** @import { FeedbackResponse } from '../types/types.js' */

/**
 * Sends a 👍 / 👎 on one assistant message. `rating` is `1` / `-1`, or `0` to
 * withdraw. `comment` is only meaningful with `-1` and is dropped by the backend
 * otherwise. The caller (the hooks) treats any rejection as a silent rollback —
 * feedback is a courtesy, an error dialog would be backwards. That is also why
 * routing through `postJson` (which throws the standard
 * `'Error contacting the server'` on a non-OK status, not the old one-off
 * `'feedback failed'`) makes no visible difference: both hooks swallow it.
 *
 * @param {string} messageId
 * @param {-1 | 0 | 1} rating
 * @param {string} [comment]
 * @returns {Promise<FeedbackResponse>}
 */
export async function sendFeedback(messageId, rating, comment) {
  return postJson('/feedback', {
    messageId,
    rating,
    visitorId: getVisitorId(),
    ...(comment ? { comment } : {}),
  })
}

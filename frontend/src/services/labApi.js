import { apiUrl, getJsonOrNull } from './http'

// Transport for the /lab gate. All calls send the cookie (credentials:
// 'include'); same-origin here since Vite proxies /auth/lab server-side, but
// kept explicit. A non-OK status is an expected outcome, not an error — the
// caller decides what it means (wrong creds and feature-off both leave /lab).
// The GET reads are `getJsonOrNull` (services/http.js) — that exact null
// contract; `login` / `logout` keep their own fetch and only borrow `apiUrl`.

/**
 * @param {string} login
 * @param {string} password
 * @returns {Promise<{ ok: boolean, login?: string }>}
 */
export async function login(login, password) {
  const response = await fetch(apiUrl('/auth/lab/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
    credentials: 'include',
  })
  if (!response.ok) return { ok: false }
  const body = await response.json().catch(() => ({}))
  return { ok: true, login: body.login }
}

/** @returns {Promise<Response>} */
export function logout() {
  return fetch(apiUrl('/auth/lab/logout'), {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * @returns {Promise<{ login: string } | null>} the session, or null when there
 *   is none (401) or the feature is disabled (404).
 */
export function me() {
  return getJsonOrNull('/auth/lab/me')
}

/**
 * The shared key for the ALL /ollama/* proxy, handed to an authenticated /lab
 * session so it never sits in tracked frontend source. Kept in memory only by
 * the caller (no localStorage).
 *
 * @returns {Promise<string | null>} null when there is no session (401) or the
 *   proxy / gate is disabled (404).
 */
export async function ollamaKey() {
  const body = await getJsonOrNull('/auth/lab/ollama-key')
  return body?.key ?? null
}

// db-viz inspector (GET /lab-data/*). All three are gated backend-side by
// fastify.verifyLab, which is why the cookie rides along (getJsonOrNull always
// sends credentials: 'include'). Same contract as me(): a non-OK status — 401
// without a session, 404 when the gate is unconfigured — is an expected outcome,
// returned as null and never thrown; the caller renders an error state.

/**
 * @returns {Promise<Array<{ name: string, columns: object[], rowCount: number }> | null>}
 */
export function tables() {
  return getJsonOrNull('/lab-data/tables')
}

/**
 * @param {string} name
 * @returns {Promise<{ name: string, columns: object[], rows: object[], rowCount: number, truncated: boolean } | null>}
 */
export function table(name) {
  return getJsonOrNull(`/lab-data/tables/${encodeURIComponent(name)}`)
}

/**
 * One conversation with its subtree (visitor, messages, documents, feedback,
 * events), assembled server-side by foreign key.
 *
 * @param {string} conversationId
 * @returns {Promise<object | null>} null on a malformed id, an unknown
 *   conversation (404) or any non-OK status.
 */
export function tree(conversationId) {
  return getJsonOrNull(`/lab-data/tree/${encodeURIComponent(conversationId)}`)
}

// 🔬 analytics dashboard (GET /analytics/*). Same contract as the db-viz reads:
// gated backend-side, a non-OK status is an expected outcome (→ null), never a
// throw; the caller renders an error/empty state.

/** @param {Record<string, string | number>} [params] @returns {string} */
function qs(params) {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

/**
 * The whole dashboard payload for one window: tiles (range + all-time), daily
 * series, score histogram, top documents, language + error splits.
 *
 * @param {{ from?: string, to?: string }} [range]
 * @returns {Promise<object | null>} the payload's exact shape lives in
 *   `backend/routes/analytics/overview.js` — six independent blocks, not typed
 *   here.
 */
export function analyticsOverview(range) {
  return getJsonOrNull(`/analytics/overview${qs(range)}`)
}

/**
 * The list of unmatched questions (`no_match` events), newest first, paginated.
 *
 * @param {{ from?: string, to?: string, limit?: number, offset?: number, page?: 'chat' | 'archiviste' }} [params]
 * @returns {Promise<{ items: object[], total: number } | null>}
 */
export function analyticsUnmatched(params) {
  return getJsonOrNull(`/analytics/unmatched${qs(params)}`)
}

/**
 * A page of the admin-wide conversation list.
 *
 * @param {{ from?: string, to?: string, limit?: number, offset?: number, page?: 'chat' | 'archiviste' }} [params]
 * @returns {Promise<{ items: object[], total: number } | null>}
 */
export function analyticsConversations(params) {
  return getJsonOrNull(`/analytics/conversations${qs(params)}`)
}

/**
 * One conversation's full subtree (same shape as `tree()` / GET /lab-data/tree).
 *
 * @param {string} id
 * @returns {Promise<object | null>} null on a bad/unknown id or any non-OK status.
 */
export function analyticsConversation(id) {
  return getJsonOrNull(`/analytics/conversations/${encodeURIComponent(id)}`)
}

const API_URL = import.meta.env.VITE_API_URL || ''

// Transport for the /lab gate. All calls send the cookie (credentials:
// 'include'); same-origin here since Vite proxies /auth/lab server-side, but
// kept explicit. A non-OK status is an expected outcome, not an error — the
// caller decides what it means (wrong creds and feature-off both leave /lab).

/**
 * @param {string} login
 * @param {string} password
 * @returns {Promise<{ ok: boolean, login?: string }>}
 */
export async function login(login, password) {
  const response = await fetch(`${API_URL}/auth/lab/login`, {
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
  return fetch(`${API_URL}/auth/lab/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * @returns {Promise<{ login: string } | null>} the session, or null when there
 *   is none (401) or the feature is disabled (404).
 */
export async function me() {
  const response = await fetch(`${API_URL}/auth/lab/me`, { credentials: 'include' })
  if (!response.ok) return null
  return response.json().catch(() => null)
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
  const response = await fetch(`${API_URL}/auth/lab/ollama-key`, { credentials: 'include' })
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  return body?.key ?? null
}

// db-viz inspector (GET /lab-data/*). Same contract as me(): a non-OK status is
// an expected outcome — returned as null, never thrown — and the caller renders
// an error state. These routes are ungated for now; the cookie still rides
// along (credentials: 'include') so they keep working once a later task gates
// them.

/**
 * @returns {Promise<Array<{ name: string, columns: object[], rowCount: number }> | null>}
 */
export async function tables() {
  const response = await fetch(`${API_URL}/lab-data/tables`, { credentials: 'include' })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

/**
 * @param {string} name
 * @returns {Promise<{ name: string, columns: object[], rows: object[], rowCount: number, truncated: boolean } | null>}
 */
export async function table(name) {
  const response = await fetch(
    `${API_URL}/lab-data/tables/${encodeURIComponent(name)}`,
    { credentials: 'include' },
  )
  if (!response.ok) return null
  return response.json().catch(() => null)
}

/**
 * One conversation with its subtree (visitor, messages, documents, feedback,
 * events), assembled server-side by foreign key.
 *
 * @param {string} conversationId
 * @returns {Promise<object | null>} null on a malformed id, an unknown
 *   conversation (404) or any non-OK status.
 */
export async function tree(conversationId) {
  const response = await fetch(
    `${API_URL}/lab-data/tree/${encodeURIComponent(conversationId)}`,
    { credentials: 'include' },
  )
  if (!response.ok) return null
  return response.json().catch(() => null)
}

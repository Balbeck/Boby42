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

const API_URL = import.meta.env.VITE_API_URL || ''

// Shared fetch-and-error plumbing for the API modules. This is a set of
// PRIMITIVES, not a client: no endpoint map, no per-page base path, no shared
// "search". `chatApi.js` and `archivisteApi.js` stay two separate files with
// their own endpoints and shapes on purpose — `/chat` and `/archiviste` must be
// able to evolve their retrieval independently.
//
// Two error contracts, both deliberate:
//   - throwing — the student pages (chat, archiviste, history, feedback): a
//     non-OK status is a real failure, so surface the backend's `message` and
//     throw. `postJson` / `getJson`, via `throwIfNotOk`.
//   - null — the `/lab` reads (`labApi`): a 401 (no session) or 404 (feature
//     off) is an expected outcome, not an error, so return `null` and let the
//     caller render an empty state. `getJsonOrNull`.
// `ollamaApi` keeps a third contract of its own (it surfaces the upstream body
// text so a model error is readable) and does not route errors through here —
// only its NDJSON loop is shared (see `ndjson.js`).

/**
 * @param {string} path
 * @returns {string}
 */
export function apiUrl(path) {
  return `${API_URL}${path}`
}

/**
 * The throwing contract: on a non-OK response, read the backend's `message` and
 * throw it (falling back to a generic string).
 *
 * @param {Response} response
 * @returns {Promise<void>}
 */
export async function throwIfNotOk(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || 'Error contacting the server')
  }
}

/**
 * POST a JSON body, throw on a non-OK status, resolve to the parsed JSON.
 *
 * @param {string} path
 * @param {any} body
 * @param {{ signal?: AbortSignal, headers?: Record<string, string>, credentials?: RequestCredentials }} [options]
 * @returns {Promise<any>}
 */
export async function postJson(path, body, { signal, headers, credentials } = {}) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    ...(credentials ? { credentials } : {}),
    signal,
  })
  await throwIfNotOk(response)
  return response.json()
}

/**
 * GET, throw on a non-OK status, resolve to the parsed JSON.
 *
 * @param {string} path
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<any>}
 */
export async function getJson(path, { signal } = {}) {
  const response = await fetch(apiUrl(path), { signal })
  await throwIfNotOk(response)
  return response.json()
}

/**
 * GET with the session cookie, the null contract: `null` on any non-OK status,
 * otherwise the parsed JSON (or `null` if the body will not parse).
 *
 * @param {string} path
 * @returns {Promise<any | null>}
 */
export async function getJsonOrNull(path) {
  const response = await fetch(apiUrl(path), { credentials: 'include' })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

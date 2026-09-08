import { vi } from 'vitest'

// The network boundary for the unit suites. Every service module goes through
// global `fetch`, so replacing that one function is the whole stub — no msw, no
// server, nothing to keep in sync with the backend.
//
// What the recorded call carries is deliberately the *decoded* request (parsed
// JSON body, plain headers object): the assertions in the API suites are about
// what the frontend SENDS — the visitorId it attaches, the `stream: true` flag,
// the querystring it builds — and reading that off a raw `RequestInit` in every
// test would bury the point.

/**
 * @typedef {{
 *   url: string,
 *   method: string,
 *   headers: Record<string, string>,
 *   body: any,
 *   credentials: string | undefined,
 *   signal: AbortSignal | undefined,
 * }} RecordedCall
 */

/**
 * Installs the fake `fetch`.
 *
 * `respond` is either an array (one entry consumed per call, in order — the
 * common case, and the order documents the sequence of calls) or a function
 * `(call, index) => Response`.
 *
 * `vi.unstubAllGlobals()` in an `afterEach` undoes it.
 *
 * @param {Response[] | ((call: RecordedCall, index: number) => Response | Promise<Response>)} [respond]
 * @returns {{ calls: RecordedCall[] }}
 */
export function stubFetch(respond = []) {
  /** @type {RecordedCall[]} */
  const calls = []
  const queue = Array.isArray(respond) ? [...respond] : null

  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
      /** @type {RecordedCall} */
      const call = {
        url: String(url),
        method: init.method || 'GET',
        headers: { ...(init.headers || {}) },
        body: parseBody(init.body),
        credentials: init.credentials,
        signal: init.signal,
      }
      calls.push(call)

      if (queue) return queue.length ? queue.shift() : jsonResponse({})
      return (/** @type {Exclude<typeof respond, Response[]>} */ (respond))(call, calls.length - 1)
    }),
  )

  return { calls }
}

/** @param {any} body @returns {any} */
function parseBody(body) {
  if (body === undefined || body === null) return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/**
 * @param {any} payload
 * @param {number} [status]
 * @returns {Response}
 */
export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * A non-OK response whose body is not JSON at all — the case
 * `throwIfNotOk` has to survive without throwing a SyntaxError of its own
 * (an HTML error page from a proxy is the realistic version).
 *
 * @param {number} [status]
 * @param {string} [text]
 * @returns {Response}
 */
export function textResponse(status = 500, text = '<html>502 Bad Gateway</html>') {
  return new Response(text, { status, headers: { 'content-type': 'text/html' } })
}

/**
 * An NDJSON response whose body arrives in the chunks given, so a suite can
 * split one JSON object across two reads — the case that breaks a naive parser
 * and the reason `readNdjson` buffers.
 *
 * @param {string[]} chunks - raw strings, newlines included where wanted
 * @param {number} [status]
 * @returns {Response}
 */
export function streamResponse(chunks, status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

/**
 * The same thing from a list of objects, one per line, newline-terminated.
 *
 * @param {any[]} objects
 * @param {number} [status]
 * @returns {Response}
 */
export function ndjsonResponse(objects, status = 200) {
  return streamResponse([objects.map((o) => JSON.stringify(o)).join('\n') + '\n'], status)
}

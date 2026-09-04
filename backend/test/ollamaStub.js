'use strict'

// Ollama is NEVER called for real in the test suite — not even the fast prod
// proxy. `services/ollama.service.js` and `routes/ollama.js` both go through
// global `fetch`, so swapping that one function is the whole stub.
//
// OLLAMA_BASE_URL is set to a non-resolving host in test/env.js: a suite that
// forgets to install the stub fails loudly instead of silently reaching a real
// Ollama (~100 s on a dev Mac).

const realFetch = globalThis.fetch

/**
 * @typedef {(body: any, url: string, init: RequestInit) => Response | Promise<Response>} OllamaHandler
 */

/**
 * Installs the fake. `handlers` is keyed by Ollama path — the key is matched as
 * a suffix of the request URL, so '/api/generate' catches both the service's
 * `${OLLAMA_BASE_URL}/api/generate` and the proxy's rebuilt target.
 *
 * An unmatched path throws, so a test can never pass by accident on a call
 * nobody described.
 *
 * @param {Record<string, OllamaHandler>} handlers
 * @returns {{ calls: {url: string, body: any}[] }} the recorded calls, live
 */
function stubOllama (handlers) {
  const calls = []

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url)
    let body = null
    if (init.body) {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: href, body })

    if (init.signal?.aborted) throw abortError()

    const key = Object.keys(handlers).find((path) => href.endsWith(path) || href.includes(path))
    if (!key) throw new Error(`[ollamaStub] no handler for ${href}`)
    return handlers[key](body, href, init)
  }

  return { calls }
}

/** Puts the real `fetch` back. Always call this in an `after` hook. */
function restoreFetch () {
  globalThis.fetch = realFetch
}

/**
 * @param {any} payload
 * @param {number} [status]
 * @returns {Response}
 */
function jsonResponse (payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * An Ollama NDJSON generation stream: one `{ response }` object per fragment,
 * then the terminal `{ done: true }` line.
 *
 * @param {string[]} fragments
 * @param {{ chunks?: string[] }} [opts] raw wire chunks, to split a JSON object
 *   across two network reads (the case that breaks a naive line parser)
 * @returns {Response}
 */
function ndjsonResponse (fragments, { chunks } = {}) {
  const wire = chunks ?? [
    fragments.map((value) => JSON.stringify({ response: value }) + '\n').join('') +
      JSON.stringify({ done: true, response: '' }) + '\n'
  ]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start (controller) {
      for (const chunk of wire) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' }
  })
}

/**
 * What undici throws when nothing is listening — the shape
 * `ollamaFetch()` turns into an OLLAMA_UNREACHABLE error.
 *
 * @returns {TypeError}
 */
function connectionRefused () {
  const err = new TypeError('fetch failed')
  err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  return err
}

/** @returns {Error} the DOMException-shaped error an aborted fetch rejects with */
function abortError () {
  const err = new Error('This operation was aborted')
  err.name = 'AbortError'
  return err
}

module.exports = {
  stubOllama,
  restoreFetch,
  jsonResponse,
  ndjsonResponse,
  connectionRefused,
  abortError
}

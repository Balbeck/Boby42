'use strict'

const { Readable } = require('node:stream')

// Transparent reverse-proxy to the local Ollama — test tooling.
//
// Purpose: hit `<backend>/ollama/<any Ollama path>` exactly as if talking to
// Ollama directly (`http://localhost:11434/<same path>`), so scripts can vary
// model / options (temperature, num_ctx, top_p, …) against the real prod host.
// In prod the backend is not tunnel-exposed, so the call arrives via the
// frontend's Vite proxy (`/ollama` entry in frontend/vite.config.js).
//
// Shared-key gate: every request must carry `x-ollama-key: <OLLAMA_PROXY_KEY>`
// (from .env.lab). Missing/wrong key OR unset env var → 404 (fail closed, same
// posture as the /lab gate — don't confirm the route exists). This is the only
// thing between the public tunnel and raw Ollama on the shared 42AI GPU host.
//
// Bodies are assumed JSON (every Ollama endpoint that takes one is JSON): the
// parsed body is re-serialised on the way out — not byte-exact, irrelevant for
// this use. The response (status, content-type, body) is streamed back
// verbatim, so `stream: true` NDJSON and `stream: false` both just work.
//
// Top-level route file — autoload does not prefix it (like routes/chat.js).

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL
const OLLAMA_PROXY_KEY = process.env.OLLAMA_PROXY_KEY

module.exports = async function (fastify, opts) {
  fastify.all('/ollama/*', async function (request, reply) {
    if (!OLLAMA_PROXY_KEY || request.headers['x-ollama-key'] !== OLLAMA_PROXY_KEY) {
      return reply.notFound()
    }

    const subPath = request.params['*'] || ''
    const qIdx = request.url.indexOf('?')
    const qs = qIdx === -1 ? '' : request.url.slice(qIdx)
    const target = `${OLLAMA_BASE_URL}/${subPath}${qs}`

    const hasBody =
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.body !== undefined

    let upstream
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: hasBody ? JSON.stringify(request.body) : undefined
      })
    } catch (err) {
      request.log.error({ err, target }, 'ollama proxy: upstream fetch failed')
      return reply.badGateway('Ollama unreachable')
    }

    reply.status(upstream.status)
    const contentType = upstream.headers.get('content-type')
    if (contentType) reply.header('content-type', contentType)

    return reply.send(upstream.body ? Readable.fromWeb(upstream.body) : null)
  })
}

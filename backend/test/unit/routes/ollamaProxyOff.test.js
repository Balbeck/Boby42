'use strict'

// The `/ollama` proxy with OLLAMA_PROXY_KEY unset — its own file, deliberately.
//
// routes/ollama.js reads the variable ONCE, at module load, unlike the /lab gate
// which reads process.env live. So "the feature is off" cannot be produced by
// deleting the variable inside a test: the module has already captured it. The
// delete has to happen before the first require, which means before anything
// else in the file — and node --test gives each FILE its own process, so this is
// isolated from the suite next door.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')

// Must precede the route require. Nothing above this line may load it.
delete process.env.OLLAMA_PROXY_KEY

const { buildRouteApp } = require('../../routeApp')
const { stubOllama, restoreFetch, jsonResponse } = require('../../ollamaStub')

const ollamaRoute = require('../../../routes/ollama')

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(ollamaRoute) })
after(async () => {
  restoreFetch()
  await app.close()
})

describe('the /ollama proxy with no key configured', () => {
  it('404s even with a header that would otherwise be valid', async () => {
    const upstream = stubOllama({ '/api/generate': () => jsonResponse({ response: 'leaked' }) })

    const res = await app.inject({
      method: 'POST',
      url: '/ollama/api/generate',
      headers: { 'x-ollama-key': 'anything' },
      payload: { model: 'x' }
    })

    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(upstream.calls.length, 0, 'Ollama was reached with the proxy off')
  })

  it('404s with no header', async () => {
    const res = await app.inject({ method: 'GET', url: '/ollama/api/tags' })
    assert.strictEqual(res.statusCode, 404)
  })

  it('is the safe default — an empty OLLAMA_PROXY_KEY means the route is off', async () => {
    // docker-compose passes `OLLAMA_PROXY_KEY: ${OLLAMA_PROXY_KEY:-}`, so a host
    // that never set it gets the empty string, not an absent variable.
    const res = await app.inject({
      method: 'POST', url: '/ollama/api/generate', headers: { 'x-ollama-key': '' }
    })
    assert.strictEqual(res.statusCode, 404)
  })
})

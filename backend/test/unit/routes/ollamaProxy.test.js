'use strict'

// Unit suite for routes/ollama.js — the transparent Ollama reverse-proxy.
//
// This route is internet-facing in production (the tunnel reaches the frontend,
// whose Vite proxy forwards `/ollama`) and it fronts raw Ollama on a SHARED 42AI
// GPU host. Its only protection is one header. So the first half of this suite
// is the gate, exhaustively; the second is "verbatim", which is the whole
// contract — a proxy that reshapes anything is not a proxy.
//
// `fetch` is stubbed: no Ollama is ever called for real, not even the fast prod
// proxy.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp } = require('../../routeApp')
const { stubOllama, restoreFetch, jsonResponse } = require('../../ollamaStub')

const ollamaRoute = require('../../../routes/ollama')

const KEY = process.env.OLLAMA_PROXY_KEY
const BASE = process.env.OLLAMA_BASE_URL

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(ollamaRoute) })
after(async () => {
  restoreFetch()
  await app.close()
})
afterEach(() => restoreFetch())

/**
 * @param {Object} [opts]
 * @param {string} [opts.url]
 * @param {string} [opts.method]
 * @param {Object} [opts.headers]
 * @param {*} [opts.payload]
 */
const call = ({ url = '/ollama/api/generate', method = 'POST', headers = { 'x-ollama-key': KEY }, payload } = {}) =>
  app.inject({ method, url, headers, payload })

describe('the shared-key gate', () => {
  const refused = [
    ['no header at all', {}],
    ['an empty key', { 'x-ollama-key': '' }],
    ['a wrong key', { 'x-ollama-key': 'nope' }],
    ['the key in the wrong header', { authorization: KEY }],
    ['a key with trailing whitespace — the comparison is exact', { 'x-ollama-key': `${KEY} ` }]
  ]

  for (const [label, headers] of refused) {
    it(`404s on ${label}, without calling Ollama`, async () => {
      // 404 and not 401: fail closed, same posture as the /lab gate. A 401 would
      // confirm to a scanner that the route exists.
      const upstream = stubOllama({ '/api/generate': () => jsonResponse({ response: 'leaked' }) })

      const res = await call({ headers, payload: { model: 'x' } })
      assert.strictEqual(res.statusCode, 404)
      assert.strictEqual(upstream.calls.length, 0)
    })
  }

  it('gates every method, not just POST', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const res = await call({ method, url: '/ollama/api/tags', headers: {} })
      assert.strictEqual(res.statusCode, 404, `${method} was not gated`)
    }
  })

  it('lets the correct key through', async () => {
    stubOllama({ '/api/tags': () => jsonResponse({ models: [] }) })

    const res = await call({ method: 'GET', url: '/ollama/api/tags' })
    assert.strictEqual(res.statusCode, 200)
  })
})

describe('relaying the request', () => {
  it('appends the sub-path to OLLAMA_BASE_URL', async () => {
    const upstream = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })
    await call({ payload: { model: 'mistral:latest' } })

    assert.strictEqual(upstream.calls[0].url, `${BASE}/api/generate`)
  })

  it('relays a deeply nested sub-path', async () => {
    const upstream = stubOllama({ '/api': () => jsonResponse({}) })
    await call({ method: 'GET', url: '/ollama/api/blobs/sha256/abc' })

    assert.strictEqual(upstream.calls[0].url, `${BASE}/api/blobs/sha256/abc`)
  })

  it('carries the querystring through untouched', async () => {
    const upstream = stubOllama({ '/api/tags': () => jsonResponse({}) })
    await call({ method: 'GET', url: '/ollama/api/tags?verbose=true&x=1' })

    assert.strictEqual(upstream.calls[0].url, `${BASE}/api/tags?verbose=true&x=1`)
  })

  it('re-serialises the JSON body — options and all', async () => {
    const upstream = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })
    const body = { model: 'mistral:latest', prompt: 'x', stream: false, options: { temperature: 0.2, num_ctx: 8192 } }
    await call({ payload: body })

    assert.deepStrictEqual(upstream.calls[0].body, body)
  })

  it('sends no body on GET', async () => {
    const upstream = stubOllama({ '/api/tags': () => jsonResponse({}) })
    await call({ method: 'GET', url: '/ollama/api/tags' })

    assert.strictEqual(upstream.calls[0].body, null)
  })

  it('sends no body on a POST that carries none', async () => {
    const upstream = stubOllama({ '/api/generate': () => jsonResponse({}) })
    await call({ method: 'POST', url: '/ollama/api/generate', headers: { 'x-ollama-key': KEY } })

    assert.strictEqual(upstream.calls[0].body, null)
  })
})

describe('relaying the response verbatim', () => {
  it('passes the body and the content-type back unchanged', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'au 2e', done: true }) })

    const res = await call({ payload: { model: 'x' } })
    assert.strictEqual(res.statusCode, 200)
    assert.match(res.headers['content-type'], /application\/json/)
    assert.deepStrictEqual(res.json(), { response: 'au 2e', done: true })
  })

  it('passes an upstream 4xx straight through instead of masking it', async () => {
    // A wrong model name must look like a wrong model name to the script that
    // sent it, not like a proxy failure.
    stubOllama({ '/api/generate': () => jsonResponse({ error: 'model not found' }, 404) })

    const res = await call({ payload: { model: 'nope' } })
    assert.strictEqual(res.statusCode, 404)
    assert.deepStrictEqual(res.json(), { error: 'model not found' })
  })

  it('passes an upstream 500 through', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ error: 'boom' }, 500) })

    const res = await call({ payload: { model: 'x' } })
    assert.strictEqual(res.statusCode, 500)
  })

  it('streams an NDJSON body line by line, so stream:true just works', async () => {
    const ndjson = '{"response":"au "}\n{"response":"2e","done":true}\n'
    stubOllama({
      '/api/generate': () => new Response(ndjson, {
        status: 200, headers: { 'content-type': 'application/x-ndjson' }
      })
    })

    const res = await call({ payload: { model: 'x', stream: true } })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers['content-type'], 'application/x-ndjson')
    assert.strictEqual(res.payload, ndjson)
  })

  it('handles a response with no content-type header', async () => {
    stubOllama({ '/api/generate': () => new Response('plain', { status: 200 }) })

    const res = await call({ payload: { model: 'x' } })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload, 'plain')
  })

  it('handles an empty upstream body', async () => {
    stubOllama({ '/api/generate': () => new Response(null, { status: 204 }) })

    const res = await call({ payload: { model: 'x' } })
    assert.strictEqual(res.statusCode, 204)
  })
})

describe('Ollama unreachable', () => {
  it('is a 502, not a crash', async () => {
    stubOllama({
      '/api/generate': () => { throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNREFUSED' }) }
    })

    const res = await call({ payload: { model: 'x' } })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Ollama unreachable')
  })
})

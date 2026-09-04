'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, stubOllama, jsonResponse, ndjsonResponse, connectionRefused } = require('../helper')

const KEY = process.env.OLLAMA_PROXY_KEY

const call = async (options) => (await getApp()).inject(options)

describe('ALL /ollama/* — the shared-key gate', () => {
  // 404, never 401: this route fronts raw Ollama on a shared GPU host through a
  // public tunnel, and it must not confirm it exists.
  itDb('404s with no key header at all', async () => {
    stubOllama({ '/api': () => assert.fail('upstream must not be reached') })
    assert.strictEqual((await call({ method: 'GET', url: '/ollama/api/tags' })).statusCode, 404)
  })

  itDb('404s with a wrong key', async () => {
    stubOllama({ '/api': () => assert.fail('upstream must not be reached') })
    const res = await call({
      method: 'GET', url: '/ollama/api/tags', headers: { 'x-ollama-key': 'wrong' }
    })
    assert.strictEqual(res.statusCode, 404)
  })
})

describe('ALL /ollama/* — the proxy itself', () => {
  itDb('relays the sub-path, the querystring and the JSON body', async () => {
    const calls = stubOllama({
      '/api/generate': () => jsonResponse({ response: 'hello' })
    }).calls

    const res = await call({
      method: 'POST',
      url: '/ollama/api/generate?verbose=1',
      headers: { 'x-ollama-key': KEY },
      payload: { model: 'mistral:latest', prompt: 'x', options: { temperature: 0.9 } }
    })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { response: 'hello' })

    assert.strictEqual(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/api/generate?verbose=1'), calls[0].url)
    // Body is re-serialised, not byte-exact — the values are what matter.
    assert.strictEqual(calls[0].body.model, 'mistral:latest')
    assert.deepStrictEqual(calls[0].body.options, { temperature: 0.9 })
  })

  itDb('sends no body on a GET', async () => {
    const calls = stubOllama({ '/api/tags': () => jsonResponse({ models: [] }) }).calls
    await call({ method: 'GET', url: '/ollama/api/tags', headers: { 'x-ollama-key': KEY } })
    assert.strictEqual(calls[0].body, null)
  })

  itDb('passes an upstream error status and body through verbatim', async () => {
    // A script tuning parameters needs Ollama's own 400, not a rewritten one.
    stubOllama({ '/api/generate': () => jsonResponse({ error: 'model not found' }, 404) })

    const res = await call({
      method: 'POST', url: '/ollama/api/generate', headers: { 'x-ollama-key': KEY }, payload: { model: 'nope' }
    })

    assert.strictEqual(res.statusCode, 404)
    assert.deepStrictEqual(res.json(), { error: 'model not found' })
  })

  itDb('streams an NDJSON response through untouched', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['a', 'b']) })

    const res = await call({
      method: 'POST',
      url: '/ollama/api/generate',
      headers: { 'x-ollama-key': KEY },
      payload: { model: 'm', prompt: 'p', stream: true }
    })

    assert.match(res.headers['content-type'], /application\/x-ndjson/)
    const lines = res.payload.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    assert.deepStrictEqual(lines.slice(0, 2), [{ response: 'a' }, { response: 'b' }])
  })

  itDb('502s when Ollama is unreachable', async () => {
    stubOllama({ '/api/tags': () => { throw connectionRefused() } })

    const res = await call({ method: 'GET', url: '/ollama/api/tags', headers: { 'x-ollama-key': KEY } })

    assert.strictEqual(res.statusCode, 502)
    assert.match(res.json().message, /Ollama unreachable/)
  })
})

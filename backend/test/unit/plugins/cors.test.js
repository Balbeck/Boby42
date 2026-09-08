'use strict'

// Unit suite for plugins/cors.js.
//
// CORS is a non-issue for the primary flow — the browser only ever calls the
// frontend's own origin and Vite proxies to the backend server-side. It matters
// for direct cross-origin calls (manual testing, a future second frontend), and
// the thing worth pinning is that `origin: CORS_ORIGIN` is an EXACT single-origin
// match: a near miss on scheme or port is refused, and a misconfigured
// CORS_ORIGIN silently allows nothing rather than everything.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')

const Fastify = require('fastify')
const corsPlugin = require('../../../plugins/cors')

const ORIGIN = process.env.CORS_ORIGIN // 'http://localhost:8421' from test/env.js

/**
 * A bare app carrying the plugin and one route to call.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildCorsApp () {
  const app = Fastify()
  await app.register(corsPlugin)
  app.get('/ping', async () => ({ ok: true }))
  await app.ready()
  return app
}

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildCorsApp() })
after(async () => app.close())

describe('the allowed origin', () => {
  it('echoes it back on a simple request', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping', headers: { origin: ORIGIN } })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers['access-control-allow-origin'], ORIGIN)
  })

  it('answers the preflight', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    })

    assert.strictEqual(res.statusCode, 204)
    assert.strictEqual(res.headers['access-control-allow-origin'], ORIGIN)
  })
})

describe('anything else', () => {
  const nearMisses = [
    ['a different port', 'http://localhost:9999'],
    ['https instead of http', 'https://localhost:8421'],
    ['a different host', 'http://evil.example'],
    ['a suffix of the allowed origin', 'http://localhost:8421.evil.example']
  ]

  for (const [label, origin] of nearMisses) {
    it(`refuses ${label} — the match is exact, not a prefix`, async () => {
      const res = await app.inject({ method: 'GET', url: '/ping', headers: { origin } })

      // @fastify/cors does not fail the request; it simply omits the header, so
      // the browser is the one that blocks. What matters is that the header is
      // never the caller's own origin.
      assert.notStrictEqual(res.headers['access-control-allow-origin'], origin)
    })
  }

  it('serves a request with no Origin header at all — curl still works', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    assert.strictEqual(res.statusCode, 200)
  })
})

describe('a missing CORS_ORIGIN', () => {
  it('allows nothing rather than everything', async () => {
    // The dangerous misconfiguration would be defaulting to '*' on a backend
    // fronting a shared host. `origin: undefined` must not do that.
    const saved = process.env.CORS_ORIGIN
    delete process.env.CORS_ORIGIN

    const app2 = await buildCorsApp()
    const res = await app2.inject({ method: 'GET', url: '/ping', headers: { origin: 'http://evil.example' } })
    await app2.close()

    process.env.CORS_ORIGIN = saved
    assert.notStrictEqual(res.headers['access-control-allow-origin'], '*')
    assert.notStrictEqual(res.headers['access-control-allow-origin'], 'http://evil.example')
  })
})

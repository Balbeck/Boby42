'use strict'

// Unit suite for plugins/labAuth.js + routes/auth/lab/index.js — no Postgres.
//
// Plugin and routes are tested together because the plugin IS the gate: it
// registers the cookie support and decorates `verifyLab`, and testing the routes
// against a fake gate would skip the only security-relevant code in the pair.
// `User.findOne` and the labAuth service are stubbed; @fastify/cookie runs for
// real, so the cookie flags asserted below are the ones a browser would receive.
//
// The organising idea is fail-closed: an unconfigured or unseeded deployment
// answers 404 everywhere — never 401, which would confirm the feature exists.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, serviceStub, resetStubs } = require('../../routeApp')
const { stubModel, spy, restoreAll } = require('../../sequelizeStub')

const labAuthService = require('../../../services/labAuth.service')
const { User } = require('../../../models')

const SECRET = process.env.LAB_JWT_SECRET
const LAB_USER = { id: 1, login: 'test-lab-login' }
const TOKEN = 'a-valid-looking-token'

const isConfigured = serviceStub(labAuthService, 'isConfigured', () => Boolean(process.env.LAB_JWT_SECRET))
const login = serviceStub(labAuthService, 'login', async () => ({ token: TOKEN, login: LAB_USER.login }))
const logout = serviceStub(labAuthService, 'logout', async () => undefined)
const getSession = serviceStub(labAuthService, 'getSession', async () => LAB_USER)

const labAuthPlugin = require('../../../plugins/labAuth')
const authLabRoute = require('../../../routes/auth/lab/index')

// Whether a /lab user row exists. A flag rather than a re-stub per test: the
// gate calls User.findOne on every request, so flipping this between injects is
// enough — and re-stubbing would leave the last stub installed for the rest of
// the file (which it did, silently 404ing every later test).
let seeded = true

/** Builds the plugin + routes pair. */
const buildLabApp = () =>
  buildRouteApp(authLabRoute, { prefix: '/auth/lab', plugins: [labAuthPlugin] })

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => {
  stubModel(User, { findOne: spy(async () => (seeded ? { id: LAB_USER.id } : null)) })
  app = await buildLabApp()
})
after(async () => {
  restoreAll()
  await app.close()
})
afterEach(() => {
  resetStubs(isConfigured, login, logout, getSession)
  process.env.LAB_JWT_SECRET = SECRET
  seeded = true
})

const cookie = (token = TOKEN) => ({ cookie: `lab_token=${token}` })

describe('POST /auth/lab/login', () => {
  const credentials = { login: 'test-lab-login', password: 'test-lab-password' }
  const post = (payload) => app.inject({ method: 'POST', url: '/auth/lab/login', payload })

  it('returns the login and sets the session cookie', async () => {
    const res = await post(credentials)

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { login: 'test-lab-login' })

    const set = res.cookies.find((c) => c.name === 'lab_token')
    assert.strictEqual(set.value, TOKEN)
  })

  it('sets the cookie httpOnly, sameSite=lax, path=/', async () => {
    // httpOnly is what keeps the session out of reach of any script on the
    // publicly tunnelled frontend origin.
    const res = await post(credentials)
    const set = res.cookies.find((c) => c.name === 'lab_token')

    assert.strictEqual(set.httpOnly, true)
    assert.strictEqual(set.sameSite, 'Lax')
    assert.strictEqual(set.path, '/')
  })

  it('does not mark the cookie Secure over plain HTTP', async () => {
    // In this deployment the backend is always reached server-side over HTTP
    // (Vite proxy / loopback); the cookie still rides the HTTPS tunnel.
    const res = await post(credentials)
    assert.ok(!res.cookies.find((c) => c.name === 'lab_token').secure)
  })

  it('401s on bad credentials', async () => {
    login.set(async () => null)

    const res = await post({ login: 'test-lab-login', password: 'wrong' })
    assert.strictEqual(res.statusCode, 401)
    assert.strictEqual(res.json().message, 'Invalid credentials')
  })

  it('404s — not 401 — when the gate is unconfigured', async () => {
    delete process.env.LAB_JWT_SECRET

    const res = await post(credentials)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(login.callCount, 0)
  })

  it('404s when no /lab user has been seeded', async () => {
    seeded = false

    const res = await post(credentials)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(login.callCount, 0)
  })

  const rejected = [
    ['no body', undefined],
    ['a missing login', { password: 'x' }],
    ['a missing password', { login: 'x' }],
    ['an empty login', { login: '', password: 'x' }],
    ['an empty password', { login: 'x', password: '' }]
  ]

  for (const [label, payload] of rejected) {
    it(`400s on ${label}`, async () => {
      const res = await post(payload)
      assert.strictEqual(res.statusCode, 400)
    })
  }
})

describe('GET /auth/lab/me', () => {
  const get = (headers) => app.inject({ method: 'GET', url: '/auth/lab/me', headers })

  it('returns the logged-in login', async () => {
    const res = await get(cookie())
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { login: 'test-lab-login' })
  })

  it('401s with no cookie at all', async () => {
    const res = await get({})
    assert.strictEqual(res.statusCode, 401)
    assert.strictEqual(getSession.callCount, 0, 'no cookie means no lookup')
  })

  it('401s when the token no longer matches the stored session', async () => {
    getSession.set(async () => null)

    const res = await get(cookie('stale-token'))
    assert.strictEqual(res.statusCode, 401)
    assert.strictEqual(res.json().message, 'Invalid session')
  })

  it('passes the cookie value to getSession verbatim', async () => {
    await get(cookie('some-token'))
    assert.strictEqual(getSession.calls[0][0], 'some-token')
  })
})

describe('POST /auth/lab/logout', () => {
  const post = (headers) => app.inject({ method: 'POST', url: '/auth/lab/logout', headers })

  it('nulls the stored session and clears the cookie', async () => {
    const res = await post(cookie())

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { ok: true })
    assert.strictEqual(logout.calls[0][0], LAB_USER.id)

    const cleared = res.cookies.find((c) => c.name === 'lab_token')
    assert.strictEqual(cleared.value, '')
  })

  it('401s without a session — you cannot log out of nothing', async () => {
    const res = await post({})
    assert.strictEqual(res.statusCode, 401)
    assert.strictEqual(logout.callCount, 0)
  })
})

describe('GET /auth/lab/ollama-key', () => {
  const get = (headers) => app.inject({ method: 'GET', url: '/auth/lab/ollama-key', headers })
  const KEY = process.env.OLLAMA_PROXY_KEY

  afterEach(() => { process.env.OLLAMA_PROXY_KEY = KEY })

  it('hands the proxy key to an authenticated session', async () => {
    // This is what keeps the key out of tracked frontend source: the 💬 console
    // fetches it at runtime instead of embedding it.
    const res = await get(cookie())

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { key: KEY })
  })

  it('401s without a session', async () => {
    const res = await get({})
    assert.strictEqual(res.statusCode, 401)
  })

  it('404s when the proxy itself is off — do not confirm it exists', async () => {
    delete process.env.OLLAMA_PROXY_KEY

    const res = await get(cookie())
    assert.strictEqual(res.statusCode, 404)
  })

  it('404s on an empty key, which is what an unset compose variable produces', async () => {
    process.env.OLLAMA_PROXY_KEY = ''

    const res = await get(cookie())
    assert.strictEqual(res.statusCode, 404)
  })
})

describe('the gate fails closed', () => {
  const guarded = [
    ['GET', '/auth/lab/me'],
    ['POST', '/auth/lab/logout'],
    ['GET', '/auth/lab/ollama-key']
  ]

  it('404s every guarded route when LAB_JWT_SECRET is unset', async () => {
    delete process.env.LAB_JWT_SECRET

    for (const [method, url] of guarded) {
      const res = await app.inject({ method, url, headers: cookie() })
      assert.strictEqual(res.statusCode, 404, `${url} answered ${res.statusCode}`)
    }
    assert.strictEqual(getSession.callCount, 0)
  })

  it('404s every guarded route when no user is seeded', async () => {
    seeded = false

    for (const [method, url] of guarded) {
      const res = await app.inject({ method, url, headers: cookie() })
      assert.strictEqual(res.statusCode, 404, `${url} answered ${res.statusCode}`)
    }
  })

  it('logs the reason at boot, so a prod 404 is diagnosable from `make logs`', async () => {
    // Without these two lines an /auth/lab/* 404 in production is
    // indistinguishable from a route that was never deployed.
    const logged = []
    const record = (level) => (...args) => logged.push([level, String(args[args.length - 1])])

    const enabled = await buildRouteApp(authLabRoute, {
      prefix: '/auth/lab',
      plugins: [async function (fastify) {
        fastify.log.info = record('info')
        fastify.log.warn = record('warn')
        await fastify.register(labAuthPlugin)
      }]
    })
    await enabled.close()

    assert.ok(logged.some(([level, msg]) => level === 'info' && msg.includes('[lab] gate enabled')))

    delete process.env.LAB_JWT_SECRET
    logged.length = 0

    const disabled = await buildRouteApp(authLabRoute, {
      prefix: '/auth/lab',
      plugins: [async function (fastify) {
        fastify.log.info = record('info')
        fastify.log.warn = record('warn')
        await fastify.register(labAuthPlugin)
      }]
    })
    await disabled.close()

    assert.ok(logged.some(([level, msg]) => level === 'warn' && msg.includes('LAB_JWT_SECRET unset')))
  })
})

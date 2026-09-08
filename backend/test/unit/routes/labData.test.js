'use strict'

// Unit suite for routes/labData.js — transport only, no Postgres.
//
// Two things this pins that the service suite cannot: that all three routes
// really carry `preHandler: fastify.verifyLab` (the frontend is publicly
// tunnelled, so an ungated read route is world-readable), and that the service
// returning `null` becomes a 404 rather than a 200 with an empty body.
//
// ⚠️ routes/labData.js destructures its service at require time — stubs first.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, allowLab, serviceStub, resetStubs } = require('../../routeApp')

const labDataService = require('../../../services/labData.service')
const listTables = serviceStub(labDataService, 'listTables', async () => [])
const readTable = serviceStub(labDataService, 'readTable', async () => null)
const readConversationTree = serviceStub(labDataService, 'readConversationTree', async () => null)

const labDataRoute = require('../../../routes/labData')

const UUID = '11111111-2222-4333-8444-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(labDataRoute, { decorate: { verifyLab: allowLab() } }) })
after(async () => app.close())
afterEach(() => resetStubs(listTables, readTable, readConversationTree))

const get = (url) => app.inject({ method: 'GET', url })

describe('GET /lab-data/tables', () => {
  it('returns the service listing verbatim', async () => {
    const tables = [{ name: 'conversations', columns: [], rowCount: 3 }]
    listTables.set(async () => tables)

    const res = await get('/lab-data/tables')
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), tables)
  })
})

describe('GET /lab-data/tables/:name', () => {
  const table = { name: 'conversations', columns: [], rows: [], rowCount: 0, truncated: false }

  it('returns the table payload', async () => {
    readTable.set(async () => table)

    const res = await get('/lab-data/tables/conversations')
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), table)
  })

  it('404s when the service refuses the name — `users` included', async () => {
    readTable.set(async () => null)

    const res = await get('/lab-data/tables/users')
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Unknown table')
  })

  it('forwards an explicit limit; the clamp lives in the service', async () => {
    readTable.set(async () => table)
    await get('/lab-data/tables/conversations?limit=25')

    assert.deepStrictEqual(readTable.calls[0], ['conversations', { limit: 25 }])
  })

  it('leaves the limit undefined when omitted, so the service default applies', async () => {
    readTable.set(async () => table)
    await get('/lab-data/tables/conversations')

    assert.deepStrictEqual(readTable.calls[0], ['conversations', { limit: undefined }])
  })

  it('keeps the schema loose above 1000 — the ceiling is the service\'s job', async () => {
    readTable.set(async () => table)
    const res = await get('/lab-data/tables/conversations?limit=999999')

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(readTable.calls[0][1].limit, 999999)
  })

  for (const [label, url] of [
    ['limit is 0', '/lab-data/tables/conversations?limit=0'],
    ['limit is negative', '/lab-data/tables/conversations?limit=-5'],
    ['limit is not an integer', '/lab-data/tables/conversations?limit=lots']
  ]) {
    it(`400s when ${label}`, async () => {
      const res = await get(url)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(readTable.callCount, 0)
    })
  }
})

describe('GET /lab-data/tree/:conversationId', () => {
  const tree = { conversation: { id: UUID }, visitor: null, messages: [], events: [] }

  it('returns the FK subtree', async () => {
    readConversationTree.set(async () => tree)

    const res = await get(`/lab-data/tree/${UUID}`)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), tree)
  })

  it('404s on an unknown conversation', async () => {
    readConversationTree.set(async () => null)

    const res = await get(`/lab-data/tree/${UUID}`)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Conversation not found')
  })

  it('400s on a malformed uuid — the schema catches it before the service', async () => {
    const res = await get('/lab-data/tree/not-a-uuid')
    assert.strictEqual(res.statusCode, 400)
    assert.strictEqual(readConversationTree.callCount, 0)
  })
})

describe('the gate', () => {
  // The whitelist inside the service is defence in depth. THIS is the gate.
  const routes = [
    ['/lab-data/tables', 'GET'],
    ['/lab-data/tables/conversations', 'GET'],
    [`/lab-data/tree/${UUID}`, 'GET']
  ]

  it('runs verifyLab before every handler', async () => {
    let seen = 0
    const counting = await buildRouteApp(labDataRoute, {
      decorate: {
        verifyLab: async function verifyLab () { seen += 1 }
      }
    })
    readTable.set(async () => ({ name: 'conversations', columns: [], rows: [], rowCount: 0, truncated: false }))
    readConversationTree.set(async () => ({ conversation: {}, visitor: null, messages: [], events: [] }))

    for (const [url, method] of routes) await counting.inject({ method, url })
    await counting.close()

    assert.strictEqual(seen, routes.length)
  })

  it('lets the gate\'s rejection through untouched — 401 without a session', async () => {
    const gated = await buildRouteApp(labDataRoute, {
      decorate: {
        verifyLab: async function verifyLab (request, reply) {
          return reply.code(401).send({ message: 'Invalid session' })
        }
      }
    })

    for (const [url, method] of routes) {
      const res = await gated.inject({ method, url })
      assert.strictEqual(res.statusCode, 401, `${url} was not gated`)
    }
    await gated.close()
    assert.strictEqual(listTables.callCount, 0)
    assert.strictEqual(readTable.callCount, 0)
    assert.strictEqual(readConversationTree.callCount, 0)
  })

  it('404s every route when the gate is unconfigured', async () => {
    // callNotFound() is how the real verifyLab fails closed: the /lab feature
    // must not be confirmed to exist by a 401.
    const off = await buildRouteApp(labDataRoute, {
      decorate: {
        verifyLab: async function verifyLab (request, reply) { return reply.callNotFound() }
      }
    })

    for (const [url, method] of routes) {
      const res = await off.inject({ method, url })
      assert.strictEqual(res.statusCode, 404, `${url} leaked its existence`)
    }
    await off.close()
  })
})

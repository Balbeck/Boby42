'use strict'

// Unit suite for routes/analytics/* — transport only, no Postgres.
//
// The aggregates are stubbed; `resolveWindow` is left real because it is pure
// and it is half of what these routes actually do. What is pinned here: the
// window each route asks for (the browser's decade-wide default is NOT the
// panel's 7 days), that `/overview` really fans out to all nine queries and
// assembles them under the keys the dashboard reads, and that every route is
// behind `verifyLab`.
//
// ⚠️ routes/analytics/conversations.js destructures readConversationTree at
// require time — that stub goes in before the route is required.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, allowLab, serviceStub, resetStubs } = require('../../routeApp')

const analytics = require('../../../services/analytics.service')
const labDataService = require('../../../services/labData.service')

const stubs = {
  totals: serviceStub(analytics, 'totals', async () => ({ requests: 0 })),
  dailyVisitors: serviceStub(analytics, 'dailyVisitors', async () => ['visitors']),
  dailyVolume: serviceStub(analytics, 'dailyVolume', async () => ['volume']),
  dailyFeedback: serviceStub(analytics, 'dailyFeedback', async () => ['feedback']),
  scoreHistogram: serviceStub(analytics, 'scoreHistogram', async () => ['histogram']),
  topDocuments: serviceStub(analytics, 'topDocuments', async () => ['documents']),
  languageSplit: serviceStub(analytics, 'languageSplit', async () => ['languages']),
  errorBreakdown: serviceStub(analytics, 'errorBreakdown', async () => ['errors']),
  unmatchedQuestions: serviceStub(analytics, 'unmatchedQuestions', async () => ({ items: [], total: 0 })),
  conversationList: serviceStub(analytics, 'conversationList', async () => ({ items: [], total: 0 })),
  readConversationTree: serviceStub(labDataService, 'readConversationTree', async () => null)
}

const overviewRoute = require('../../../routes/analytics/overview')
const unmatchedRoute = require('../../../routes/analytics/unmatched')
const conversationsRoute = require('../../../routes/analytics/conversations')

const UUID = '11111111-2222-4333-8444-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => {
  // Autoload prefixes the folder — the routes declare bare paths.
  app = await buildRouteApp(async function (fastify) {
    await fastify.register(overviewRoute)
    await fastify.register(unmatchedRoute)
    await fastify.register(conversationsRoute)
  }, { prefix: '/analytics', decorate: { verifyLab: allowLab() } })
})
after(async () => app.close())
afterEach(() => resetStubs(...Object.values(stubs)))

const get = (url) => app.inject({ method: 'GET', url })

describe('GET /analytics/overview', () => {
  it('assembles the whole dashboard payload from nine queries', async () => {
    const res = await get('/analytics/overview')
    assert.strictEqual(res.statusCode, 200)

    const body = res.json()
    assert.deepStrictEqual(Object.keys(body).sort(), [
      'daily', 'errors', 'languages', 'scoreHistogram', 'topDocuments', 'totals', 'window'
    ])
    assert.deepStrictEqual(body.daily, {
      visitors: ['visitors'], volume: ['volume'], feedback: ['feedback']
    })
    assert.deepStrictEqual(body.scoreHistogram, ['histogram'])
    assert.deepStrictEqual(body.topDocuments, ['documents'])
    assert.deepStrictEqual(body.languages, ['languages'])
    assert.deepStrictEqual(body.errors, ['errors'])
  })

  it('runs totals twice — the window block and the all-time block', async () => {
    // The all-time tiles reuse the same SQL with an unbounded window; two
    // separate queries with the same text is deliberate, not a duplication bug.
    let call = 0
    stubs.totals.set(async () => ({ requests: ++call }))

    const body = (await get('/analytics/overview')).json()

    assert.strictEqual(stubs.totals.callCount, 2)
    assert.deepStrictEqual(stubs.totals.calls[1][0], { from: '-infinity', to: 'infinity' })
    assert.deepStrictEqual(body.totals, { range: { requests: 1 }, allTime: { requests: 2 } })
  })

  it('defaults to the last 7 days and echoes the resolved window', async () => {
    const body = (await get('/analytics/overview')).json()

    const span = new Date(body.window.to).getTime() - new Date(body.window.from).getTime()
    assert.strictEqual(span, 7 * 864e5)
  })

  it('honours an explicit window and passes it to every aggregate', async () => {
    const from = '2026-03-01T00:00:00.000Z'
    const to = '2026-03-08T00:00:00.000Z'

    const body = (await get(`/analytics/overview?from=${from}&to=${to}`)).json()
    assert.deepStrictEqual(body.window, { from, to })

    for (const name of ['dailyVisitors', 'dailyVolume', 'dailyFeedback', 'scoreHistogram', 'topDocuments', 'languageSplit', 'errorBreakdown']) {
      assert.deepStrictEqual(stubs[name].calls[0][0], { from, to }, `${name} got the wrong window`)
    }
    // …but not to the all-time call.
    assert.deepStrictEqual(stubs.totals.calls[0][0], { from, to })
  })

  it('falls back to the default window on an unparseable date rather than 400ing', async () => {
    // resolveWindow swallows garbage on purpose — an Invalid Date would
    // serialise to null and every bound query would silently return nothing.
    const res = await get('/analytics/overview?from=yesterday-ish&to=soon')
    assert.strictEqual(res.statusCode, 200)

    const span = new Date(res.json().window.to).getTime() - new Date(res.json().window.from).getTime()
    assert.strictEqual(span, 7 * 864e5)
  })
})

describe('GET /analytics/unmatched', () => {
  it('returns the service payload', async () => {
    const payload = { items: [{ id: '1', question: 'q' }], total: 12 }
    stubs.unmatchedQuestions.set(async () => payload)

    const res = await get('/analytics/unmatched')
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), payload)
  })

  it('defaults to limit 100 / offset 0 / no page filter', async () => {
    await get('/analytics/unmatched')

    const [args] = stubs.unmatchedQuestions.calls[0]
    assert.strictEqual(args.limit, 100)
    assert.strictEqual(args.offset, 0)
    assert.strictEqual(args.page, null)
  })

  it('passes paging and the page filter through', async () => {
    await get('/analytics/unmatched?limit=10&offset=20&page=archiviste')

    const [args] = stubs.unmatchedQuestions.calls[0]
    assert.strictEqual(args.limit, 10)
    assert.strictEqual(args.offset, 20)
    assert.strictEqual(args.page, 'archiviste')
  })

  for (const [label, url] of [
    ['limit over the 500 cap', '/analytics/unmatched?limit=501'],
    ['limit below 1', '/analytics/unmatched?limit=0'],
    ['a negative offset', '/analytics/unmatched?offset=-1'],
    ['an unknown page value', '/analytics/unmatched?page=lab']
  ]) {
    it(`400s on ${label}`, async () => {
      const res = await get(url)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(stubs.unmatchedQuestions.callCount, 0)
    })
  }
})

describe('GET /analytics/conversations', () => {
  it('returns the service payload', async () => {
    const payload = { items: [{ id: UUID, page: 'chat' }], total: 1 }
    stubs.conversationList.set(async () => payload)

    const res = await get('/analytics/conversations')
    assert.deepStrictEqual(res.json(), payload)
  })

  it('asks for a decade-wide window, not the panel\'s 7 days', async () => {
    // The browser owns its own date filter and defaults to "all". A 7-day
    // default here would hide every older conversation behind an empty list.
    await get('/analytics/conversations')

    const [args] = stubs.conversationList.calls[0]
    const span = new Date(args.to).getTime() - new Date(args.from).getTime()
    assert.strictEqual(span, 3650 * 864e5)
  })

  it('defaults to limit 25 / offset 0 / no page filter', async () => {
    await get('/analytics/conversations')

    const [args] = stubs.conversationList.calls[0]
    assert.strictEqual(args.limit, 25)
    assert.strictEqual(args.offset, 0)
    assert.strictEqual(args.page, null)
  })

  it('passes paging and the page filter through', async () => {
    await get('/analytics/conversations?limit=50&offset=100&page=chat')

    const [args] = stubs.conversationList.calls[0]
    assert.strictEqual(args.limit, 50)
    assert.strictEqual(args.offset, 100)
    assert.strictEqual(args.page, 'chat')
  })

  it('400s on a limit over the 200 cap', async () => {
    const res = await get('/analytics/conversations?limit=201')
    assert.strictEqual(res.statusCode, 400)
  })
})

describe('GET /analytics/conversations/:id', () => {
  it('delegates to readConversationTree rather than building a third data path', async () => {
    const tree = { conversation: { id: UUID }, visitor: null, messages: [], events: [] }
    stubs.readConversationTree.set(async () => tree)

    const res = await get(`/analytics/conversations/${UUID}`)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), tree)
    assert.strictEqual(stubs.readConversationTree.calls[0][0], UUID)
  })

  it('404s on an unknown conversation', async () => {
    stubs.readConversationTree.set(async () => null)

    const res = await get(`/analytics/conversations/${UUID}`)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Conversation not found')
  })

  it('400s on a malformed uuid before the service runs', async () => {
    const res = await get('/analytics/conversations/not-a-uuid')
    assert.strictEqual(res.statusCode, 400)
    assert.strictEqual(stubs.readConversationTree.callCount, 0)
  })
})

describe('the gate', () => {
  const routes = ['/analytics/overview', '/analytics/unmatched', '/analytics/conversations', `/analytics/conversations/${UUID}`]

  it('401s every route without a session, before any aggregate runs', async () => {
    const gated = await buildRouteApp(async function (fastify) {
      await fastify.register(overviewRoute)
      await fastify.register(unmatchedRoute)
      await fastify.register(conversationsRoute)
    }, {
      prefix: '/analytics',
      decorate: {
        verifyLab: async function verifyLab (request, reply) {
          return reply.code(401).send({ message: 'Invalid session' })
        }
      }
    })

    for (const url of routes) {
      const res = await gated.inject({ method: 'GET', url })
      assert.strictEqual(res.statusCode, 401, `${url} was not gated`)
    }
    await gated.close()

    assert.strictEqual(stubs.totals.callCount, 0)
    assert.strictEqual(stubs.unmatchedQuestions.callCount, 0)
    assert.strictEqual(stubs.conversationList.callCount, 0)
    assert.strictEqual(stubs.readConversationTree.callCount, 0)
  })

  it('404s every route when the gate is unconfigured', async () => {
    const off = await buildRouteApp(async function (fastify) {
      await fastify.register(overviewRoute)
      await fastify.register(unmatchedRoute)
      await fastify.register(conversationsRoute)
    }, {
      prefix: '/analytics',
      decorate: {
        verifyLab: async function verifyLab (request, reply) { return reply.callNotFound() }
      }
    })

    for (const url of routes) {
      const res = await off.inject({ method: 'GET', url })
      assert.strictEqual(res.statusCode, 404, `${url} leaked its existence`)
    }
    await off.close()
  })
})

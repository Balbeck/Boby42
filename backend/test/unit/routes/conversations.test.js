'use strict'

// Unit suite for routes/conversations.js — transport only, no Postgres.
//
// The thing worth pinning here is that `visitorId` is REQUIRED on both routes.
// It is the only scoping there is (no auth), so a schema that let it through as
// optional would silently expose every student's history — the handler would
// pass `undefined` to the service, which folds it onto the 'anonymous' visitor
// and happily returns that visitor's threads.
//
// ⚠️ The route destructures its service at require time — stubs go in first.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, serviceStub, resetStubs } = require('../../routeApp')

const conversationService = require('../../../services/conversation.service')
const listConversations = serviceStub(conversationService, 'listConversations', async () => [])
const getConversation = serviceStub(conversationService, 'getConversation', async () => null)

const conversationsRoute = require('../../../routes/conversations')

const UUID = '11111111-2222-4333-8444-555555555555'
const VISITOR = 'visitor-uuid-1'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(conversationsRoute) })
after(async () => app.close())
afterEach(() => resetStubs(listConversations, getConversation))

const get = (url) => app.inject({ method: 'GET', url })

describe('GET /conversations', () => {
  const summary = {
    id: UUID, page: 'chat', title: 'où est le wifi', updatedAt: '2026-03-01T10:00:00Z', messageCount: 4
  }

  it('returns the visitor\'s summaries verbatim', async () => {
    listConversations.set(async () => [summary])

    const res = await get(`/conversations?visitorId=${VISITOR}`)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), [summary])
  })

  it('scopes the read by visitorId', async () => {
    await get(`/conversations?visitorId=${VISITOR}`)
    assert.strictEqual(listConversations.calls[0][0], VISITOR)
  })

  it('defaults the limit to 50', async () => {
    await get(`/conversations?visitorId=${VISITOR}`)
    assert.deepStrictEqual(listConversations.calls[0][1], { limit: 50 })
  })

  it('passes an explicit limit through', async () => {
    await get(`/conversations?visitorId=${VISITOR}&limit=10`)
    assert.deepStrictEqual(listConversations.calls[0][1], { limit: 10 })
  })

  it('returns an empty array rather than a 404 when the visitor has no history', async () => {
    const res = await get(`/conversations?visitorId=${VISITOR}`)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), [])
  })

  const rejected = [
    ['visitorId is absent', '/conversations'],
    ['visitorId is empty', '/conversations?visitorId='],
    ['limit is 0', `/conversations?visitorId=${VISITOR}&limit=0`],
    ['limit is negative', `/conversations?visitorId=${VISITOR}&limit=-1`],
    ['limit is over the 200 cap', `/conversations?visitorId=${VISITOR}&limit=201`],
    ['limit is not an integer', `/conversations?visitorId=${VISITOR}&limit=abc`]
  ]

  for (const [label, url] of rejected) {
    it(`400s when ${label}, without reaching the service`, async () => {
      const res = await get(url)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(listConversations.callCount, 0)
    })
  }

  it('accepts the maximum limit of 200', async () => {
    const res = await get(`/conversations?visitorId=${VISITOR}&limit=200`)
    assert.strictEqual(res.statusCode, 200)
  })
})

describe('GET /conversations/:id', () => {
  const detail = { id: UUID, page: 'chat', title: 'wifi', messages: [] }

  it('returns the conversation when the visitor owns it', async () => {
    getConversation.set(async () => detail)

    const res = await get(`/conversations/${UUID}?visitorId=${VISITOR}`)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), detail)
  })

  it('passes both the id and the visitor to the service', async () => {
    getConversation.set(async () => detail)
    await get(`/conversations/${UUID}?visitorId=${VISITOR}`)

    assert.deepStrictEqual(getConversation.calls[0], [UUID, VISITOR])
  })

  it('404s when the service returns null — unknown and foreign are the same answer', async () => {
    // Deliberately indistinguishable: a 403 on someone else's conversation
    // would confirm the id is real, which is all an enumerator needs.
    getConversation.set(async () => null)

    const res = await get(`/conversations/${UUID}?visitorId=${VISITOR}`)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Conversation not found')
  })

  const rejected = [
    ['the id is not a uuid', `/conversations/not-a-uuid?visitorId=${VISITOR}`],
    ['visitorId is absent', `/conversations/${UUID}`],
    ['visitorId is empty', `/conversations/${UUID}?visitorId=`]
  ]

  for (const [label, url] of rejected) {
    it(`400s when ${label}, without reaching the service`, async () => {
      const res = await get(url)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(getConversation.callCount, 0)
    })
  }
})

'use strict'

// Unit suite for routes/feedback.js — transport only, no Postgres.
//
// `setFeedback` is stubbed, so what is under test is the schema (which bodies
// Fastify rejects before the handler runs) and the mapping from the service's
// `{ ok }` to a status code. The ownership logic behind that boolean has its own
// suite in test/unit/conversation.service.test.js.
//
// ⚠️ Require order below is load-bearing: routes/feedback.js destructures
// `setFeedback` at require time, so the stub has to be installed first.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, serviceStub } = require('../../routeApp')

const conversationService = require('../../../services/conversation.service')
const setFeedback = serviceStub(conversationService, 'setFeedback', async () => ({ ok: true, rating: 1 }))

const feedbackRoute = require('../../../routes/feedback')

const UUID = '11111111-2222-4333-8444-555555555555'
const VISITOR = '99999999-8888-4777-8666-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(feedbackRoute) })
after(async () => app.close())
afterEach(() => setFeedback.reset())

/** @param {Object} body */
const post = (body) => app.inject({ method: 'POST', url: '/feedback', payload: body })

const VALID = { messageId: UUID, visitorId: VISITOR, rating: 1 }

describe('POST /feedback — the happy path', () => {
  it('returns the recorded rating', async () => {
    const res = await post(VALID)
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { ok: true, rating: 1 })
  })

  it('passes visitorId to the service as `anonId`', async () => {
    // The rename is the whole ownership contract: the body's visitorId is an
    // anon_id, never a users.id.
    await post({ ...VALID, rating: -1, comment: 'hors sujet' })

    assert.deepStrictEqual(setFeedback.calls[0][0], {
      messageId: UUID, anonId: VISITOR, rating: -1, comment: 'hors sujet'
    })
  })

  it('echoes back whatever rating the service stored, not what was requested', async () => {
    setFeedback.set(async () => ({ ok: true, rating: 0 }))
    const res = await post({ ...VALID, rating: 0 })
    assert.deepStrictEqual(res.json(), { ok: true, rating: 0 })
  })

  for (const rating of [-1, 0, 1]) {
    it(`accepts rating ${rating}`, async () => {
      const res = await post({ ...VALID, rating })
      assert.strictEqual(res.statusCode, 200)
    })
  }
})

describe('POST /feedback — a message the visitor does not own', () => {
  it('is a 404, never a 403 — a 403 would confirm the message exists', async () => {
    setFeedback.set(async () => ({ ok: false, reason: 'not_found' }))

    const res = await post(VALID)
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Message not found')
  })
})

describe('POST /feedback — the schema', () => {
  const rejected = [
    ['no body at all', undefined],
    ['a missing messageId', { visitorId: VISITOR, rating: 1 }],
    ['a missing visitorId', { messageId: UUID, rating: 1 }],
    ['a missing rating', { messageId: UUID, visitorId: VISITOR }],
    ['a messageId that is not a uuid', { ...VALID, messageId: 'abc' }],
    ['an empty visitorId', { ...VALID, visitorId: '' }],
    ['a rating outside -1|0|1', { ...VALID, rating: 2 }],
    ['a fractional rating', { ...VALID, rating: 0.5 }],
    ['a comment over 500 characters', { ...VALID, comment: 'x'.repeat(501) }]
  ]

  for (const [label, body] of rejected) {
    it(`rejects ${label} with a 400, before the service runs`, async () => {
      const res = await post(body)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(setFeedback.callCount, 0)
    })
  }

  it('coerces a numeric string rating rather than rejecting it', async () => {
    // Fastify's ajv runs with coerceTypes on, so '1' becomes 1 and the enum
    // then passes. Worth pinning: it means the enum guards the VALUE, not the
    // type, and a client sending strings works by accident rather than by
    // contract.
    const res = await post({ ...VALID, rating: '1' })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(setFeedback.calls[0][0].rating, 1)
  })

  it('accepts a comment of exactly 500 characters', async () => {
    const res = await post({ ...VALID, rating: -1, comment: 'x'.repeat(500) })
    assert.strictEqual(res.statusCode, 200)
  })

  it('strips an unknown field rather than rejecting it', async () => {
    // Fastify's ajv runs with removeAdditional:true, so additionalProperties:
    // false STRIPS. Equally safe here, but pinned so nobody "fixes" the schema
    // on the assumption that it 400s.
    const res = await post({ ...VALID, sneaky: 'value' })

    assert.strictEqual(res.statusCode, 200)
    assert.ok(!('sneaky' in setFeedback.calls[0][0]))
  })
})

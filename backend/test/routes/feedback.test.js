'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, stubOllama, jsonResponse } = require('../helper')
const { MessageFeedback } = require('../../models')

const VISITOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const DOC = { name: 'Alternance', type: 'md', score: 0.95 }

/** Runs one /chat exchange and returns its messageId. */
async function answeredMessage (visitorId = VISITOR) {
  stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/chat', payload: { question: 'q', documents: [DOC], visitorId }
  })
  return res.json().messageId
}

const rate = async (payload) => (await getApp()).inject({ method: 'POST', url: '/feedback', payload })

describe('POST /feedback', () => {
  itDb('stores a 👍', async () => {
    const messageId = await answeredMessage()
    const res = await rate({ messageId, visitorId: VISITOR, rating: 1 })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { ok: true, rating: 1 })
    assert.strictEqual((await MessageFeedback.findOne({ where: { message_id: messageId } })).rating, 1)
  })

  itDb('stores a 👎 with its comment', async () => {
    const messageId = await answeredMessage()
    await rate({ messageId, visitorId: VISITOR, rating: -1, comment: 'hors sujet' })

    const row = await MessageFeedback.findOne({ where: { message_id: messageId } })
    assert.strictEqual(row.rating, -1)
    assert.strictEqual(row.comment, 'hors sujet')
  })

  itDb('re-rating updates in place instead of duplicating', async () => {
    const messageId = await answeredMessage()
    await rate({ messageId, visitorId: VISITOR, rating: 1 })
    await rate({ messageId, visitorId: VISITOR, rating: -1 })

    assert.strictEqual(await MessageFeedback.count(), 1)
    assert.strictEqual((await MessageFeedback.findOne({ where: { message_id: messageId } })).rating, -1)
  })

  itDb('rating 0 withdraws the rating', async () => {
    const messageId = await answeredMessage()
    await rate({ messageId, visitorId: VISITOR, rating: 1 })

    const res = await rate({ messageId, visitorId: VISITOR, rating: 0 })
    assert.deepStrictEqual(res.json(), { ok: true, rating: 0 })
    assert.strictEqual(await MessageFeedback.count(), 0)
  })

  // 404 rather than 403: never confirm the message exists to someone who does
  // not own it. This join is the only thing protecting the project's one
  // answer-quality signal from being poisoned.
  itDb('404s when the message belongs to another visitor', async () => {
    const messageId = await answeredMessage(VISITOR)
    const res = await rate({ messageId, visitorId: OTHER, rating: 1 })

    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(await MessageFeedback.count(), 0)
  })

  itDb('404s on an unknown messageId', async () => {
    const res = await rate({
      messageId: '77777777-7777-4777-8777-777777777777', visitorId: VISITOR, rating: 1
    })
    assert.strictEqual(res.statusCode, 404)
  })

  itDb('400s on a malformed body', async () => {
    const messageId = await answeredMessage()

    assert.strictEqual((await rate({ messageId, visitorId: VISITOR })).statusCode, 400)
    assert.strictEqual((await rate({ messageId, visitorId: VISITOR, rating: 2 })).statusCode, 400)
    assert.strictEqual((await rate({ messageId: 'nope', visitorId: VISITOR, rating: 1 })).statusCode, 400)
    assert.strictEqual((await rate({ messageId, visitorId: '', rating: 1 })).statusCode, 400)
    assert.strictEqual(
      (await rate({ messageId, visitorId: VISITOR, rating: -1, comment: 'x'.repeat(501) })).statusCode,
      400
    )
  })
})

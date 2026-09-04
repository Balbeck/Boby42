'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, stubOllama, jsonResponse } = require('../helper')

const VISITOR = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const OTHER = '99999999-9999-4999-8999-999999999999'
const DOCS = [
  { name: 'Alternance', type: 'md', score: 0.95 },
  { name: 'Wi-Fi', type: 'md', score: 0.91 }
]

/** @param {string} question @param {string} visitorId */
async function chat (question, visitorId = VISITOR, documents = DOCS) {
  stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })
  const res = await (await getApp()).inject({
    method: 'POST', url: '/chat', payload: { question, documents, visitorId, language: 'fr' }
  })
  return res.json()
}

const get = async (url) => (await getApp()).inject({ method: 'GET', url })

describe('GET /conversations', () => {
  itDb('lists only the caller’s conversations, newest updated first', async () => {
    const older = await chat('première')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const newer = await chat('deuxième')
    await chat('pas la mienne', OTHER)

    const list = (await get(`/conversations?visitorId=${VISITOR}`)).json()

    assert.deepStrictEqual(list.map((row) => row.id), [newer.conversationId, older.conversationId])
    assert.strictEqual(list[0].title, 'deuxième')
    assert.strictEqual(list[0].page, 'chat')
    assert.strictEqual(list[0].messageCount, 2)
  })

  itDb('returns an empty list for a visitor with no history', async () => {
    await chat('q')
    assert.deepStrictEqual((await get('/conversations?visitorId=nobody')).json(), [])
  })

  itDb('honours limit', async () => {
    await chat('q1'); await chat('q2'); await chat('q3')
    assert.strictEqual((await get(`/conversations?visitorId=${VISITOR}&limit=2`)).json().length, 2)
  })

  itDb('400s without visitorId, and on an out-of-range limit', async () => {
    // visitorId is the ONLY scoping there is here — it cannot be optional.
    assert.strictEqual((await get('/conversations')).statusCode, 400)
    assert.strictEqual((await get(`/conversations?visitorId=${VISITOR}&limit=201`)).statusCode, 400)
    assert.strictEqual((await get(`/conversations?visitorId=${VISITOR}&limit=0`)).statusCode, 400)
  })
})

describe('GET /conversations/:id', () => {
  itDb('reopens one thread with its messages and documents', async () => {
    const { conversationId, messageId } = await chat('alternance ?')
    await (await getApp()).inject({
      method: 'POST', url: '/feedback', payload: { messageId, visitorId: VISITOR, rating: 1 }
    })

    const detail = (await get(`/conversations/${conversationId}?visitorId=${VISITOR}`)).json()

    assert.strictEqual(detail.id, conversationId)
    assert.strictEqual(detail.title, 'alternance ?')
    assert.deepStrictEqual(detail.messages.map((message) => message.role), ['user', 'assistant'])

    const assistant = detail.messages[1]
    assert.strictEqual(assistant.rating, 1)
    assert.strictEqual(assistant.language, 'fr')
    // Documents come back in position order, typed, and WITHOUT content — the
    // frontend re-fetches that lazily on expand.
    assert.deepStrictEqual(assistant.documents.map((doc) => doc.name), ['Alternance', 'Wi-Fi'])
    assert.deepStrictEqual(Object.keys(assistant.documents[0]).sort(), ['name', 'score', 'type', 'url'])
  })

  itDb('404s on another visitor’s conversation — a 404, never a 403', async () => {
    const { conversationId } = await chat('q')
    assert.strictEqual((await get(`/conversations/${conversationId}?visitorId=${OTHER}`)).statusCode, 404)
  })

  itDb('404s on an unknown id', async () => {
    const res = await get(`/conversations/88888888-8888-4888-8888-888888888888?visitorId=${VISITOR}`)
    assert.strictEqual(res.statusCode, 404)
  })

  itDb('400s on a malformed id and without visitorId', async () => {
    const { conversationId } = await chat('q')
    assert.strictEqual((await get(`/conversations/not-a-uuid?visitorId=${VISITOR}`)).statusCode, 400)
    assert.strictEqual((await get(`/conversations/${conversationId}`)).statusCode, 400)
  })
})

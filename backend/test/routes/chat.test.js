'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, stubOllama, jsonResponse, ndjsonResponse, connectionRefused } = require('../helper')
const { embeddingFor } = require('../fixtures/embeddings')
const { Conversation, Message, MessageDocument } = require('../../models')
const { sequelize } = require('../../models')
const { QueryTypes } = require('sequelize')

const VISITOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC = { name: 'Alternance', type: 'md', score: 0.95, url: '/BaseDocumentaire/fr/Notion/Alternance.md' }

/** @param {object} body */
const post = async (body) => (await getApp()).inject({ method: 'POST', url: '/chat', payload: body })

/** @param {string} payload NDJSON body @returns {any[]} */
const parseNdjson = (payload) =>
  payload.split('\n').filter(Boolean).map((line) => JSON.parse(line))

describe('POST /chat — request validation', () => {
  itDb('rejects a missing or empty question with 400', async () => {
    assert.strictEqual((await post({})).statusCode, 400)
    assert.strictEqual((await post({ question: '' })).statusCode, 400)
  })

  itDb('rejects an unknown language and a malformed conversationId', async () => {
    assert.strictEqual((await post({ question: 'q', language: 'de' })).statusCode, 400)
    assert.strictEqual((await post({ question: 'q', conversationId: 'nope' })).statusCode, 400)
  })

  itDb('rejects a document row with an unknown type', async () => {
    assert.strictEqual((await post({ question: 'q', documents: [{ name: 'A', type: 'txt' }] })).statusCode, 400)
    assert.strictEqual((await post({ question: 'q', documents: [{ type: 'md' }] })).statusCode, 400)
  })

  itDb('STRIPS an extra document property rather than rejecting it', async () => {
    // Fastify's ajv runs with removeAdditional: true, so `additionalProperties:
    // false` deletes the field instead of answering 400. Equally safe — the
    // handler never sees it — but the status code is 200, not 400. Pinned so a
    // future reader does not "fix" the schema on a wrong assumption.
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })

    const res = await post({
      question: 'q',
      documents: [{ ...DOC, path: '/etc/passwd', content: 'injected' }],
      visitorId: VISITOR
    })

    assert.strictEqual(res.statusCode, 200)
    // The path is re-resolved through the whitelist, never taken from the body.
    assert.ok(res.json().sources[0].path.endsWith('/BaseDocumentaire/Fr/Notion/Alternance.md'))
  })

  itDb('rejects more than 10 documents', async () => {
    const documents = Array.from({ length: 11 }, () => ({ name: 'A', type: 'md' }))
    assert.strictEqual((await post({ question: 'q', documents })).statusCode, 400)
  })
})

describe('POST /chat — JSON path', () => {
  itDb('answers and records the exchange', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'La réponse.' }) })

    const res = await post({ question: 'alternance ?', language: 'fr', documents: [DOC], visitorId: VISITOR })
    const body = res.json()

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(body.answer, 'La réponse.')
    assert.deepStrictEqual(body.sources.map((doc) => doc.name), ['Alternance'])
    assert.ok(body.conversationId)
    assert.ok(body.messageId)

    // Persisted: one conversation, the user/assistant pair, the document row.
    assert.strictEqual(await Conversation.count(), 1)
    const messages = await Message.findAll({ where: { conversation_id: body.conversationId } })
    assert.strictEqual(messages.length, 2)
    const assistant = messages.find((message) => message.role === 'assistant')
    assert.strictEqual(assistant.id, body.messageId)
    assert.strictEqual(assistant.error_code, null)
    assert.strictEqual(assistant.document_count, 1)
    assert.ok(assistant.latency_ms >= 0)
    assert.strictEqual(await MessageDocument.count({ where: { message_id: body.messageId } }), 1)
  })

  itDb('appends to the conversation whose id is passed back', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })

    const first = (await post({ question: 'q1', documents: [DOC], visitorId: VISITOR })).json()
    const second = (await post({
      question: 'q2', documents: [DOC], visitorId: VISITOR, conversationId: first.conversationId
    })).json()

    assert.strictEqual(second.conversationId, first.conversationId)
    assert.strictEqual(await Conversation.count(), 1)
    assert.strictEqual(await Message.count(), 4)
  })

  itDb('returns the fallback and logs a no_match event when nothing resolved', async () => {
    stubOllama({ '/api/generate': () => assert.fail('no generation expected') })

    const body = (await post({ question: 'zzz', documents: [], visitorId: VISITOR })).json()

    assert.deepStrictEqual(body.sources, [])
    assert.match(body.answer, /aucune information à ce sujet/)

    const events = await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT })
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'no_match')
    assert.strictEqual(events[0].conversation_id, body.conversationId)
  })

  itDb('retrieves for itself when `documents` is omitted — the one-call fallback', async () => {
    stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }),
      '/api/generate': () => jsonResponse({ response: 'ok' })
    })

    const body = (await post({ question: 'alternance ?', visitorId: VISITOR })).json()
    assert.ok(body.sources.some((doc) => doc.name === 'Alternance'))
  })

  itDb('returns 502 and records error_code=ollama_error when generation fails', async () => {
    stubOllama({ '/api/generate': () => { throw connectionRefused() } })

    const res = await post({ question: 'q', documents: [DOC], visitorId: VISITOR })

    assert.strictEqual(res.statusCode, 502)
    assert.match(res.json().message, /Failed to get an answer from Ollama/)

    // The failed exchange is still in the DB — an invisible failure is worse.
    const [assistant] = await Message.findAll({ where: { role: 'assistant' } })
    assert.strictEqual(assistant.error_code, 'ollama_error')
    assert.strictEqual(assistant.content, '')
  })

  itDb('logs no no_match event on the error path', async () => {
    // An ollama_error is not "the document base is missing this question".
    stubOllama({ '/api/generate': () => { throw connectionRefused() } })
    await post({ question: 'q', documents: [DOC], visitorId: VISITOR })

    const events = await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT })
    assert.deepStrictEqual(events, [])
  })
})

describe('POST /chat — NDJSON stream', () => {
  itDb('emits one token line per fragment then a terminal done line', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['Bon', 'jour']) })

    const res = await post({ question: 'q', documents: [DOC], visitorId: VISITOR, stream: true })

    assert.strictEqual(res.statusCode, 200)
    assert.match(res.headers['content-type'], /application\/x-ndjson/)

    const frames = parseNdjson(res.payload)
    assert.deepStrictEqual(frames.slice(0, 2), [
      { type: 'token', value: 'Bon' },
      { type: 'token', value: 'jour' }
    ])

    const done = frames.at(-1)
    assert.strictEqual(done.type, 'done')
    // The done line carries exactly what the JSON body would have.
    assert.strictEqual(done.answer, 'Bonjour')
    assert.deepStrictEqual(done.sources.map((doc) => doc.name), ['Alternance'])
    assert.ok(done.conversationId)
    assert.ok(done.messageId)
  })

  itDb('records the streamed exchange like the JSON one', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['ok']) })

    const res = await post({ question: 'q', documents: [DOC], visitorId: VISITOR, stream: true })
    const done = parseNdjson(res.payload).at(-1)

    const assistant = await Message.findOne({ where: { id: done.messageId } })
    assert.strictEqual(assistant.content, 'ok')
    assert.strictEqual(assistant.document_count, 1)
  })

  itDb('emits the done line with no token line for the no-documents fallback', async () => {
    stubOllama({ '/api/generate': () => assert.fail('no generation expected') })

    const frames = parseNdjson((await post({
      question: 'zzz', documents: [], visitorId: VISITOR, stream: true
    })).payload)

    assert.strictEqual(frames.length, 1)
    assert.strictEqual(frames[0].type, 'done')
    assert.deepStrictEqual(frames[0].sources, [])
  })

  itDb('reports a mid-stream failure as an error LINE, still on HTTP 200', async () => {
    // Headers go out before generation starts, so a 502 is no longer possible —
    // a client that treats a non-200 as the only failure signal would hang.
    stubOllama({ '/api/generate': () => { throw connectionRefused() } })

    const res = await post({ question: 'q', documents: [DOC], visitorId: VISITOR, stream: true })

    assert.strictEqual(res.statusCode, 200)
    const frames = parseNdjson(res.payload)
    assert.strictEqual(frames.at(-1).type, 'error')
    assert.match(frames.at(-1).message, /Failed to get an answer from Ollama/)

    const [assistant] = await Message.findAll({ where: { role: 'assistant' } })
    assert.strictEqual(assistant.error_code, 'ollama_error')
  })
})

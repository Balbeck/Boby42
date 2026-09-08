'use strict'

// Unit suite for routes/chatDocuments.js — transport only, no Postgres, no Ollama.
//
// Phase 1 of the two-call /chat. Two things are worth pinning: the 502 body
// distinguishes "Ollama is down" from every other retrieval failure (the
// frontend shows that message verbatim, so it is the only thing a student sees),
// and a failed search is still written to the DB with `retrieval_error` — a
// search that fails silently is a gap nobody ever finds.
//
// ⚠️ The route destructures its services at require time — stubs go first.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, serviceStub, resetStubs } = require('../../routeApp')

const retriever = require('../../../services/retriever.service')
const conversationService = require('../../../services/conversation.service')

const ROWS = {
  count: 2,
  documents: [
    { name: 'Wi-Fi', score: 0.94, type: 'md', url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md' },
    { name: 'libft', score: 0.91, type: 'pdf', url: '/subjectspdf/libft.pdf' }
  ]
}

const retrieveUnified = serviceStub(retriever, 'retrieveUnified', async () => ROWS)
const recordExchange = serviceStub(conversationService, 'recordExchange', async () => ({
  conversationId: 'conv-1', messageId: 'msg-1'
}))

const chatDocumentsRoute = require('../../../routes/chatDocuments')

const UUID = '11111111-2222-4333-8444-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(chatDocumentsRoute) })
after(async () => app.close())
afterEach(() => resetStubs(retrieveUnified, recordExchange))

const post = (body) => app.inject({ method: 'POST', url: '/chat/documents', payload: body })

/** @param {string} [code] */
function ollamaError (code) {
  const err = new Error('boom')
  if (code) err.code = code
  return err
}

describe('POST /chat/documents — the happy path', () => {
  it('returns count and the display rows in the /archiviste shape', async () => {
    const res = await post({ question: 'où est le wifi' })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), ROWS)
  })

  it('defaults the language to fr', async () => {
    await post({ question: 'q' })
    assert.deepStrictEqual(retrieveUnified.calls[0], ['q', 'fr'])
  })

  for (const language of ['fr', 'en', 'origin']) {
    it(`passes language=${language} through to retrieval`, async () => {
      await post({ question: 'q', language })
      assert.strictEqual(retrieveUnified.calls[0][1], language)
    })
  }

  it('writes nothing on success — no exchange exists yet at phase 1', async () => {
    await post({ question: 'q', visitorId: 'anon-7' })
    assert.strictEqual(recordExchange.callCount, 0)
  })

  it('returns count 0 with an empty list when nothing matched', async () => {
    retrieveUnified.set(async () => ({ count: 0, documents: [] }))

    const res = await post({ question: 'tricher avec l\'IA' })
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { count: 0, documents: [] })
  })
})

describe('POST /chat/documents — retrieval failed', () => {
  it('says Ollama is unreachable when the embedding call could not connect', async () => {
    // The frontend renders this message verbatim; "Ollama is down" and "the
    // store is unreadable" are different problems for whoever is on call.
    retrieveUnified.set(async () => { throw ollamaError('OLLAMA_UNREACHABLE') })

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Document search failed - Ollama server is unreachable')
  })

  it('falls back to the generic message for any other failure', async () => {
    retrieveUnified.set(async () => { throw ollamaError() })

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Failed to search the document base')
  })

  it('records the failed search with retrieval_error before returning the 502', async () => {
    retrieveUnified.set(async () => { throw ollamaError() })
    await post({ question: 'q', visitorId: 'anon-7', conversationId: UUID, language: 'en' })

    const [input] = recordExchange.calls[0]
    assert.strictEqual(input.page, 'chat')
    assert.strictEqual(input.errorCode, 'retrieval_error')
    assert.strictEqual(input.anonId, 'anon-7')
    assert.strictEqual(input.conversationId, UUID)
    assert.strictEqual(input.answer, null)
    assert.strictEqual(input.language, 'en')
    assert.deepStrictEqual(input.documents, [])
    assert.ok(Number.isFinite(input.latencyMs))
  })

  it('logs a null language rather than defaulting it to fr on the error path', async () => {
    // Deliberately different from the success path: nothing was searched, so
    // recording "fr" would invent a fact.
    retrieveUnified.set(async () => { throw ollamaError() })
    await post({ question: 'q' })

    assert.strictEqual(recordExchange.calls[0][0].language, null)
  })

  it('still returns the 502 when the error-path write ALSO fails', async () => {
    retrieveUnified.set(async () => { throw ollamaError('OLLAMA_UNREACHABLE') })
    recordExchange.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Document search failed - Ollama server is unreachable')
  })
})

describe('POST /chat/documents — the schema', () => {
  const rejected = [
    ['no body', undefined],
    ['a missing question', {}],
    ['an empty question', { question: '' }],
    ['an unknown language', { question: 'q', language: 'de' }],
    ['a conversationId that is not a uuid', { question: 'q', conversationId: 'abc' }]
  ]

  for (const [label, body] of rejected) {
    it(`rejects ${label} with a 400, before retrieval runs`, async () => {
      const res = await post(body)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(retrieveUnified.callCount, 0)
    })
  }
})

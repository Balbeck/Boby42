'use strict'

// Unit suite for routes/chat.js — transport only, no Postgres, no Ollama.
//
// This route is the one place where a *logging* failure could break a *user*
// answer, so most of what follows is about that: every persistence call is
// wrapped, and the suite proves the 200 survives each one throwing. The other
// half is the two response formats — one JSON body vs the NDJSON stream — which
// have to carry exactly the same fields.
//
// ⚠️ routes/chat.js destructures its three services at require time — the stubs
// below are installed before it is required.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp, serviceStub, resetStubs } = require('../../routeApp')

const orchestrator = require('../../../services/orchestrator.service')
const conversationService = require('../../../services/conversation.service')

const SOURCE = { name: 'Wi-Fi', type: 'md', url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md', path: '/abs/Wi-Fi.md', score: 0.94 }

const getAnswer = serviceStub(orchestrator, 'getAnswer', async () => ({ answer: 'au 2e', sources: [SOURCE] }))
const recordExchange = serviceStub(conversationService, 'recordExchange', async () => ({
  conversationId: 'conv-1', messageId: 'msg-1'
}))
const logEvent = serviceStub(conversationService, 'logEvent', async () => undefined)

const chatRoute = require('../../../routes/chat')

const UUID = '11111111-2222-4333-8444-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(chatRoute) })
after(async () => app.close())
afterEach(() => resetStubs(getAnswer, recordExchange, logEvent))

/** @param {Object} body */
const post = (body) => app.inject({ method: 'POST', url: '/chat', payload: body })

/**
 * Parses an NDJSON stream body into its lines.
 * @param {string} payload
 */
const lines = (payload) => payload.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

describe('POST /chat — the JSON response', () => {
  it('returns the answer, sources and both ids', async () => {
    const res = await post({ question: 'où est le wifi' })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), {
      answer: 'au 2e', sources: [SOURCE], conversationId: 'conv-1', messageId: 'msg-1'
    })
  })

  it('defaults the language to fr when the body omits it', async () => {
    await post({ question: 'q' })

    assert.strictEqual(getAnswer.calls[0][2], 'fr')
    assert.strictEqual(recordExchange.calls[0][0].language, 'fr')
  })

  for (const language of ['fr', 'en', 'origin']) {
    it(`passes language=${language} to both the orchestrator and the log`, async () => {
      await post({ question: 'q', language })

      assert.strictEqual(getAnswer.calls[0][2], language)
      assert.strictEqual(recordExchange.calls[0][0].language, language)
    })
  }

  it('hands the client-supplied documents straight to the orchestrator', async () => {
    // Phase 2 of the two-call flow: no second embedding, the rows come back
    // from the client — and getAnswer re-resolves each name through the
    // whitelists, so the `url` in them is never used to open anything.
    const documents = [{ name: 'Wi-Fi', type: 'md', score: 0.94, url: '/x' }]
    await post({ question: 'q', documents })

    assert.deepStrictEqual(getAnswer.calls[0][1], documents)
  })

  it('passes documents as undefined when absent, so the one-call fallback runs', async () => {
    await post({ question: 'q' })
    assert.strictEqual(getAnswer.calls[0][1], undefined)
  })

  it('logs the exchange on page `chat` with the sources as documents', async () => {
    await post({ question: 'où est le wifi', visitorId: 'anon-7', conversationId: UUID })

    const [input] = recordExchange.calls[0]
    assert.strictEqual(input.page, 'chat')
    assert.strictEqual(input.anonId, 'anon-7')
    assert.strictEqual(input.conversationId, UUID)
    assert.strictEqual(input.question, 'où est le wifi')
    assert.strictEqual(input.answer, 'au 2e')
    assert.deepStrictEqual(input.documents, [SOURCE])
    assert.strictEqual(input.errorCode, null)
    assert.ok(Number.isFinite(input.latencyMs))
  })

  it('does not log a no_match event when documents were found', async () => {
    await post({ question: 'q' })
    assert.strictEqual(logEvent.callCount, 0)
  })
})

describe('POST /chat — a question that matched nothing', () => {
  it('logs a no_match event against the recorded conversation', async () => {
    getAnswer.set(async () => ({ answer: 'je ne trouve pas', sources: [] }))
    await post({ question: 'tricher avec l\'IA', visitorId: 'anon-7', language: 'en' })

    assert.strictEqual(logEvent.callCount, 1)
    assert.deepStrictEqual(logEvent.calls[0][0], {
      anonId: 'anon-7',
      conversationId: 'conv-1',
      type: 'no_match',
      payload: { question: 'tricher avec l\'IA', language: 'en' }
    })
  })

  it('still answers 200 with the fallback text', async () => {
    getAnswer.set(async () => ({ answer: 'je ne trouve pas', sources: [] }))

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json().sources, [])
  })
})

describe('POST /chat — generation failed', () => {
  it('is a 502 and the exchange is still recorded with ollama_error', async () => {
    getAnswer.set(async () => { throw new Error('ollama down') })

    const res = await post({ question: 'q', visitorId: 'anon-7' })

    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Failed to get an answer from Ollama')

    const [input] = recordExchange.calls[0]
    assert.strictEqual(input.errorCode, 'ollama_error')
    assert.strictEqual(input.answer, null)
    assert.deepStrictEqual(input.documents, [])
  })

  it('does not log a no_match — an ollama error is not a missing document', async () => {
    getAnswer.set(async () => { throw new Error('ollama down') })
    await post({ question: 'q' })

    assert.strictEqual(logEvent.callCount, 0)
  })

  it('still returns the 502 when recording the failure ALSO fails', async () => {
    getAnswer.set(async () => { throw new Error('ollama down') })
    recordExchange.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 502)
  })
})

describe('POST /chat — persistence must never break the answer', () => {
  it('answers 200 with no ids when recordExchange throws', async () => {
    recordExchange.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q', conversationId: UUID })
    const body = res.json()

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(body.answer, 'au 2e')
    // recordOk returns {} on failure, so the destructuring default kicks in and
    // the request's own conversationId is echoed back.
    assert.strictEqual(body.conversationId, UUID)
    assert.strictEqual(body.messageId, undefined)
  })

  it('omits conversationId entirely when none was sent and the write failed', async () => {
    recordExchange.set(async () => { throw new Error('db down') })

    const body = (await post({ question: 'q' })).json()
    assert.strictEqual(body.conversationId, undefined)
  })

  it('answers 200 when logEvent throws on the no-match path', async () => {
    getAnswer.set(async () => ({ answer: 'rien', sources: [] }))
    logEvent.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q' })
    assert.strictEqual(res.statusCode, 200)
  })
})

describe('POST /chat — the NDJSON stream', () => {
  it('emits one token line per fragment, then a done line', async () => {
    getAnswer.set(async (question, documents, language, { onToken }) => {
      onToken('au ')
      onToken('2e')
      return { answer: 'au 2e', sources: [SOURCE] }
    })

    const res = await post({ question: 'q', stream: true })

    assert.strictEqual(res.statusCode, 200)
    assert.match(res.headers['content-type'], /application\/x-ndjson/)
    assert.deepStrictEqual(lines(res.payload), [
      { type: 'token', value: 'au ' },
      { type: 'token', value: '2e' },
      { type: 'done', answer: 'au 2e', sources: [SOURCE], conversationId: 'conv-1', messageId: 'msg-1' }
    ])
  })

  it('sets cache-control so no proxy buffers the stream into one lump', async () => {
    const res = await post({ question: 'q', stream: true })
    assert.strictEqual(res.headers['cache-control'], 'no-cache, no-transform')
  })

  it('carries exactly the fields the JSON body has on its done line', async () => {
    // The two formats are one contract — a client can read `done.answer` or
    // reassemble the tokens and get the same thing.
    const streamed = lines((await post({ question: 'q', stream: true })).payload).at(-1)
    const json = (await post({ question: 'q' })).json()

    const { type, ...rest } = streamed
    assert.strictEqual(type, 'done')
    assert.deepStrictEqual(rest, json)
  })

  it('emits no token line at all on the no-documents fallback', async () => {
    // The fallback makes no Ollama call, so there is nothing to stream.
    getAnswer.set(async () => ({ answer: 'je ne trouve pas', sources: [] }))

    const emitted = lines((await post({ question: 'q', stream: true })).payload)
    assert.strictEqual(emitted.length, 1)
    assert.strictEqual(emitted[0].type, 'done')
  })

  it('reports a generation failure as an error line, NOT a 502', async () => {
    // Headers went out with the 200 before generation even started, so the
    // status can no longer change. A client must look for this line.
    getAnswer.set(async () => { throw new Error('ollama down') })

    const res = await post({ question: 'q', stream: true })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(lines(res.payload), [
      { type: 'error', message: 'Failed to get an answer from Ollama' }
    ])
  })

  it('records the failed exchange on the stream path too', async () => {
    getAnswer.set(async () => { throw new Error('ollama down') })
    await post({ question: 'q', stream: true })

    assert.strictEqual(recordExchange.calls[0][0].errorCode, 'ollama_error')
  })

  it('logs a no_match event on an empty stream result', async () => {
    getAnswer.set(async () => ({ answer: 'rien', sources: [] }))
    await post({ question: 'q', stream: true, visitorId: 'anon-7' })

    assert.strictEqual(logEvent.callCount, 1)
    assert.strictEqual(logEvent.calls[0][0].type, 'no_match')
  })

  it('passes a live AbortSignal to the orchestrator so a lost client stops Ollama', async () => {
    // Sampled INSIDE the call, not after: `inject`'s mock response emits
    // 'close' with `writableFinished` still false once the request is over, so
    // the controller does end up aborted — which says nothing about whether the
    // signal was usable while generation ran. That is what matters here (the
    // real disconnect path needs a real socket; see the DB route suite).
    let signalDuringGeneration
    getAnswer.set(async (q, d, l, opts) => {
      signalDuringGeneration = { isSignal: opts.signal instanceof AbortSignal, aborted: opts.signal.aborted }
      return { answer: 'x', sources: [] }
    })
    await post({ question: 'q', stream: true })

    assert.deepStrictEqual(signalDuringGeneration, { isSignal: true, aborted: false })
  })

  it('streams even when the persistence write fails', async () => {
    recordExchange.set(async () => { throw new Error('db down') })

    const emitted = lines((await post({ question: 'q', stream: true })).payload)
    assert.strictEqual(emitted.at(-1).type, 'done')
    assert.strictEqual(emitted.at(-1).answer, 'au 2e')
  })
})

describe('POST /chat — the schema', () => {
  const rejected = [
    ['no body', undefined],
    ['a missing question', { language: 'fr' }],
    ['an empty question', { question: '' }],
    ['an unknown language', { question: 'q', language: 'de' }],
    ['a conversationId that is not a uuid', { question: 'q', conversationId: 'abc' }],
    ['more than 10 documents', { question: 'q', documents: Array.from({ length: 11 }, () => ({ name: 'a', type: 'md' })) }],
    ['a document with no type', { question: 'q', documents: [{ name: 'a' }] }],
    ['a document with an unknown type', { question: 'q', documents: [{ name: 'a', type: 'docx' }] }],
    ['a document name over 300 characters', { question: 'q', documents: [{ name: 'x'.repeat(301), type: 'md' }] }],
    ['an empty document name', { question: 'q', documents: [{ name: '', type: 'md' }] }]
  ]

  for (const [label, body] of rejected) {
    it(`rejects ${label} with a 400, before the orchestrator runs`, async () => {
      const res = await post(body)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(getAnswer.callCount, 0)
    })
  }

  it('accepts exactly 10 documents', async () => {
    const documents = Array.from({ length: 10 }, (_, i) => ({ name: `doc-${i}`, type: 'md' }))
    const res = await post({ question: 'q', documents })
    assert.strictEqual(res.statusCode, 200)
  })

  it('strips extra document fields instead of rejecting them', async () => {
    // additionalProperties:false with ajv's removeAdditional STRIPS. Safe — the
    // handler never sees `path`, and every name is re-resolved through the
    // whitelist anyway — but pinned so nobody "fixes" the schema expecting a 400.
    const res = await post({
      question: 'q',
      documents: [{ name: 'Wi-Fi', type: 'md', path: '/etc/passwd', content: 'x' }]
    })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(getAnswer.calls[0][1], [{ name: 'Wi-Fi', type: 'md' }])
  })

  it('accepts an empty documents array — "we looked and found nothing"', async () => {
    const res = await post({ question: 'q', documents: [] })
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(getAnswer.calls[0][1], [])
  })
})

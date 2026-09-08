'use strict'

// Unit suite for routes/archiviste.js — transport only, no Postgres, no Ollama.
//
// Retrieval and persistence are stubbed; `resolveNotionDir` and
// `resolveSubjectsPdfFile` are left REAL, because the route's most interesting
// job is turning a retrieval hit into (a) a URL the browser can fetch and (b) an
// on-disk path for the log — and the whole point of the second one is that it
// goes through the read whitelists rather than being concatenated from a
// request string. Stubbing them would delete the property under test.
//
// ⚠️ The route destructures four services at require time — stubs go first.

const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { buildRouteApp, serviceStub, resetStubs } = require('../../routeApp')

const retriever = require('../../../services/retriever.service')
const conversationService = require('../../../services/conversation.service')

// Real names from data/, so the whitelist resolution below has something to find.
const PDF_BASENAME = '42_Multilayer_Perceptron.en.subject.pdf'
const PDF_NAME = PDF_BASENAME.replace(/\.pdf$/, '')

const EMPTY = { documents: [], subjectsPdf: [] }

const retrieveWithSubjectsPdf = serviceStub(retriever, 'retrieveWithSubjectsPdf', async () => EMPTY)
const recordExchange = serviceStub(conversationService, 'recordExchange', async () => ({
  conversationId: 'conv-1', messageId: 'msg-1'
}))
const logEvent = serviceStub(conversationService, 'logEvent', async () => undefined)

const archivisteRoute = require('../../../routes/archiviste')

const UUID = '11111111-2222-4333-8444-555555555555'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => { app = await buildRouteApp(archivisteRoute) })
after(async () => app.close())
afterEach(() => resetStubs(retrieveWithSubjectsPdf, recordExchange, logEvent))

const post = (body) => app.inject({ method: 'POST', url: '/archiviste', payload: body })

describe('POST /archiviste — building the result rows', () => {
  it('strips .md and builds a language-scoped Notion url', async () => {
    retrieveWithSubjectsPdf.set(async () => ({ documents: [{ name: 'Wi-Fi.md', score: 0.94 }], subjectsPdf: [] }))

    const body = (await post({ question: 'q', language: 'en' })).json()
    assert.deepStrictEqual(body.documents, [{
      name: 'Wi-Fi', score: 0.94, type: 'md', url: '/BaseDocumentaire/en/Notion/Wi-Fi.md'
    }])
  })

  it('url-encodes a Notion name containing a space', async () => {
    // `Visiter le campus.md` is a real document — the frontend fetches this URL
    // as-is, so an unencoded space would 404 on the way back.
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [{ name: 'Visiter le campus.md', score: 0.9 }], subjectsPdf: []
    }))

    const body = (await post({ question: 'q', language: 'fr' })).json()
    assert.strictEqual(body.documents[0].url, '/BaseDocumentaire/fr/Notion/Visiter%20le%20campus.md')
    assert.strictEqual(body.documents[0].name, 'Visiter le campus')
  })

  it('strips .pdf and builds a language-agnostic subject url', async () => {
    // Subjects are English-only — no language segment, by design.
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [], subjectsPdf: [{ filename: `/data/SubjectsPdf/Machine_Learning/${PDF_BASENAME}`, score: 0.91 }]
    }))

    const body = (await post({ question: 'q', language: 'fr' })).json()
    assert.deepStrictEqual(body.documents, [{
      name: PDF_NAME, score: 0.91, type: 'pdf', url: `/subjectspdf/${encodeURIComponent(PDF_BASENAME)}`
    }])
  })

  it('keeps only the basename of a subject\'s stored path', async () => {
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [], subjectsPdf: [{ filename: '/anything/at/all/Libft.en.subject.pdf', score: 0.9 }]
    }))

    const body = (await post({ question: 'q', language: 'fr' })).json()
    assert.strictEqual(body.documents[0].url, '/subjectspdf/Libft.en.subject.pdf')
  })

  it('puts Notion rows before PDF rows and counts them all', async () => {
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [{ name: 'Wi-Fi.md', score: 0.94 }, { name: 'Badge perdu.md', score: 0.92 }],
      subjectsPdf: [{ filename: `/x/${PDF_BASENAME}`, score: 0.91 }]
    }))

    const body = (await post({ question: 'q', language: 'fr' })).json()
    assert.strictEqual(body.count, 3)
    assert.deepStrictEqual(body.documents.map((d) => d.type), ['md', 'md', 'pdf'])
  })

  it('returns count 0 and both ids when nothing matched', async () => {
    const body = (await post({ question: 'q', language: 'fr' })).json()
    assert.deepStrictEqual(body, {
      count: 0, documents: [], conversationId: 'conv-1', messageId: 'msg-1'
    })
  })
})

describe('POST /archiviste — what gets logged', () => {
  it('resolves each row\'s real on-disk path through the read whitelists', async () => {
    // Never built from a request string: the md path comes from
    // resolveNotionDir(language) and the pdf path from the basename whitelist.
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [{ name: 'Badge perdu.md', score: 0.94 }],
      subjectsPdf: [{ filename: `/x/${PDF_BASENAME}`, score: 0.91 }]
    }))

    await post({ question: 'q', language: 'fr' })

    const [md, pdf] = recordExchange.calls[0][0].documents
    assert.ok(md.path.endsWith(path.join('BaseDocumentaire', 'Fr', 'Notion', 'Badge perdu.md')), md.path)
    assert.ok(pdf.path.endsWith(path.join('SubjectsPdf', 'Machine_Learning', PDF_BASENAME)), pdf.path)
  })

  it('resolves the md path against the requested language copy', async () => {
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [{ name: 'Badge perdu.md', score: 0.9 }], subjectsPdf: []
    }))

    await post({ question: 'q', language: 'en' })
    assert.ok(recordExchange.calls[0][0].documents[0].path.includes(path.join('BaseDocumentaire', 'En')))
  })

  it('resolves `origin` to the untranslated retrieval store', async () => {
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [{ name: 'Badge perdu.md', score: 0.9 }], subjectsPdf: []
    }))

    await post({ question: 'q', language: 'origin' })
    assert.ok(recordExchange.calls[0][0].documents[0].path.includes(path.join('documents', 'Notion')))
  })

  it('logs a null path for a subject the whitelist does not know', async () => {
    // A stale store entry must be logged as "unresolved", not as a fabricated
    // path pointing nowhere.
    retrieveWithSubjectsPdf.set(async () => ({
      documents: [], subjectsPdf: [{ filename: '/x/Nope.pdf', score: 0.9 }]
    }))

    await post({ question: 'q', language: 'fr' })
    assert.strictEqual(recordExchange.calls[0][0].documents[0].path, null)
  })

  it('records the exchange on page `archiviste` with no answer text', async () => {
    await post({ question: 'où est le wifi', language: 'fr', visitorId: 'anon-7', conversationId: UUID })

    const [input] = recordExchange.calls[0]
    assert.strictEqual(input.page, 'archiviste')
    assert.strictEqual(input.anonId, 'anon-7')
    assert.strictEqual(input.conversationId, UUID)
    // There is no LLM here — the assistant row carries only the documents.
    assert.strictEqual(input.answer, null)
    assert.strictEqual(input.errorCode, null)
    assert.ok(Number.isFinite(input.latencyMs))
  })

  it('logs a no_match event when nothing matched', async () => {
    await post({ question: 'tricher avec l\'IA', language: 'fr', visitorId: 'anon-7' })

    assert.strictEqual(logEvent.callCount, 1)
    assert.deepStrictEqual(logEvent.calls[0][0], {
      anonId: 'anon-7',
      conversationId: 'conv-1',
      type: 'no_match',
      payload: { question: 'tricher avec l\'IA', language: 'fr' }
    })
  })

  it('logs no event when something matched', async () => {
    retrieveWithSubjectsPdf.set(async () => ({ documents: [{ name: 'Wi-Fi.md', score: 0.94 }], subjectsPdf: [] }))
    await post({ question: 'q', language: 'fr' })

    assert.strictEqual(logEvent.callCount, 0)
  })
})

describe('POST /archiviste — persistence must never break the response', () => {
  it('answers 200 and echoes the request conversationId when the write throws', async () => {
    recordExchange.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q', language: 'fr', conversationId: UUID })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.json().conversationId, UUID)
    assert.strictEqual(res.json().messageId, undefined)
  })

  it('answers 200 when logEvent throws on the no-match path', async () => {
    logEvent.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q', language: 'fr' })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.json().count, 0)
  })
})

describe('POST /archiviste — retrieval failed', () => {
  /** @param {string} [code] */
  const failWith = (code) => {
    const err = new Error('boom')
    if (code) err.code = code
    retrieveWithSubjectsPdf.set(async () => { throw err })
  }

  it('says Ollama is unreachable when the embedding call could not connect', async () => {
    failWith('OLLAMA_UNREACHABLE')

    const res = await post({ question: 'q', language: 'fr' })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Document search failed - Ollama server is unreachable')
  })

  it('falls back to the generic message for any other failure', async () => {
    failWith()

    const res = await post({ question: 'q', language: 'fr' })
    assert.strictEqual(res.statusCode, 502)
    assert.strictEqual(res.json().message, 'Failed to search the document base')
  })

  it('records the failed exchange with retrieval_error and the real language', async () => {
    failWith()
    await post({ question: 'q', language: 'en', visitorId: 'anon-7' })

    const [input] = recordExchange.calls[0]
    assert.strictEqual(input.errorCode, 'retrieval_error')
    assert.strictEqual(input.language, 'en')
    assert.deepStrictEqual(input.documents, [])
  })

  it('still returns the 502 when the error-path write ALSO fails', async () => {
    failWith()
    recordExchange.set(async () => { throw new Error('db down') })

    const res = await post({ question: 'q', language: 'fr' })
    assert.strictEqual(res.statusCode, 502)
  })
})

describe('POST /archiviste — the schema', () => {
  const rejected = [
    ['no body', undefined],
    ['a missing question', { language: 'fr' }],
    ['a missing language — unlike /chat, it is required here', { question: 'q' }],
    ['an empty question', { question: '', language: 'fr' }],
    ['an unknown language', { question: 'q', language: 'de' }],
    ['a conversationId that is not a uuid', { question: 'q', language: 'fr', conversationId: 'abc' }]
  ]

  for (const [label, body] of rejected) {
    it(`rejects ${label} with a 400, before retrieval runs`, async () => {
      const res = await post(body)
      assert.strictEqual(res.statusCode, 400)
      assert.strictEqual(retrieveWithSubjectsPdf.callCount, 0)
    })
  }
})

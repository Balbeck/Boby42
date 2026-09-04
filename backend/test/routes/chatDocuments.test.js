'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')
const { QueryTypes } = require('sequelize')

const { getApp, itDb, stubOllama, jsonResponse, connectionRefused } = require('../helper')
const { embeddingFor, embeddingMatchingNothing } = require('../fixtures/embeddings')
const { sequelize, Message, Conversation } = require('../../models')

const VISITOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const post = async (body) => (await getApp()).inject({ method: 'POST', url: '/chat/documents', payload: body })

describe('POST /chat/documents', () => {
  itDb('returns display rows and touches no LLM', async () => {
    const calls = stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') })
    }).calls

    const res = await post({ question: 'alternance ?', language: 'fr', visitorId: VISITOR })
    const body = res.json()

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(body.count, body.documents.length)
    assert.deepStrictEqual(Object.keys(body.documents[0]).sort(), ['name', 'score', 'type', 'url'])
    assert.strictEqual(body.documents[0].name, 'Alternance')
    // Retrieval only: one embedding call, no /api/generate.
    assert.deepStrictEqual(calls.map((call) => call.url.split('/').pop()), ['embeddings'])
  })

  itDb('defaults language to fr for the url it builds', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }) })
    const body = (await post({ question: 'alternance ?' })).json()
    assert.strictEqual(body.documents[0].url, '/BaseDocumentaire/fr/Notion/Alternance.md')
  })

  itDb('returns count 0 rather than an error when nothing matches', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingMatchingNothing() }) })
    assert.deepStrictEqual((await post({ question: 'zzz' })).json(), { count: 0, documents: [] })
  })

  itDb('writes nothing to the DB on the success path', async () => {
    // Phase 1 has no exchange yet — the /chat call is what records it.
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }) })
    await post({ question: 'alternance ?', visitorId: VISITOR })
    assert.strictEqual(await Conversation.count(), 0)
  })

  itDb('rejects a missing question with 400', async () => {
    assert.strictEqual((await post({})).statusCode, 400)
    assert.strictEqual((await post({ question: '' })).statusCode, 400)
    assert.strictEqual((await post({ question: 'q', language: 'de' })).statusCode, 400)
  })

  itDb('says "Ollama unreachable" on a connection failure, and records retrieval_error', async () => {
    // The two 502 messages are what tells a dead Ollama apart from a broken
    // document store on the page — collapsing them loses the diagnosis.
    stubOllama({ '/api/embeddings': () => { throw connectionRefused() } })

    const res = await post({ question: 'q', visitorId: VISITOR })

    assert.strictEqual(res.statusCode, 502)
    assert.match(res.json().message, /Ollama server is unreachable/)

    const [assistant] = await Message.findAll({ where: { role: 'assistant' } })
    assert.strictEqual(assistant.error_code, 'retrieval_error')
    assert.strictEqual((await Conversation.findByPk(assistant.conversation_id)).page, 'chat')
  })

  itDb('says "Failed to search" when Ollama is reachable but erroring', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ error: 'boom' }, 500) })

    const res = await post({ question: 'q', visitorId: VISITOR })

    assert.strictEqual(res.statusCode, 502)
    assert.match(res.json().message, /Failed to search the document base/)
  })

  itDb('logs no no_match event — a failed search is not a missing document', async () => {
    stubOllama({ '/api/embeddings': () => { throw connectionRefused() } })
    await post({ question: 'q', visitorId: VISITOR })
    assert.deepStrictEqual(await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT }), [])
  })
})

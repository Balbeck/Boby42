'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')
const { QueryTypes } = require('sequelize')

const { getApp, itDb, stubOllama, jsonResponse, connectionRefused } = require('../helper')
const { embeddingFor, embeddingMatchingNothing } = require('../fixtures/embeddings')
const { sequelize, Conversation, Message, MessageDocument } = require('../../models')

const VISITOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const post = async (body) => (await getApp()).inject({ method: 'POST', url: '/archiviste', payload: body })

describe('POST /archiviste', () => {
  itDb('returns matched documents and records the exchange', async () => {
    const calls = stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') })
    }).calls

    const res = await post({ question: 'alternance ?', language: 'fr', visitorId: VISITOR })
    const body = res.json()

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(body.count, body.documents.length)
    assert.ok(body.conversationId)
    assert.ok(body.messageId)
    // No LLM on this page, ever.
    assert.deepStrictEqual(calls.map((call) => call.url.split('/').pop()), ['embeddings'])

    const conversation = await Conversation.findByPk(body.conversationId)
    assert.strictEqual(conversation.page, 'archiviste')
    const assistant = await Message.findByPk(body.messageId)
    assert.strictEqual(assistant.content, '', 'no answer to store on /archiviste')
    assert.strictEqual(assistant.document_count, body.count)
  })

  itDb('requires both question and language', async () => {
    assert.strictEqual((await post({ question: 'q' })).statusCode, 400)
    assert.strictEqual((await post({ language: 'fr' })).statusCode, 400)
    assert.strictEqual((await post({ question: 'q', language: 'de' })).statusCode, 400)
  })

  itDb('builds the Notion url from the requested language', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }) })
    const body = (await post({ question: 'alternance ?', language: 'en' })).json()
    const row = body.documents.find((doc) => doc.name === 'Alternance')
    assert.strictEqual(row.url, '/BaseDocumentaire/en/Notion/Alternance.md')
  })

  itDb('shows subject PDFs ungated — unlike /chat', async () => {
    // /archiviste keeps the original file-order scan over both stores; the
    // Notion-vs-PDF gate is a /chat-only rule.
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('subjects', 'Libft.en.subject.pdf') }) })

    const body = (await post({ question: 'libft', language: 'fr' })).json()
    const pdf = body.documents.find((doc) => doc.type === 'pdf')

    assert.ok(pdf, 'the subject PDF must be listed')
    assert.strictEqual(pdf.name, 'Libft.en.subject')
    assert.strictEqual(pdf.url, '/subjectspdf/Libft.en.subject.pdf')
  })

  itDb('records each document in position order with its resolved on-disk path', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }) })

    const body = (await post({ question: 'alternance ?', language: 'fr', visitorId: VISITOR })).json()
    const rows = await MessageDocument.findAll({
      where: { message_id: body.messageId }, order: [['position', 'ASC']]
    })

    assert.deepStrictEqual(rows.map((row) => row.name), body.documents.map((doc) => doc.name))
    assert.deepStrictEqual(rows.map((row) => row.position), body.documents.map((_, i) => i))
    // The path comes from the read whitelist, never built from request input.
    const md = rows.find((row) => row.type === 'md')
    assert.ok(md.path.endsWith('/BaseDocumentaire/Fr/Notion/Alternance.md'))
  })

  itDb('logs a no_match event when nothing matched', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingMatchingNothing() }) })

    const body = (await post({ question: 'zzz', language: 'fr', visitorId: VISITOR })).json()

    assert.strictEqual(body.count, 0)
    const events = await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT })
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'no_match')
    assert.deepStrictEqual(events[0].payload, { question: 'zzz', language: 'fr' })
  })

  itDb('appends to a conversation on the same page', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }) })

    const first = (await post({ question: 'q1', language: 'fr', visitorId: VISITOR })).json()
    const second = (await post({
      question: 'q2', language: 'fr', visitorId: VISITOR, conversationId: first.conversationId
    })).json()

    assert.strictEqual(second.conversationId, first.conversationId)
    assert.strictEqual(await Conversation.count(), 1)
  })

  itDb('502s with the unreachable message and records retrieval_error', async () => {
    stubOllama({ '/api/embeddings': () => { throw connectionRefused() } })

    const res = await post({ question: 'q', language: 'fr', visitorId: VISITOR })

    assert.strictEqual(res.statusCode, 502)
    assert.match(res.json().message, /Ollama server is unreachable/)

    const [assistant] = await Message.findAll({ where: { role: 'assistant' } })
    assert.strictEqual(assistant.error_code, 'retrieval_error')
    assert.strictEqual((await Conversation.findByPk(assistant.conversation_id)).page, 'archiviste')
  })

  itDb('502s with the generic message when Ollama answers with an error', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({}, 500) })
    const res = await post({ question: 'q', language: 'fr' })
    assert.match(res.json().message, /Failed to search the document base/)
  })
})

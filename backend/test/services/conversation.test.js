'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')
const { QueryTypes } = require('sequelize')

const { itDb } = require('../helper')
const {
  ensureVisitor, recordExchange, logEvent, setFeedback, listConversations, getConversation
} = require('../../services/conversation.service')
const { sequelize, Visitor, Conversation, Message, MessageDocument, MessageFeedback } = require('../../models')

const ANON = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

/** @param {object} [overrides] */
const exchange = (overrides = {}) => ({
  anonId: ANON,
  page: 'chat',
  question: 'où est la cafétéria ?',
  answer: 'Au premier étage.',
  language: 'fr',
  documents: [],
  latencyMs: 1234,
  errorCode: null,
  ...overrides
})

describe('ensureVisitor', () => {
  itDb('creates a visitor on first sight and reuses the row afterwards', async () => {
    const first = await ensureVisitor(ANON)
    const second = await ensureVisitor(ANON)

    assert.strictEqual(first.id, second.id)
    assert.strictEqual(await Visitor.count(), 1)
  })

  itDb('bumps last_seen_at without touching first_seen_at', async () => {
    const first = await ensureVisitor(ANON)
    const firstSeen = first.first_seen_at
    await new Promise((resolve) => setTimeout(resolve, 10))
    const again = await ensureVisitor(ANON)

    assert.deepStrictEqual(again.first_seen_at, firstSeen)
    assert.ok(again.last_seen_at >= first.last_seen_at)
  })

  itDb("folds a blank or missing id onto the single synthetic 'anonymous' row", async () => {
    // A missing visitorId must not throw and must not create a row per request.
    for (const value of [undefined, null, '', '   ']) await ensureVisitor(value)

    assert.strictEqual(await Visitor.count(), 1)
    assert.ok(await Visitor.findOne({ where: { anon_id: 'anonymous' } }))
  })
})

describe('recordExchange', () => {
  itDb('writes one conversation and the user/assistant pair', async () => {
    const { conversationId, messageId } = await recordExchange(exchange())

    const conversation = await Conversation.findByPk(conversationId)
    assert.strictEqual(conversation.page, 'chat')
    assert.strictEqual(conversation.title, 'où est la cafétéria ?')

    const messages = await Message.findAll({ where: { conversation_id: conversationId }, order: [['created_at', 'ASC']] })
    assert.deepStrictEqual(messages.map((m) => m.role).sort(), ['assistant', 'user'])

    const assistant = messages.find((m) => m.role === 'assistant')
    assert.strictEqual(assistant.id, messageId)
    assert.strictEqual(assistant.content, 'Au premier étage.')
    assert.strictEqual(assistant.latency_ms, 1234)
    assert.strictEqual(assistant.document_count, 0)
  })

  itDb('appends to an existing conversation when its id is passed back', async () => {
    const first = await recordExchange(exchange())
    const second = await recordExchange(exchange({ conversationId: first.conversationId, question: 'et le wifi ?' }))

    assert.strictEqual(second.conversationId, first.conversationId)
    assert.strictEqual(await Conversation.count(), 1)
    assert.strictEqual(await Message.count(), 4)
  })

  itDb('touches updated_at on append — the drawer orders on it', async () => {
    // Model.update() strips managed timestamps and then no-ops, which is why the
    // service uses a raw UPDATE. If that regresses, the conversation silently
    // stops floating to the top of the history list.
    // `updatedAt` (not `updated_at`): the model is `underscored`, so the column
    // is snake_case but the attribute keeps its camelCase name.
    const { conversationId } = await recordExchange(exchange())
    const before = (await Conversation.findByPk(conversationId)).updatedAt

    await new Promise((resolve) => setTimeout(resolve, 20))
    await recordExchange(exchange({ conversationId }))

    const after = (await Conversation.findByPk(conversationId)).updatedAt
    assert.ok(after > before, 'updated_at must move on append')
  })

  itDb('never appends to another visitor’s conversation', async () => {
    const mine = await recordExchange(exchange())
    const theirs = await recordExchange(exchange({ anonId: OTHER, conversationId: mine.conversationId }))

    assert.notStrictEqual(theirs.conversationId, mine.conversationId)
    assert.strictEqual(await Conversation.count(), 2)
  })

  itDb('never appends across pages', async () => {
    const chat = await recordExchange(exchange({ page: 'chat' }))
    const archiviste = await recordExchange(exchange({ page: 'archiviste', conversationId: chat.conversationId }))

    assert.notStrictEqual(archiviste.conversationId, chat.conversationId)
  })

  itDb('opens a new conversation for an unknown or malformed conversationId', async () => {
    for (const id of ['not-a-uuid', '33333333-3333-4333-8333-333333333333']) {
      const { conversationId } = await recordExchange(exchange({ conversationId: id }))
      assert.notStrictEqual(conversationId, id)
    }
    assert.strictEqual(await Conversation.count(), 2)
  })

  itDb('stores documents by reference, in position order, never their content', async () => {
    const { messageId } = await recordExchange(exchange({
      documents: [
        { name: 'Alternance', type: 'md', url: '/u/a', path: '/p/a', score: 0.95 },
        { name: 'Libft.en.subject', type: 'pdf', url: '/u/b', path: '/p/b', score: 0.91 }
      ]
    }))

    const docs = await MessageDocument.findAll({ where: { message_id: messageId }, order: [['position', 'ASC']] })
    assert.deepStrictEqual(docs.map((d) => [d.name, d.type, d.position]), [
      ['Alternance', 'md', 0],
      ['Libft.en.subject', 'pdf', 1]
    ])
    assert.ok(!('content' in docs[0].dataValues), 'document content must never be persisted')
    assert.strictEqual((await Message.findByPk(messageId)).document_count, 2)
  })

  itDb('nulls a non-finite score rather than failing the write', async () => {
    const { messageId } = await recordExchange(exchange({
      documents: [{ name: 'X', type: 'md', score: undefined }]
    }))
    const [doc] = await MessageDocument.findAll({ where: { message_id: messageId } })
    assert.strictEqual(doc.score, null)
  })

  itDb('records the error path with an empty answer and the error code', async () => {
    const { messageId } = await recordExchange(exchange({ answer: null, errorCode: 'ollama_error' }))
    const assistant = await Message.findByPk(messageId)

    assert.strictEqual(assistant.content, '')
    assert.strictEqual(assistant.error_code, 'ollama_error')
  })

  itDb('collapses whitespace in the title and truncates it to 80 chars with an ellipsis', async () => {
    const long = 'a'.repeat(200)
    const { conversationId } = await recordExchange(exchange({ question: `  multi\n  ligne  ` }))
    assert.strictEqual((await Conversation.findByPk(conversationId)).title, 'multi ligne')

    const { conversationId: id2 } = await recordExchange(exchange({ question: long }))
    const title = (await Conversation.findByPk(id2)).title
    assert.strictEqual(title.length, 80)
    assert.ok(title.endsWith('…'))
  })
})

describe('logEvent', () => {
  itDb('links a no_match event to the visitor and the conversation', async () => {
    const { conversationId } = await recordExchange(exchange())
    await logEvent({ anonId: ANON, conversationId, type: 'no_match', payload: { question: 'q', language: 'fr' } })

    const [event] = await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT })
    assert.strictEqual(event.type, 'no_match')
    assert.strictEqual(event.conversation_id, conversationId)
    assert.deepStrictEqual(event.payload, { question: 'q', language: 'fr' })
  })

  itDb('nulls a malformed conversationId instead of failing the insert', async () => {
    await logEvent({ anonId: ANON, conversationId: 'nope', type: 'no_match', payload: null })
    const [event] = await sequelize.query('SELECT * FROM events', { type: QueryTypes.SELECT })
    assert.strictEqual(event.conversation_id, null)
  })
})

// The ownership join is the ONLY thing stopping anyone from poisoning the
// project's single answer-quality signal.
describe('setFeedback', () => {
  itDb('stores a rating on the caller’s own assistant message', async () => {
    const { messageId } = await recordExchange(exchange())
    assert.deepStrictEqual(await setFeedback({ messageId, anonId: ANON, rating: 1 }), { ok: true, rating: 1 })
    assert.strictEqual((await MessageFeedback.findOne({ where: { message_id: messageId } })).rating, 1)
  })

  itDb('updates in place on re-rating — the message_id UNIQUE holds', async () => {
    const { messageId } = await recordExchange(exchange())
    await setFeedback({ messageId, anonId: ANON, rating: 1 })
    await setFeedback({ messageId, anonId: ANON, rating: -1, comment: 'à côté de la plaque' })

    assert.strictEqual(await MessageFeedback.count(), 1)
    const row = await MessageFeedback.findOne({ where: { message_id: messageId } })
    assert.strictEqual(row.rating, -1)
    assert.strictEqual(row.comment, 'à côté de la plaque')
  })

  itDb('keeps no comment on a 👍', async () => {
    const { messageId } = await recordExchange(exchange())
    await setFeedback({ messageId, anonId: ANON, rating: 1, comment: 'super' })
    assert.strictEqual((await MessageFeedback.findOne({ where: { message_id: messageId } })).comment, null)
  })

  itDb('rating 0 withdraws — the row is deleted, never stored as 0', async () => {
    const { messageId } = await recordExchange(exchange())
    await setFeedback({ messageId, anonId: ANON, rating: -1 })
    assert.deepStrictEqual(await setFeedback({ messageId, anonId: ANON, rating: 0 }), { ok: true, rating: 0 })
    assert.strictEqual(await MessageFeedback.count(), 0)
  })

  itDb('refuses a message owned by another visitor', async () => {
    const { messageId } = await recordExchange(exchange())
    assert.deepStrictEqual(
      await setFeedback({ messageId, anonId: OTHER, rating: 1 }),
      { ok: false, reason: 'not_found' }
    )
    assert.strictEqual(await MessageFeedback.count(), 0)
  })

  itDb('refuses a user message — only answers are rated', async () => {
    const { conversationId } = await recordExchange(exchange())
    const question = await Message.findOne({ where: { conversation_id: conversationId, role: 'user' } })

    assert.deepStrictEqual(
      await setFeedback({ messageId: question.id, anonId: ANON, rating: 1 }),
      { ok: false, reason: 'not_found' }
    )
  })

  itDb('refuses an unknown or malformed message id', async () => {
    for (const messageId of ['nope', '', null, '44444444-4444-4444-8444-444444444444']) {
      assert.deepStrictEqual(
        await setFeedback({ messageId, anonId: ANON, rating: 1 }),
        { ok: false, reason: 'not_found' }
      )
    }
  })
})

describe('listConversations', () => {
  itDb('returns only the caller’s conversations, newest updated first', async () => {
    const older = await recordExchange(exchange({ question: 'première' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const newer = await recordExchange(exchange({ question: 'deuxième' }))
    await recordExchange(exchange({ anonId: OTHER, question: 'pas la mienne' }))

    const list = await listConversations(ANON)

    assert.deepStrictEqual(list.map((row) => row.id), [newer.conversationId, older.conversationId])
    assert.strictEqual(list[0].title, 'deuxième')
    assert.strictEqual(list[0].messageCount, 2)
  })

  itDb('returns an empty list for an unknown visitor', async () => {
    await recordExchange(exchange())
    assert.deepStrictEqual(await listConversations('nobody'), [])
  })

  itDb('honours the limit', async () => {
    for (let i = 0; i < 3; i++) await recordExchange(exchange({ question: `q${i}` }))
    assert.strictEqual((await listConversations(ANON, { limit: 2 })).length, 2)
  })
})

describe('getConversation', () => {
  itDb('returns the thread with its messages, documents and ratings', async () => {
    const { conversationId, messageId } = await recordExchange(exchange({
      documents: [
        { name: 'Alternance', type: 'md', url: '/u/a', path: '/p/a', score: 0.95 },
        { name: 'Wi-Fi', type: 'md', url: '/u/b', path: '/p/b', score: 0.9 }
      ]
    }))
    await setFeedback({ messageId, anonId: ANON, rating: 1 })

    const detail = await getConversation(conversationId, ANON)

    assert.strictEqual(detail.page, 'chat')
    assert.deepStrictEqual(detail.messages.map((m) => m.role), ['user', 'assistant'])

    const assistant = detail.messages[1]
    assert.strictEqual(assistant.rating, 1)
    assert.deepStrictEqual(assistant.documents.map((d) => d.name), ['Alternance', 'Wi-Fi'])
    // Content is re-fetched lazily by the frontend and must never travel here.
    assert.ok(!('content' in assistant.documents[0]))
    assert.strictEqual(detail.messages[0].rating, null)
  })

  itDb('returns null for another visitor’s conversation — a 404, not a 403', async () => {
    const { conversationId } = await recordExchange(exchange())
    assert.strictEqual(await getConversation(conversationId, OTHER), null)
  })

  itDb('returns null for an unknown or malformed id', async () => {
    assert.strictEqual(await getConversation('55555555-5555-4555-8555-555555555555', ANON), null)
    assert.strictEqual(await getConversation('not-a-uuid', ANON), null)
    assert.strictEqual(await getConversation('', ANON), null)
  })
})

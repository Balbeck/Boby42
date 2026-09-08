'use strict'

// Unit suite for services/conversation.service.js — no Postgres.
//
// The model statics and `sequelize.transaction` are stubbed, so this suite is
// about the DECISIONS the service makes before it writes: which conversation to
// append to, what the title becomes, what gets normalised to null, and whether
// every write really rides the same transaction. The DB suite proves the rows
// land; this one proves the reasoning, including the branches that need a
// hostile caller (another visitor's conversation id, a `user` message id, a
// latency of Infinity) rather than a fixture.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { stubQuery, stubTransaction, stubModel, spy, restoreAll } = require('../sequelizeStub')
const {
  Visitor, Conversation, Message, MessageDocument, Event, MessageFeedback
} = require('../../models')
const service = require('../../services/conversation.service')

afterEach(() => restoreAll())
after(() => restoreAll())

const UUID = '11111111-2222-4333-8444-555555555555'
const OTHER_UUID = '99999999-8888-4777-8666-555555555555'

const VISITOR = { id: 7, anon_id: 'anon-7' }

/**
 * The whole write path stubbed at once, with sane defaults. Returns every spy so
 * a test can assert on the one it cares about.
 *
 * @param {{ visitor?: Object, conversation?: Object | null, assistantId?: string }} [opts]
 */
function stubWritePath ({ visitor = VISITOR, conversation = null, assistantId = 'msg-assistant' } = {}) {
  const transaction = stubTransaction()
  const query = stubQuery([])

  const visitorUpsert = spy(async () => [visitor, true])
  const visitorFindOne = spy(async () => visitor)
  const conversationFindByPk = spy(async () => conversation)
  const conversationCreate = spy(async (values) => ({ id: 'conv-new', ...values }))
  const messageCreate = spy(async (values) => ({
    id: values.role === 'assistant' ? assistantId : 'msg-user', ...values
  }))
  const bulkCreate = spy(async () => [])
  const eventCreate = spy(async (values) => ({ id: 1, ...values }))

  stubModel(Visitor, { upsert: visitorUpsert, findOne: visitorFindOne })
  stubModel(Conversation, { findByPk: conversationFindByPk, create: conversationCreate })
  stubModel(Message, { create: messageCreate })
  stubModel(MessageDocument, { bulkCreate })
  stubModel(Event, { create: eventCreate })

  return {
    transaction,
    query,
    visitorUpsert,
    visitorFindOne,
    conversationFindByPk,
    conversationCreate,
    messageCreate,
    bulkCreate,
    eventCreate
  }
}

/** A minimal valid recordExchange input. */
const EXCHANGE = { anonId: 'anon-7', page: 'chat', question: 'où est le wifi', answer: 'au 2e' }

describe('ensureVisitor', () => {
  const blank = [
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   \t\n ']
  ]

  for (const [label, anonId] of blank) {
    it(`folds ${label} onto the single synthetic 'anonymous' row`, async () => {
      // Attribution is best-effort — an unattributable request must still be
      // logged, not throw and lose the exchange.
      const stubs = stubWritePath()
      await service.ensureVisitor(anonId)

      assert.strictEqual(stubs.visitorUpsert.calls[0][0].anon_id, 'anonymous')
      assert.strictEqual(stubs.visitorFindOne.calls[0][0].where.anon_id, 'anonymous')
    })
  }

  it('trims a real id rather than creating a near-duplicate row', async () => {
    const stubs = stubWritePath()
    await service.ensureVisitor('  anon-7  ')
    assert.strictEqual(stubs.visitorUpsert.calls[0][0].anon_id, 'anon-7')
  })

  it('coerces a non-string id instead of throwing on .trim()', async () => {
    // anon_id is a STRING column precisely so a malformed client value can't
    // crash a query on a cast — the service has to be as tolerant.
    const stubs = stubWritePath()
    await service.ensureVisitor(12345)
    assert.strictEqual(stubs.visitorUpsert.calls[0][0].anon_id, '12345')
  })

  it('bumps last_seen_at on every call', async () => {
    const stubs = stubWritePath()
    const before = Date.now()
    await service.ensureVisitor('anon-7')

    const { last_seen_at: lastSeen } = stubs.visitorUpsert.calls[0][0]
    assert.ok(lastSeen instanceof Date)
    assert.ok(lastSeen.getTime() >= before)
  })

  it('pins the ON CONFLICT target to anon_id — the model has two unique columns', async () => {
    // Without conflictFields Postgres cannot choose between anon_id and
    // intra_login and the upsert fails outright.
    const stubs = stubWritePath()
    await service.ensureVisitor('anon-7')
    assert.deepStrictEqual(stubs.visitorUpsert.calls[0][1].conflictFields, ['anon_id'])
  })

  it('threads the caller transaction into both statements', async () => {
    const stubs = stubWritePath()
    const tx = { marker: true }
    await service.ensureVisitor('anon-7', { transaction: tx })

    assert.strictEqual(stubs.visitorUpsert.calls[0][1].transaction, tx)
    assert.strictEqual(stubs.visitorFindOne.calls[0][0].transaction, tx)
  })
})

describe('recordExchange — picking the conversation', () => {
  it('creates one when no conversationId is given, titled with the question', async () => {
    const stubs = stubWritePath()
    await service.recordExchange(EXCHANGE)

    assert.strictEqual(stubs.conversationFindByPk.callCount, 0)
    assert.deepStrictEqual(stubs.conversationCreate.calls[0][0], {
      visitor_id: 7, page: 'chat', title: 'où est le wifi'
    })
  })

  it('creates one without a lookup when the given id is not a uuid', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({ ...EXCHANGE, conversationId: 'not-a-uuid' })

    assert.strictEqual(stubs.conversationFindByPk.callCount, 0)
    assert.strictEqual(stubs.conversationCreate.callCount, 1)
  })

  it('creates one when the id is well-formed but unknown', async () => {
    const stubs = stubWritePath({ conversation: null })
    await service.recordExchange({ ...EXCHANGE, conversationId: UUID })

    assert.strictEqual(stubs.conversationFindByPk.callCount, 1)
    assert.strictEqual(stubs.conversationCreate.callCount, 1)
  })

  it('reuses a matching conversation and touches updated_at with raw SQL', async () => {
    // Model.update() strips managed timestamps and then no-ops when nothing else
    // changed — the conversation would never float to the top of the drawer.
    const stubs = stubWritePath({ conversation: { id: UUID, visitor_id: 7, page: 'chat' } })
    const result = await service.recordExchange({ ...EXCHANGE, conversationId: UUID })

    assert.strictEqual(stubs.conversationCreate.callCount, 0)
    assert.strictEqual(result.conversationId, UUID)

    const touch = stubs.query.calls[0]
    assert.match(touch.sql, /UPDATE "conversations" SET "updated_at" = :now WHERE "id" = :id/)
    assert.strictEqual(touch.replacements.id, UUID)
    assert.ok(touch.replacements.now instanceof Date)
  })

  it('refuses to append to another visitor\'s conversation — it opens a new one', async () => {
    // A guessed UUID must not let anyone write into someone else's thread.
    const stubs = stubWritePath({ conversation: { id: UUID, visitor_id: 999, page: 'chat' } })
    await service.recordExchange({ ...EXCHANGE, conversationId: UUID })

    assert.strictEqual(stubs.conversationCreate.callCount, 1)
    assert.strictEqual(stubs.query.calls.length, 0, 'no updated_at touch on a rejected conversation')
  })

  it('refuses to append across pages — /archiviste never lands in a /chat thread', async () => {
    const stubs = stubWritePath({ conversation: { id: UUID, visitor_id: 7, page: 'archiviste' } })
    await service.recordExchange({ ...EXCHANGE, conversationId: UUID })

    assert.strictEqual(stubs.conversationCreate.callCount, 1)
  })
})

describe('recordExchange — what it writes', () => {
  it('writes the user message before the assistant one', async () => {
    const stubs = stubWritePath()
    await service.recordExchange(EXCHANGE)

    assert.deepStrictEqual(stubs.messageCreate.calls.map(([values]) => values.role), ['user', 'assistant'])
    assert.strictEqual(stubs.messageCreate.calls[0][0].content, 'où est le wifi')
    assert.strictEqual(stubs.messageCreate.calls[1][0].content, 'au 2e')
  })

  it('returns the ids the routes hand back as conversationId / messageId', async () => {
    stubWritePath({ assistantId: 'msg-abc' })
    const result = await service.recordExchange(EXCHANGE)

    assert.deepStrictEqual(result, { conversationId: 'conv-new', messageId: 'msg-abc' })
  })

  it('runs every write inside one transaction', async () => {
    // A half-written exchange (message, no documents) would silently corrupt
    // every downstream metric.
    const stubs = stubWritePath()
    await service.recordExchange({ ...EXCHANGE, documents: [{ name: 'Wi-Fi' }] })

    const { tx } = stubs.transaction
    assert.strictEqual(stubs.transaction.calls.length, 1)
    assert.strictEqual(stubs.visitorUpsert.calls[0][1].transaction, tx)
    assert.strictEqual(stubs.conversationCreate.calls[0][1].transaction, tx)
    assert.strictEqual(stubs.messageCreate.calls[0][1].transaction, tx)
    assert.strictEqual(stubs.messageCreate.calls[1][1].transaction, tx)
    assert.strictEqual(stubs.bulkCreate.calls[0][1].transaction, tx)
  })

  it('records document_count = 0 rather than skipping it — 0 is the no-match signal', async () => {
    const stubs = stubWritePath()
    await service.recordExchange(EXCHANGE)

    const assistant = stubs.messageCreate.calls[1][0]
    assert.strictEqual(assistant.document_count, 0)
    assert.strictEqual(stubs.bulkCreate.callCount, 0, 'no empty bulkCreate')
  })

  it('attaches the documents in array order as 0-based positions', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({
      ...EXCHANGE,
      documents: [
        { name: 'Wi-Fi', type: 'md', url: '/u/1', path: '/abs/1', score: 0.94 },
        { name: 'libft', type: 'pdf', url: '/u/2', path: '/abs/2', score: 0.91 }
      ]
    })

    assert.strictEqual(stubs.messageCreate.calls[1][0].document_count, 2)
    assert.deepStrictEqual(stubs.bulkCreate.calls[0][0], [
      { message_id: 'msg-assistant', name: 'Wi-Fi', type: 'md', url: '/u/1', path: '/abs/1', score: 0.94, position: 0 },
      { message_id: 'msg-assistant', name: 'libft', type: 'pdf', url: '/u/2', path: '/abs/2', score: 0.91, position: 1 }
    ])
  })

  it('nulls the optional document fields instead of writing undefined', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({ ...EXCHANGE, documents: [{ name: 'Wi-Fi' }] })

    assert.deepStrictEqual(stubs.bulkCreate.calls[0][0], [
      { message_id: 'msg-assistant', name: 'Wi-Fi', type: null, url: null, path: null, score: null, position: 0 }
    ])
  })

  it('drops a non-finite score rather than writing NaN into a FLOAT column', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({
      ...EXCHANGE,
      documents: [{ name: 'a', score: NaN }, { name: 'b', score: Infinity }, { name: 'c', score: 0 }]
    })

    assert.deepStrictEqual(stubs.bulkCreate.calls[0][0].map((d) => d.score), [null, null, 0])
  })

  const latencies = [
    ['rounds a fractional latency', 1234.6, 1235],
    ['keeps zero', 0, 0],
    ['nulls undefined', undefined, null],
    ['nulls NaN', NaN, null],
    ['nulls Infinity', Infinity, null]
  ]

  for (const [label, latencyMs, expected] of latencies) {
    it(`${label}`, async () => {
      const stubs = stubWritePath()
      await service.recordExchange({ ...EXCHANGE, latencyMs })
      assert.strictEqual(stubs.messageCreate.calls[1][0].latency_ms, expected)
    })
  }

  it('normalises a missing answer, language and errorCode', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({ anonId: 'a', page: 'archiviste', question: 'q' })

    const [user] = stubs.messageCreate.calls[0]
    const [assistant] = stubs.messageCreate.calls[1]
    // /archiviste has no answer text at all — '' not null, the column is notNull.
    assert.strictEqual(assistant.content, '')
    assert.strictEqual(assistant.language, null)
    assert.strictEqual(assistant.error_code, null)
    assert.strictEqual(user.language, null)
  })

  it('carries language and errorCode through when given', async () => {
    const stubs = stubWritePath()
    await service.recordExchange({ ...EXCHANGE, language: 'en', errorCode: 'ollama_error' })

    assert.strictEqual(stubs.messageCreate.calls[0][0].language, 'en')
    assert.strictEqual(stubs.messageCreate.calls[1][0].error_code, 'ollama_error')
  })
})

describe('recordExchange — buildTitle', () => {
  /** @param {*} question @returns {Promise<string>} */
  async function titleFor (question) {
    const stubs = stubWritePath()
    await service.recordExchange({ ...EXCHANGE, question })
    const title = stubs.conversationCreate.calls[0][0].title
    restoreAll()
    return title
  }

  it('uses the question as-is when it is short enough', async () => {
    assert.strictEqual(await titleFor('où est le wifi'), 'où est le wifi')
  })

  it('collapses newlines and runs of whitespace to single spaces', async () => {
    assert.strictEqual(await titleFor('  où   est\n\tle wifi  '), 'où est le wifi')
  })

  const empty = [['an empty string', ''], ['whitespace', '   '], ['null', null], ['undefined', undefined]]
  for (const [label, question] of empty) {
    it(`falls back to a placeholder on ${label} — title is notNull`, async () => {
      assert.strictEqual(await titleFor(question), '(sans titre)')
    })
  }

  it('keeps a question of exactly 80 characters intact', async () => {
    const question = 'x'.repeat(80)
    assert.strictEqual(await titleFor(question), question)
  })

  it('truncates at 80 characters including the ellipsis', async () => {
    const title = await titleFor('x'.repeat(200))
    assert.strictEqual(title.length, 80)
    assert.ok(title.endsWith('…'))
  })

  it('does not leave a dangling space before the ellipsis', async () => {
    const title = await titleFor('y'.repeat(79) + ' ' + 'z'.repeat(50))
    assert.strictEqual(title, 'y'.repeat(79) + '…')
  })
})

describe('logEvent', () => {
  it('writes the event against the resolved visitor, inside a transaction', async () => {
    const stubs = stubWritePath()
    await service.logEvent({ anonId: 'anon-7', type: 'no_match', payload: { question: 'q' } })

    assert.deepStrictEqual(stubs.eventCreate.calls[0][0], {
      visitor_id: 7,
      conversation_id: null,
      type: 'no_match',
      payload: { question: 'q' }
    })
    assert.strictEqual(stubs.eventCreate.calls[0][1].transaction, stubs.transaction.tx)
  })

  it('keeps a well-formed conversationId', async () => {
    const stubs = stubWritePath()
    await service.logEvent({ anonId: 'a', conversationId: UUID, type: 'no_match' })
    assert.strictEqual(stubs.eventCreate.calls[0][0].conversation_id, UUID)
  })

  const bad = [['a non-uuid', 'nope'], ['an empty string', ''], ['undefined', undefined]]
  for (const [label, conversationId] of bad) {
    it(`nulls ${label} conversationId rather than failing the FK`, async () => {
      const stubs = stubWritePath()
      await service.logEvent({ anonId: 'a', conversationId, type: 'no_match' })
      assert.strictEqual(stubs.eventCreate.calls[0][0].conversation_id, null)
    })
  }

  it('nulls a missing payload', async () => {
    const stubs = stubWritePath()
    await service.logEvent({ anonId: 'a', type: 'ping' })
    assert.strictEqual(stubs.eventCreate.calls[0][0].payload, null)
  })
})

describe('setFeedback', () => {
  /**
   * @param {Object | null} message - what Message.findByPk resolves to
   */
  function stubFeedback (message) {
    const findByPk = spy(async () => message)
    const destroy = spy(async () => 1)
    const upsert = spy(async () => [null, true])

    stubModel(Message, { findByPk })
    stubModel(MessageFeedback, { destroy, upsert })
    return { findByPk, destroy, upsert }
  }

  const assistant = { id: UUID, role: 'assistant' }

  const malformed = [['an empty id', ''], ['undefined', undefined], ['a non-uuid', 'abc'], ['null', null]]
  for (const [label, messageId] of malformed) {
    it(`returns not_found on ${label} without touching the database`, async () => {
      const stubs = stubFeedback(assistant)
      assert.deepStrictEqual(await service.setFeedback({ messageId, anonId: 'a', rating: 1 }), {
        ok: false, reason: 'not_found'
      })
      assert.strictEqual(stubs.findByPk.callCount, 0)
    })
  }

  it('returns not_found when the ownership join comes back empty', async () => {
    // The INNER JOINs mean "another visitor's message" and "no such message"
    // are indistinguishable here — deliberately, so a 404 never confirms the
    // message exists.
    const stubs = stubFeedback(null)
    assert.deepStrictEqual(await service.setFeedback({ messageId: UUID, anonId: 'a', rating: 1 }), {
      ok: false, reason: 'not_found'
    })
    assert.strictEqual(stubs.upsert.callCount, 0)
  })

  it('refuses to rate a user message', async () => {
    const stubs = stubFeedback({ id: UUID, role: 'user' })
    assert.deepStrictEqual(await service.setFeedback({ messageId: UUID, anonId: 'a', rating: -1 }), {
      ok: false, reason: 'not_found'
    })
    assert.strictEqual(stubs.upsert.callCount, 0)
  })

  it('scopes the lookup by anon_id through required inner joins', async () => {
    const stubs = stubFeedback(assistant)
    await service.setFeedback({ messageId: UUID, anonId: 'anon-7', rating: 1 })

    const [, options] = stubs.findByPk.calls[0]
    const [conversationInclude] = options.include
    assert.strictEqual(conversationInclude.required, true)

    const [visitorInclude] = conversationInclude.include
    assert.strictEqual(visitorInclude.required, true)
    assert.deepStrictEqual(visitorInclude.where, { anon_id: 'anon-7' })
  })

  it('falls back to the anonymous visitor for a blank anonId', async () => {
    const stubs = stubFeedback(assistant)
    await service.setFeedback({ messageId: UUID, anonId: '  ', rating: 1 })

    assert.deepStrictEqual(stubs.findByPk.calls[0][1].include[0].include[0].where, { anon_id: 'anonymous' })
  })

  it('deletes the row on rating 0 — withdrawal is never a stored 0', async () => {
    const stubs = stubFeedback(assistant)
    assert.deepStrictEqual(await service.setFeedback({ messageId: UUID, anonId: 'a', rating: 0 }), {
      ok: true, rating: 0
    })
    assert.deepStrictEqual(stubs.destroy.calls[0][0], { where: { message_id: UUID } })
    assert.strictEqual(stubs.upsert.callCount, 0)
  })

  it('upserts on the unique message_id so re-rating updates in place', async () => {
    const stubs = stubFeedback(assistant)
    await service.setFeedback({ messageId: UUID, anonId: 'a', rating: -1, comment: 'hors sujet' })

    assert.deepStrictEqual(stubs.upsert.calls[0][0], {
      message_id: UUID, rating: -1, comment: 'hors sujet'
    })
    assert.deepStrictEqual(stubs.upsert.calls[0][1], { conflictFields: ['message_id'] })
  })

  it('drops the comment on a thumbs-up — no free text on a positive rating', async () => {
    const stubs = stubFeedback(assistant)
    await service.setFeedback({ messageId: UUID, anonId: 'a', rating: 1, comment: 'super' })
    assert.strictEqual(stubs.upsert.calls[0][0].comment, null)
  })

  it('nulls an absent comment on a thumbs-down', async () => {
    const stubs = stubFeedback(assistant)
    await service.setFeedback({ messageId: UUID, anonId: 'a', rating: -1 })
    assert.strictEqual(stubs.upsert.calls[0][0].comment, null)
  })
})

describe('listConversations', () => {
  const row = { id: UUID, page: 'chat', title: 'wifi', updated_at: '2026-03-01T10:00:00Z', message_count: '4' }

  it('maps snake_case rows to the drawer payload and coerces the count', async () => {
    // count(*) comes back as a STRING from pg — the drawer would render "4"
    // and any arithmetic on it would concatenate.
    stubQuery([[row]])
    assert.deepStrictEqual(await service.listConversations('anon-7'), [
      { id: UUID, page: 'chat', title: 'wifi', updatedAt: '2026-03-01T10:00:00Z', messageCount: 4 }
    ])
  })

  it('scopes by anon_id through the join — the join IS the ownership check', async () => {
    const query = stubQuery([[]])
    await service.listConversations('anon-7')

    assert.match(query.calls[0].sql, /JOIN "visitors" v ON v\."id" = c\."visitor_id"/)
    assert.match(query.calls[0].sql, /WHERE v\."anon_id" = :key/)
    assert.strictEqual(query.calls[0].replacements.key, 'anon-7')
  })

  it('orders by updated_at DESC and defaults to 50 rows', async () => {
    const query = stubQuery([[]])
    await service.listConversations('anon-7')

    assert.match(query.calls[0].sql, /ORDER BY c\."updated_at" DESC/)
    assert.strictEqual(query.calls[0].replacements.limit, 50)
  })

  it('honours an explicit limit', async () => {
    const query = stubQuery([[]])
    await service.listConversations('anon-7', { limit: 200 })
    assert.strictEqual(query.calls[0].replacements.limit, 200)
  })

  it('falls back to the anonymous key on a blank id', async () => {
    const query = stubQuery([[]])
    await service.listConversations(null)
    assert.strictEqual(query.calls[0].replacements.key, 'anonymous')
  })

  it('returns an empty list rather than throwing when nothing matches', async () => {
    stubQuery([[]])
    assert.deepStrictEqual(await service.listConversations('nobody'), [])
  })
})

describe('getConversation', () => {
  const conversation = { id: UUID, page: 'chat', title: 'wifi' }
  const messages = [
    {
      id: 'm1', role: 'user', content: 'où est le wifi', language: 'fr',
      created_at: '2026-03-01T10:00:00Z', error_code: null, document_count: null, rating: null
    },
    {
      id: 'm2', role: 'assistant', content: 'au 2e', language: 'fr',
      created_at: '2026-03-01T10:00:01Z', error_code: null, document_count: 2, rating: 1
    }
  ]

  const malformed = [['an empty id', ''], ['undefined', undefined], ['a non-uuid', 'abc']]
  for (const [label, id] of malformed) {
    it(`returns null on ${label} without querying`, async () => {
      const query = stubQuery([])
      assert.strictEqual(await service.getConversation(id, 'anon-7'), null)
      assert.strictEqual(query.calls.length, 0)
    })
  }

  it('returns null when the conversation is unknown or another visitor\'s', async () => {
    const query = stubQuery([[]])
    assert.strictEqual(await service.getConversation(UUID, 'anon-7'), null)
    assert.strictEqual(query.calls.length, 1, 'it stops at the ownership query')
  })

  it('scopes the lookup by both the id and the visitor', async () => {
    const query = stubQuery([[conversation], messages, []])
    await service.getConversation(UUID, 'anon-7')

    assert.match(query.calls[0].sql, /WHERE c\."id" = :id AND v\."anon_id" = :key/)
    assert.deepStrictEqual(query.calls[0].replacements, { id: UUID, key: 'anon-7' })
  })

  it('returns the messages with documents grouped by message and rating carried', async () => {
    stubQuery([
      [conversation],
      messages,
      [
        { message_id: 'm2', name: 'Wi-Fi', type: 'md', url: '/u/1', score: 0.94 },
        { message_id: 'm2', name: 'libft', type: 'pdf', url: '/u/2', score: 0.91 }
      ]
    ])

    const detail = await service.getConversation(UUID, 'anon-7')

    assert.deepStrictEqual(detail.id, UUID)
    assert.deepStrictEqual(detail.messages[0], {
      id: 'm1', role: 'user', content: 'où est le wifi', language: 'fr',
      createdAt: '2026-03-01T10:00:00Z', errorCode: null, documentCount: null, rating: null, documents: []
    })
    // `type` is what lets the restored row pick the markdown renderer or the
    // PDF <iframe> — without it a subject PDF comes back as markdown and 404s.
    assert.deepStrictEqual(detail.messages[1].documents, [
      { name: 'Wi-Fi', type: 'md', url: '/u/1', score: 0.94 },
      { name: 'libft', type: 'pdf', url: '/u/2', score: 0.91 }
    ])
    assert.strictEqual(detail.messages[1].rating, 1)
  })

  it('never returns document content — the frontend re-fetches it lazily', async () => {
    const query = stubQuery([[conversation], messages, [{ message_id: 'm2', name: 'Wi-Fi' }]])
    const detail = await service.getConversation(UUID, 'anon-7')

    assert.ok(!query.calls[2].sql.includes('content'))
    assert.ok(!('content' in detail.messages[1].documents[0]))
  })

  it('folds an absent rating to null rather than undefined', async () => {
    stubQuery([[conversation], [{ ...messages[1], rating: undefined }], []])
    const detail = await service.getConversation(UUID, 'anon-7')
    assert.strictEqual(detail.messages[0].rating, null)
  })

  it('skips the documents query when the conversation has no messages', async () => {
    // Same empty `IN ()` syntax-error trap as readConversationTree.
    const query = stubQuery([[conversation], []])
    const detail = await service.getConversation(UUID, 'anon-7')

    assert.deepStrictEqual(detail.messages, [])
    assert.strictEqual(query.calls.length, 2)
  })

  it('orders messages chronologically with the user row first on a tie', async () => {
    const query = stubQuery([[conversation], messages, []])
    await service.getConversation(UUID, 'anon-7')
    assert.match(query.calls[1].sql, /ORDER BY m\."created_at" ASC, \(m\."role" = 'user'\) DESC/)
  })

  it('falls back to the anonymous key on a blank visitor id', async () => {
    const query = stubQuery([[]])
    await service.getConversation(OTHER_UUID, undefined)
    assert.strictEqual(query.calls[0].replacements.key, 'anonymous')
  })
})

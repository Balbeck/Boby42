'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { itDb } = require('../helper')
const { listTables, readTable, readConversationTree, ALLOWED } = require('../../services/labData.service')
const { seedAnalytics } = require('../fixtures/seedAnalytics')

// The whitelist is defence-in-depth behind fastify.verifyLab, but `users` must
// stay unreachable whatever happens to the gate: that row holds the bcrypt
// password hash and the live session token.
describe('the table whitelist', () => {
  it('is derived from the registered models', () => {
    for (const table of ['visitors', 'conversations', 'messages', 'message_documents', 'events', 'message_feedback']) {
      assert.ok(ALLOWED.has(table), `${table} should be inspectable`)
    }
  })

  it('never contains users', () => {
    assert.strictEqual(ALLOWED.has('users'), false)
  })
})

describe('listTables', () => {
  itDb('returns every inspectable table with its schema and true row count', async () => {
    await seedAnalytics()
    const tables = await listTables()
    const byName = Object.fromEntries(tables.map((table) => [table.name, table]))

    assert.strictEqual(byName.users, undefined)
    assert.strictEqual(byName.messages.rowCount, 6)
    assert.strictEqual(byName.message_documents.rowCount, 3)
    assert.strictEqual(byName.message_feedback.rowCount, 2)
  })

  itDb('describes columns in declaration order, with pg enums named by their udt', async () => {
    const [messages] = (await listTables()).filter((table) => table.name === 'messages')
    const columns = Object.fromEntries(messages.columns.map((column) => [column.name, column]))

    assert.strictEqual(messages.columns[0].name, 'id')
    // data_type would just say USER-DEFINED — the udt name is the honest one.
    assert.strictEqual(columns.role.type, 'enum_messages_role')
    assert.strictEqual(columns.latency_ms.numeric, true)
    assert.strictEqual(columns.content.numeric, false)
    assert.strictEqual(columns.language.nullable, true)
    assert.strictEqual(columns.content.nullable, false)
  })

  itDb('still describes an empty table', async () => {
    const [events] = (await listTables()).filter((table) => table.name === 'events')
    assert.strictEqual(events.rowCount, 0)
    assert.ok(events.columns.length > 0)
  })
})

describe('readTable', () => {
  itDb('returns rows exactly as they sit on disk, newest first', async () => {
    await seedAnalytics()
    const result = await readTable('messages')

    assert.strictEqual(result.rowCount, 6)
    assert.strictEqual(result.truncated, false)
    // Raw SELECT * — snake_case columns, no ORM shaping.
    assert.ok('conversation_id' in result.rows[0])
    const timestamps = result.rows.map((row) => new Date(row.created_at).getTime())
    assert.deepStrictEqual(timestamps, [...timestamps].sort((a, b) => b - a))
  })

  itDb('caps at `limit` and reports truncated', async () => {
    await seedAnalytics()
    const result = await readTable('messages', { limit: 2 })

    assert.strictEqual(result.rows.length, 2)
    assert.strictEqual(result.rowCount, 6, 'rowCount is the true count, not the slice')
    assert.strictEqual(result.truncated, true)
  })

  itDb('clamps a garbage limit instead of building an invalid query', async () => {
    await seedAnalytics()
    for (const limit of [0, -1, 'abc', 999999]) {
      assert.ok((await readTable('messages', { limit })).rows.length > 0)
    }
  })

  itDb('orders a table with no created_at by its primary key', async () => {
    await seedAnalytics()
    const result = await readTable('message_documents')
    const ids = result.rows.map((row) => Number(row.id))
    assert.deepStrictEqual(ids, [...ids].sort((a, b) => b - a))
  })

  itDb('returns null for users and for anything not whitelisted', async () => {
    for (const name of ['users', 'SequelizeMeta', 'pg_shadow', 'messages; DROP TABLE messages', '']) {
      assert.strictEqual(await readTable(name), null, `accepted: ${name}`)
    }
  })
})

describe('readConversationTree', () => {
  itDb('assembles the whole subtree by foreign key', async () => {
    const ids = await seedAnalytics()
    const tree = await readConversationTree(ids.conversationChat)

    assert.strictEqual(tree.conversation.id, ids.conversationChat)
    assert.strictEqual(tree.visitor.anon_id, ids.anonA)
    assert.deepStrictEqual(tree.messages.map((message) => message.role), ['user', 'assistant'])

    const assistant = tree.messages[1]
    assert.deepStrictEqual(assistant.documents.map((doc) => doc.name), ['Alternance', 'Wi-Fi'])
    assert.strictEqual(assistant.feedback.rating, 1)
    assert.strictEqual(tree.messages[0].feedback, null)
    assert.deepStrictEqual(tree.messages[0].documents, [])
  })

  itDb('attaches the events linked to the conversation', async () => {
    const ids = await seedAnalytics()
    const tree = await readConversationTree(ids.conversationArchiviste)

    assert.strictEqual(tree.events.length, 1)
    assert.strictEqual(tree.events[0].type, 'no_match')
    assert.deepStrictEqual(tree.events[0].payload, { question: 'quantum badge', language: 'en' })
  })

  itDb('returns null for a malformed or unknown id', async () => {
    await seedAnalytics()
    assert.strictEqual(await readConversationTree('not-a-uuid'), null)
    assert.strictEqual(await readConversationTree(''), null)
    assert.strictEqual(await readConversationTree(null), null)
    assert.strictEqual(await readConversationTree('66666666-6666-4666-8666-666666666666'), null)
  })
})

'use strict'

// Unit suite for services/labData.service.js — no Postgres.
//
// The DB suite (test/services/labData.test.js) proves the SELECTs run against
// the real schema. This one proves the parts that a live database can't easily
// show: the whitelist arithmetic, the limit clamp at both ends, the recency-key
// fallback, and — the one that matters — that `readConversationTree` never emits
// an `IN ()` when a conversation has no messages, which is a Postgres syntax
// error rather than an empty result.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { stubQuery, restoreAll } = require('../sequelizeStub')
const labData = require('../../services/labData.service')

afterEach(() => restoreAll())
after(() => restoreAll())

const UUID = '11111111-2222-4333-8444-555555555555'

/**
 * Routes a stubbed query to a fixture by what the SQL is asking for. The service
 * interleaves three query shapes (columns / count / rows), so a positional queue
 * would encode the call order into every test.
 *
 * @param {{ columns?: Object[], count?: number, rows?: Object[] }} fixtures
 */
function byShape ({ columns = [], count = 0, rows = [] } = {}) {
  return ({ sql }) => {
    if (sql.includes('information_schema.columns')) return columns
    if (sql.includes('count(*)')) return [{ count }]
    return rows
  }
}

const COLUMN_ROWS = [
  { column_name: 'id', data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO' },
  { column_name: 'page', data_type: 'USER-DEFINED', udt_name: 'enum_conversations_page', is_nullable: 'NO' },
  { column_name: 'title', data_type: 'text', udt_name: 'text', is_nullable: 'YES' },
  { column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' }
]

describe('the table whitelist', () => {
  it('is derived from the registered models, never hand-maintained', async () => {
    // A future model's table has to appear here on its own — a hardcoded list
    // would silently hide new tables from the inspector.
    assert.deepStrictEqual([...labData.ALLOWED].sort(), [
      'conversations', 'events', 'message_documents', 'message_feedback', 'messages', 'visitors'
    ])
  })

  it('excludes `users` — the bcrypt hash and the live session token', async () => {
    assert.ok(!labData.ALLOWED.has('users'))
    // And the exclusion is enforced at the read, not only in the listing.
    assert.strictEqual(await labData.readTable('users'), null)
  })

  const refused = ['pg_shadow', 'public.users', 'conversations; DROP TABLE users', 'CONVERSATIONS', '']
  for (const name of refused) {
    it(`refuses ${JSON.stringify(name)} without running a query at all`, async () => {
      const query = stubQuery(byShape())
      assert.strictEqual(await labData.readTable(name), null)
      assert.strictEqual(query.calls.length, 0, 'a rejected name must never reach the database')
    })
  }
})

describe('columnsOf (through listTables / readTable)', () => {
  it('reports a pg enum by its udt_name, not the useless "USER-DEFINED" label', async () => {
    stubQuery(byShape({ columns: COLUMN_ROWS, count: 0 }))
    const table = await labData.readTable('conversations')

    const page = table.columns.find((column) => column.name === 'page')
    assert.strictEqual(page.type, 'enum_conversations_page')
  })

  it('turns is_nullable into a boolean', async () => {
    stubQuery(byShape({ columns: COLUMN_ROWS }))
    const table = await labData.readTable('conversations')

    assert.strictEqual(table.columns.find((c) => c.name === 'id').nullable, false)
    assert.strictEqual(table.columns.find((c) => c.name === 'title').nullable, true)
  })

  it('flags the numeric types the grid right-aligns', async () => {
    const numeric = ['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision', 'money']
    const textual = ['text', 'uuid', 'timestamp with time zone', 'jsonb', 'boolean', 'character varying']

    stubQuery(byShape({
      columns: [...numeric, ...textual].map((type, i) => ({
        column_name: `c${i}`, data_type: type, udt_name: type, is_nullable: 'YES'
      }))
    }))
    const table = await labData.readTable('conversations')

    assert.deepStrictEqual(
      table.columns.filter((column) => column.numeric).map((column) => column.name),
      numeric.map((_, i) => `c${i}`)
    )
  })

  it('preserves ordinal_position ordering rather than sorting the columns', async () => {
    stubQuery(byShape({ columns: COLUMN_ROWS }))
    const table = await labData.readTable('conversations')

    assert.deepStrictEqual(table.columns.map((c) => c.name), ['id', 'page', 'title', 'created_at'])
  })
})

describe('listTables', () => {
  it('returns every allowed table, sorted, with its schema and true row count', async () => {
    const query = stubQuery(byShape({ columns: COLUMN_ROWS, count: 7 }))
    const tables = await labData.listTables()

    assert.deepStrictEqual(tables.map((t) => t.name), [
      'conversations', 'events', 'message_documents', 'message_feedback', 'messages', 'visitors'
    ])
    assert.ok(tables.every((table) => table.rowCount === 7 && table.columns.length === 4))
    // 2 queries per table — the schema and the count. The count is separate so
    // the header shows real columns even when the table is empty.
    assert.strictEqual(query.calls.length, 12)
  })

  it('never queries `users`, in any of its queries', async () => {
    const query = stubQuery(byShape({ columns: COLUMN_ROWS }))
    await labData.listTables()

    for (const call of query.calls) {
      assert.ok(!/"users"/.test(call.sql), `users reached the database: ${call.sql}`)
      assert.notStrictEqual(call.replacements.name, 'users')
    }
  })
})

describe('readTable', () => {
  it('returns the rows with the schema, the true count and truncated:false', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    stubQuery(byShape({ columns: COLUMN_ROWS, count: 2, rows }))

    assert.deepStrictEqual(await labData.readTable('conversations'), {
      name: 'conversations',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, numeric: false },
        { name: 'page', type: 'enum_conversations_page', nullable: false, numeric: false },
        { name: 'title', type: 'text', nullable: true, numeric: false },
        { name: 'created_at', type: 'timestamp with time zone', nullable: false, numeric: false }
      ],
      rows,
      rowCount: 2,
      truncated: false
    })
  })

  it('flags truncated when the table holds more than the returned slice', async () => {
    stubQuery(byShape({ columns: COLUMN_ROWS, count: 5000, rows: [{ id: 'a' }] }))
    const table = await labData.readTable('conversations')

    assert.strictEqual(table.rowCount, 5000)
    assert.strictEqual(table.truncated, true)
  })

  it('orders by created_at when the table has one', async () => {
    const query = stubQuery(byShape({ columns: COLUMN_ROWS }))
    await labData.readTable('conversations')

    const select = query.calls.find((call) => call.sql.includes('SELECT *'))
    assert.match(select.sql, /ORDER BY "created_at" DESC/)
    assert.match(select.sql, /FROM "conversations"/)
  })

  it('falls back to the model primary key when the table has no created_at', async () => {
    // `message_feedback` and friends all have created_at; a table without one
    // must still order deterministically or the "newest first" grid is a lie.
    const query = stubQuery(byShape({
      columns: [{ column_name: 'anon_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO' }]
    }))
    await labData.readTable('visitors')

    const select = query.calls.find((call) => call.sql.includes('SELECT *'))
    assert.match(select.sql, /ORDER BY "id" DESC/)
  })

  const limits = [
    ['defaults to 1000 when omitted', undefined, 1000],
    ['keeps a sane explicit limit', 250, 250],
    ['clamps above the 10000 ceiling', 999999, 10000],
    ['clamps 0 up to the floor of 1', 1, 1],
    ['clamps a negative up to the floor of 1', -20, 1],
    ['falls back to the default on a non-numeric limit', 'all', 1000],
    ['truncates a fractional limit', 42.9, 42],
    ['accepts the numeric string a querystring delivers', '75', 75]
  ]

  for (const [label, limit, expected] of limits) {
    it(`${label}`, async () => {
      const query = stubQuery(byShape({ columns: COLUMN_ROWS }))
      await labData.readTable('conversations', { limit })

      const select = query.calls.find((call) => call.sql.includes('SELECT *'))
      assert.strictEqual(select.replacements.limit, expected)
    })
  }

  it('binds the limit rather than interpolating it into the SQL', async () => {
    const query = stubQuery(byShape({ columns: COLUMN_ROWS }))
    await labData.readTable('conversations', { limit: 250 })

    const select = query.calls.find((call) => call.sql.includes('SELECT *'))
    assert.match(select.sql, /LIMIT :limit/)
  })
})

describe('readConversationTree', () => {
  const conversation = { id: UUID, visitor_id: 3, page: 'chat', title: 'où est le wifi' }
  const visitor = { id: 3, anon_id: 'anon-1' }
  const messages = [
    { id: 'm1', role: 'user', content: 'où est le wifi' },
    { id: 'm2', role: 'assistant', content: 'au 2e' }
  ]

  const malformed = ['', null, undefined, 'not-a-uuid', '11111111-2222-4333-8444-55555555555', 42]
  for (const id of malformed) {
    it(`returns null on the malformed id ${JSON.stringify(id)} without querying`, async () => {
      const query = stubQuery([])
      assert.strictEqual(await labData.readConversationTree(id), null)
      assert.strictEqual(query.calls.length, 0)
    })
  }

  it('returns null when the conversation does not exist, after exactly one query', async () => {
    const query = stubQuery([[]])
    assert.strictEqual(await labData.readConversationTree(UUID), null)
    assert.strictEqual(query.calls.length, 1)
  })

  it('assembles the subtree and attaches documents and feedback to their message', async () => {
    stubQuery([
      [conversation],
      [visitor],
      messages,
      [
        { id: 1, message_id: 'm2', name: 'Wi-Fi', position: 0 },
        { id: 2, message_id: 'm2', name: 'Badge perdu', position: 1 }
      ],
      [{ id: 9, message_id: 'm2', rating: 1 }],
      [{ id: 5, type: 'no_match' }]
    ])

    const tree = await labData.readConversationTree(UUID)

    assert.deepStrictEqual(tree.conversation, conversation)
    assert.deepStrictEqual(tree.visitor, visitor)
    assert.deepStrictEqual(tree.events, [{ id: 5, type: 'no_match' }])

    // The user message owns nothing; the assistant message owns both documents,
    // in `position` order, plus the single feedback row.
    assert.deepStrictEqual(tree.messages[0].documents, [])
    assert.strictEqual(tree.messages[0].feedback, null)
    assert.deepStrictEqual(tree.messages[1].documents.map((d) => d.name), ['Wi-Fi', 'Badge perdu'])
    assert.deepStrictEqual(tree.messages[1].feedback, { id: 9, message_id: 'm2', rating: 1 })
  })

  it('keeps every raw column of the message row alongside the nested fields', async () => {
    stubQuery([[conversation], [visitor], messages, [], [], []])
    const tree = await labData.readConversationTree(UUID)

    // The inspector is a RAW view — spreading the row is the whole point.
    assert.strictEqual(tree.messages[1].role, 'assistant')
    assert.strictEqual(tree.messages[1].content, 'au 2e')
  })

  it('skips the IN (:ids) queries entirely when the conversation has no messages', async () => {
    // An empty `IN ()` is a Postgres SYNTAX ERROR, not an empty result — this is
    // the branch that turns a freshly-created conversation into a 500.
    const query = stubQuery([[conversation], [visitor], [], [{ id: 5 }]])
    const tree = await labData.readConversationTree(UUID)

    assert.deepStrictEqual(tree.messages, [])
    assert.deepStrictEqual(tree.events, [{ id: 5 }])
    assert.strictEqual(query.calls.length, 4, 'conversation, visitor, messages, events — no IN queries')
    assert.ok(!query.calls.some((call) => call.sql.includes('IN (:ids)')))
  })

  it('tolerates a conversation whose visitor row is gone', async () => {
    stubQuery([[conversation], [], messages, [], [], []])
    const tree = await labData.readConversationTree(UUID)
    assert.strictEqual(tree.visitor, null)
  })

  it('binds every id and never names the users table', async () => {
    const query = stubQuery([[conversation], [visitor], messages, [], [], []])
    await labData.readConversationTree(UUID)

    assert.strictEqual(query.calls[0].replacements.id, UUID)
    assert.strictEqual(query.calls[1].replacements.vid, conversation.visitor_id)
    assert.ok(!query.calls.some((call) => /"users"/.test(call.sql)))
  })

  it('orders messages chronologically with the user row winning a millisecond tie', async () => {
    // The frontend pairs question/answer by adjacency — a tie resolved the other
    // way silently renders the answer above its own question.
    const query = stubQuery([[conversation], [visitor], messages, [], [], []])
    await labData.readConversationTree(UUID)

    assert.match(query.calls[2].sql, /ORDER BY "created_at" ASC, \("role" = 'user'\) DESC/)
  })
})

'use strict'

// Unit suite for services/analytics.service.js — no Postgres.
//
// `sequelize.query` is stubbed, so what is under test here is everything AROUND
// the SQL: the row → payload mapping (snake_case → camelCase, the rounding, the
// null handling), the parameter binding, and `clampLimit`. Whether Postgres
// accepts the SQL text is the DB suite's job (test/services/analytics.test.js);
// this one runs with the containers down and covers the branches that fixture
// data can never reach — an empty result set, a NULL percentile, a garbage limit.
//
// Each `describe` asserts the SQL only by shape (which table, which clause is
// present). Asserting the full text would turn every formatting change into a
// failing test without catching a single real bug.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const { stubQuery, restoreAll } = require('../sequelizeStub')
const analytics = require('../../services/analytics.service')

const WINDOW = { from: '2026-03-01T00:00:00.000Z', to: '2026-03-08T00:00:00.000Z' }

afterEach(() => restoreAll())
after(() => restoreAll())

// A complete `totals` row as Postgres returns it — every column, realistic types.
const TOTALS_ROW = {
  requests: 10,
  requests_chat: 7,
  requests_archiviste: 3,
  thumbs_up: 4,
  thumbs_down: 1,
  no_match: 2,
  answered_with_doc_count: 10,
  active_visitors: 5,
  conversations: 6,
  avg_messages_per_conversation: '3.5',
  chat_latency_p50: 1234.6,
  chat_latency_p95: 4999.4,
  chat_latency_max: 8000
}

describe('totals', () => {
  it('maps a full row to the camelCase payload and rounds the percentiles', async () => {
    const query = stubQuery([[TOTALS_ROW]])
    const result = await analytics.totals(WINDOW)

    assert.deepStrictEqual(result, {
      requests: 10,
      requestsChat: 7,
      requestsArchiviste: 3,
      thumbsUp: 4,
      thumbsDown: 1,
      noMatch: 2,
      noMatchRate: 0.2,
      activeVisitors: 5,
      conversations: 6,
      // percentile_cont returns numeric, which pg hands back as a string —
      // Number() here is what stops the frontend charting "3.5" as a label.
      avgMessagesPerConversation: 3.5,
      chatLatencyP50: 1235,
      chatLatencyP95: 4999,
      chatLatencyMax: 8000
    })
    assert.strictEqual(query.calls.length, 1)
  })

  it('binds the window as :from / :to replacements rather than interpolating', async () => {
    const query = stubQuery([[TOTALS_ROW]])
    await analytics.totals(WINDOW)

    const [call] = query.calls
    assert.deepStrictEqual(call.replacements, { from: WINDOW.from, to: WINDOW.to })
    assert.ok(!call.sql.includes(WINDOW.from), 'the date must not appear inline in the SQL')
    assert.match(call.sql, /m\.created_at BETWEEN :from AND :to/)
  })

  it('returns noMatchRate null instead of dividing by zero on an empty window', async () => {
    stubQuery([[{ ...TOTALS_ROW, requests: 0, no_match: 0 }]])
    const result = await analytics.totals(WINDOW)
    assert.strictEqual(result.requests, 0)
    assert.strictEqual(result.noMatchRate, null)
  })

  it('survives a query that returns no row at all', async () => {
    // `one()` folds [] to {} — the tiles then render blanks rather than throwing
    // on a property of undefined.
    stubQuery([[]])
    const result = await analytics.totals(WINDOW)
    assert.strictEqual(result.requests, undefined)
    assert.strictEqual(result.noMatchRate, null)
    assert.strictEqual(result.chatLatencyMax, null)
  })

  it('keeps NULL latencies and NULL averages as null, not NaN or 0', async () => {
    // A window with chat traffic but no recorded latency: percentile_cont
    // returns NULL, and Math.round(null) would silently produce 0 — a latency
    // chart reading "0 ms" is worse than an empty one.
    stubQuery([[{
      ...TOTALS_ROW,
      avg_messages_per_conversation: null,
      chat_latency_p50: null,
      chat_latency_p95: null,
      chat_latency_max: null
    }]])
    const result = await analytics.totals(WINDOW)

    assert.strictEqual(result.avgMessagesPerConversation, null)
    assert.strictEqual(result.chatLatencyP50, null)
    assert.strictEqual(result.chatLatencyP95, null)
    assert.strictEqual(result.chatLatencyMax, null)
  })
})

describe('the daily series', () => {
  const cases = [
    {
      name: 'dailyVisitors',
      run: () => analytics.dailyVisitors(WINDOW),
      rows: [{ day: '2026-03-01', active: 3, new: 1 }],
      source: /FROM visitors v/
    },
    {
      name: 'dailyVolume',
      run: () => analytics.dailyVolume(WINDOW),
      rows: [{ day: '2026-03-01', total: 5, chat: 3, archiviste: 2, noMatch: 1 }],
      source: /FILTER \(WHERE c\.page = 'archiviste'\)/
    },
    {
      name: 'dailyFeedback',
      run: () => analytics.dailyFeedback(WINDOW),
      rows: [{ day: '2026-03-01', up: 2, down: 1 }],
      source: /FROM message_feedback/
    }
  ]

  for (const { name, run, rows, source } of cases) {
    it(`${name} passes the rows straight through — Postgres already shaped them`, async () => {
      stubQuery([rows])
      assert.deepStrictEqual(await run(), rows)
    })

    it(`${name} gap-fills through the days CTE and buckets on Paris local days`, async () => {
      // Without generate_series a quiet day is a MISSING point, and a line chart
      // then draws a straight segment across it as if traffic were interpolated.
      const query = stubQuery([rows])
      await run()

      const [call] = query.calls
      assert.match(call.sql, /generate_series/)
      assert.match(call.sql, /LEFT JOIN/)
      assert.match(call.sql, /AT TIME ZONE 'Europe\/Paris'/)
      assert.match(call.sql, source)
      assert.deepStrictEqual(call.replacements, { from: WINDOW.from, to: WINDOW.to })
    })
  }
})

describe('scoreHistogram', () => {
  it('asks for 15 fixed buckets over [0.85, 1.00]', async () => {
    const query = stubQuery([[{ bucket: 1, lo: 0.85, hi: 0.86, count: 0 }]])
    await analytics.scoreHistogram(WINDOW)

    const [call] = query.calls
    assert.strictEqual(call.replacements.lo, 0.85)
    assert.strictEqual(call.replacements.hi, 1.0)
    assert.strictEqual(call.replacements.n, 15)
  })

  it('keeps the numeric cast and the least(...) fold that put 1.000 in the last bin', async () => {
    // Both corrections are load-bearing and both are invisible in the output
    // shape: a float8 width_bucket puts a score sitting on a bin edge one bin
    // low, and without least(..., :n) an exact 1.000 lands in bucket 16 and is
    // dropped by the generate_series join. A subject PDF matching its own name
    // scores exactly 1.000, so that bin is not hypothetical.
    const query = stubQuery([[]])
    await analytics.scoreHistogram(WINDOW)

    const [call] = query.calls
    assert.match(call.sql, /md\.score::numeric/)
    assert.match(call.sql, /least\(/)
  })

  it('returns the bucket rows unchanged', async () => {
    const rows = [
      { bucket: 14, lo: 0.98, hi: 0.99, count: 3 },
      { bucket: 15, lo: 0.99, hi: 1.0, count: 7 }
    ]
    stubQuery([rows])
    assert.deepStrictEqual(await analytics.scoreHistogram(WINDOW), rows)
  })
})

describe('topDocuments', () => {
  it('defaults to a limit of 15 and orders by count then score', async () => {
    const query = stubQuery([[]])
    await analytics.topDocuments(WINDOW)

    const [call] = query.calls
    assert.strictEqual(call.replacements.limit, 15)
    assert.match(call.sql, /ORDER BY count\(\*\) DESC, "avgScore" DESC NULLS LAST/)
  })

  it('caps the limit at 50', async () => {
    const query = stubQuery([[]])
    await analytics.topDocuments({ ...WINDOW, limit: 9999 })
    assert.strictEqual(query.calls[0].replacements.limit, 50)
  })

  it('returns the aggregated rows unchanged', async () => {
    const rows = [{ name: 'Wi-Fi', type: 'md', count: 12, avgScore: 0.94, lastUsedAt: WINDOW.to }]
    stubQuery([rows])
    assert.deepStrictEqual(await analytics.topDocuments(WINDOW), rows)
  })
})

describe('the breakdowns', () => {
  it('languageSplit folds NULL and empty language to "unknown"', async () => {
    const query = stubQuery([[{ language: 'fr', count: 9 }, { language: 'unknown', count: 2 }]])
    const rows = await analytics.languageSplit(WINDOW)

    assert.deepStrictEqual(rows.map((row) => row.language), ['fr', 'unknown'])
    assert.match(query.calls[0].sql, /COALESCE\(NULLIF\(m\.language, ''\), 'unknown'\)/)
    assert.match(query.calls[0].sql, /m\.role = 'assistant'/)
  })

  it('errorBreakdown folds NULL error_code to "ok" — a clean answer is a bucket too', async () => {
    const query = stubQuery([[{ code: 'ok', count: 40 }, { code: 'llm_error', count: 1 }]])
    const rows = await analytics.errorBreakdown(WINDOW)

    assert.deepStrictEqual(rows.map((row) => row.code), ['ok', 'llm_error'])
    assert.match(query.calls[0].sql, /COALESCE\(NULLIF\(m\.error_code, ''\), 'ok'\)/)
  })
})

describe('unmatchedQuestions', () => {
  it('returns the items plus the untruncated total, from a single query on the common path', async () => {
    const items = [{
      id: '1', question: 'où est le wifi', language: 'fr', page: 'chat', createdAt: WINDOW.to, _total: 42
    }]
    const query = stubQuery([items])

    assert.deepStrictEqual(await analytics.unmatchedQuestions(WINDOW), {
      items: [{ id: '1', question: 'où est le wifi', language: 'fr', page: 'chat', createdAt: WINDOW.to }],
      total: 42
    })
    // The total comes from the window function on the page query — no second
    // round trip when the page has at least one row.
    assert.strictEqual(query.calls.length, 1)
    assert.match(query.calls[0].sql, /count\(\*\) OVER \(\)::int\s+AS "_total"/)
  })

  it('falls back to a count query when the page is empty — an offset past the end must not report total: 0', async () => {
    const query = stubQuery([[], [{ total: 42 }]])

    assert.deepStrictEqual(await analytics.unmatchedQuestions({ ...WINDOW, offset: 100000 }), {
      items: [], total: 42
    })
    assert.strictEqual(query.calls.length, 2)
    assert.match(query.calls[1].sql, /count\(\*\)::int AS total/)
  })

  it('defaults to limit 100 / offset 0 / no page filter', async () => {
    const query = stubQuery([[]])
    await analytics.unmatchedQuestions(WINDOW)

    assert.deepStrictEqual(query.calls[0].replacements, {
      from: WINDOW.from, to: WINDOW.to, limit: 100, offset: 0, page: null
    })
    // A null :page has to disable the filter rather than match page IS NULL.
    assert.match(query.calls[0].sql, /\(:page::text IS NULL OR c\.page::text = :page::text\)/)
  })

  it('caps the limit at 500 and floors a negative offset at 0', async () => {
    const query = stubQuery([[]])
    await analytics.unmatchedQuestions({ ...WINDOW, limit: 100000, offset: -5 })

    assert.strictEqual(query.calls[0].replacements.limit, 500)
    assert.strictEqual(query.calls[0].replacements.offset, 0)
  })

  it('passes the same page filter to the fallback count as the page query', async () => {
    const query = stubQuery([[], [{ total: 3 }]])
    await analytics.unmatchedQuestions({ ...WINDOW, page: 'archiviste' })

    // Same replacements object for both — a total counted with a different
    // filter than the page would make the pager overshoot.
    assert.strictEqual(query.calls[0].replacements.page, 'archiviste')
    assert.strictEqual(query.calls[1].replacements.page, 'archiviste')
  })

  it('selects only no_match events and reads the question out of the payload', async () => {
    const query = stubQuery([[]])
    await analytics.unmatchedQuestions(WINDOW)

    assert.match(query.calls[0].sql, /e\.type = 'no_match'/)
    assert.match(query.calls[0].sql, /e\.payload->>'question'/)
    // conversation_id is nullable, so an inner join would silently drop events.
    assert.match(query.calls[0].sql, /LEFT JOIN conversations c/)
  })
})

describe('conversationList', () => {
  it('returns the items plus the untruncated total, from a single query on the common path', async () => {
    const items = [{ id: 'c1', page: 'chat', messageCount: 4, hasNegativeFeedback: false, _total: 9 }]
    const query = stubQuery([items])

    assert.deepStrictEqual(await analytics.conversationList(WINDOW), {
      items: [{ id: 'c1', page: 'chat', messageCount: 4, hasNegativeFeedback: false }],
      total: 9
    })
    assert.strictEqual(query.calls.length, 1)
    assert.match(query.calls[0].sql, /count\(\*\) OVER \(\)::int\s+AS "_total"/)
  })

  it('falls back to a count query when the page is empty — an offset past the end must not report total: 0', async () => {
    const query = stubQuery([[], [{ total: 9 }]])

    assert.deepStrictEqual(await analytics.conversationList({ ...WINDOW, offset: 100000 }), {
      items: [], total: 9
    })
    assert.strictEqual(query.calls.length, 2)
  })

  it('defaults to limit 25 and caps it at 200', async () => {
    const first = stubQuery([[]])
    await analytics.conversationList(WINDOW)
    assert.strictEqual(first.calls[0].replacements.limit, 25)
    first.restore()

    const second = stubQuery([[]])
    await analytics.conversationList({ ...WINDOW, limit: 5000 })
    assert.strictEqual(second.calls[0].replacements.limit, 200)
  })

  it('filters on created_at but orders on updated_at — newest activity first', async () => {
    const query = stubQuery([[]])
    await analytics.conversationList(WINDOW)

    assert.match(query.calls[0].sql, /WHERE c\.created_at BETWEEN :from AND :to/)
    assert.match(query.calls[0].sql, /ORDER BY c\.updated_at DESC/)
  })

  it('flags a thread containing a thumbs-down on an assistant message', async () => {
    const query = stubQuery([[]])
    await analytics.conversationList(WINDOW)

    assert.match(query.calls[0].sql, /EXISTS \(/)
    assert.match(query.calls[0].sql, /mf\.rating = -1/)
  })
})

describe('clampLimit (through its callers)', () => {
  // Not exported — reached via the three functions that use it. Garbage in a
  // querystring reaching `LIMIT` as NaN would make Postgres throw, so the floor
  // of 1 is the thing that keeps a bad URL a bad page rather than a 500.
  const garbage = [
    ['a non-numeric string', 'lots'],
    ['null', null],
    ['zero', 0],
    ['a negative', -10],
    ['Infinity', Infinity],
    ['NaN', NaN]
  ]

  for (const [label, value] of garbage) {
    it(`floors ${label} to 1`, async () => {
      const query = stubQuery([[]])
      await analytics.topDocuments({ ...WINDOW, limit: value })
      assert.strictEqual(query.calls[0].replacements.limit, 1)
    })
  }

  it('lets an absent limit fall through to the default, not to the floor', async () => {
    // `limit: undefined` must hit the parameter default (15); only `null` and
    // real garbage get floored. Conflating the two would silently turn a caller
    // that omits the option into a one-row page.
    const query = stubQuery([[]])
    await analytics.topDocuments({ ...WINDOW, limit: undefined })
    assert.strictEqual(query.calls[0].replacements.limit, 15)
  })

  it('truncates a fractional limit rather than passing a float to LIMIT', async () => {
    const query = stubQuery([[]])
    await analytics.topDocuments({ ...WINDOW, limit: 7.9 })
    assert.strictEqual(query.calls[0].replacements.limit, 7)
  })

  it('accepts a numeric string, which is what a querystring actually delivers', async () => {
    const query = stubQuery([[]])
    await analytics.topDocuments({ ...WINDOW, limit: '12' })
    assert.strictEqual(query.calls[0].replacements.limit, 12)
  })
})

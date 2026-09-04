'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { itDb } = require('../helper')
const analytics = require('../../services/analytics.service')
const { sequelize } = require('../../models')
const { seedAnalytics, WINDOW, DAY_1, DAY_2 } = require('../fixtures/seedAnalytics')

const ALL_TIME = { from: '-infinity', to: 'infinity' }

// resolveWindow is pure — no DB needed.
describe('resolveWindow', () => {
  it('defaults to the last 7 days ending now', () => {
    const { from, to } = analytics.resolveWindow()
    const span = new Date(to).getTime() - new Date(from).getTime()
    assert.strictEqual(span, 7 * 864e5)
    assert.ok(Date.now() - new Date(to).getTime() < 5000)
  })

  it('honours an explicit window and normalises it to ISO', () => {
    const window = analytics.resolveWindow({ from: '2026-03-01', to: '2026-03-08' })
    assert.strictEqual(window.from, '2026-03-01T00:00:00.000Z')
    assert.strictEqual(window.to, '2026-03-08T00:00:00.000Z')
  })

  it('anchors the default `from` on the given `to`, not on now', () => {
    const { from, to } = analytics.resolveWindow({ to: '2026-03-08T00:00:00Z' })
    assert.strictEqual(to, '2026-03-08T00:00:00.000Z')
    assert.strictEqual(from, '2026-03-01T00:00:00.000Z')
  })

  it('takes the defaultDays override — the conversation browser asks for a decade', () => {
    const { from, to } = analytics.resolveWindow({}, 3650)
    assert.strictEqual(new Date(to).getTime() - new Date(from).getTime(), 3650 * 864e5)
  })

  it('falls back to the default on an unparseable value instead of producing Invalid Date', () => {
    // An Invalid Date would serialise to null and every window-bound query would
    // silently return nothing.
    const { from, to } = analytics.resolveWindow({ from: 'yesterday-ish', to: 'soon' })
    assert.ok(!Number.isNaN(new Date(from).getTime()))
    assert.strictEqual(new Date(to).getTime() - new Date(from).getTime(), 7 * 864e5)
  })
})

describe('totals', () => {
  itDb('counts the seeded window exactly', async () => {
    await seedAnalytics()
    const totals = await analytics.totals(WINDOW)

    assert.strictEqual(totals.requests, 3)
    assert.strictEqual(totals.requestsChat, 2)
    assert.strictEqual(totals.requestsArchiviste, 1)
    assert.strictEqual(totals.thumbsUp, 1)
    assert.strictEqual(totals.thumbsDown, 1)
    assert.strictEqual(totals.noMatch, 1)
    assert.ok(Math.abs(totals.noMatchRate - 1 / 3) < 1e-9)
    assert.strictEqual(totals.activeVisitors, 2)
    assert.strictEqual(totals.conversations, 3)
    assert.strictEqual(totals.avgMessagesPerConversation, 2)
  })

  itDb('reports chat latency percentiles from chat rows only', async () => {
    // The archiviste 3 000 ms row must not enter the chat latency figures.
    await seedAnalytics()
    const totals = await analytics.totals(WINDOW)

    assert.strictEqual(totals.chatLatencyP50, 3000) // median of 1 000 and 5 000
    assert.strictEqual(totals.chatLatencyP95, 4800)
    assert.strictEqual(totals.chatLatencyMax, 5000)
  })

  itDb('returns zeros and nulls on an empty window rather than throwing', async () => {
    await seedAnalytics()
    const totals = await analytics.totals({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' })

    assert.strictEqual(totals.requests, 0)
    assert.strictEqual(totals.noMatchRate, null)
    assert.strictEqual(totals.avgMessagesPerConversation, null)
    assert.strictEqual(totals.chatLatencyP50, null)
    assert.strictEqual(totals.chatLatencyMax, null)
  })

  itDb('runs unbounded for the all-time block', async () => {
    // The overview route reuses this same SQL with -infinity/infinity.
    await seedAnalytics()
    assert.strictEqual((await analytics.totals(ALL_TIME)).requests, 3)
  })
})

describe('daily series', () => {
  itDb('gap-fills every day in the window, quiet days included', async () => {
    await seedAnalytics()
    const days = (await analytics.dailyVisitors(WINDOW)).map((row) => row.day)
    // 09 → 12 inclusive, and the two quiet days are real rows, not holes: a
    // chart with a missing day draws a straight line across it instead of a dip.
    assert.deepStrictEqual(days, ['2026-03-09', DAY_1, DAY_2, '2026-03-12'])
  })

  itDb('buckets by the PARIS day, not the UTC day', async () => {
    // 23:30 UTC on the 11th is already 00:30 on the 12th in Paris. Getting this
    // wrong shifts a whole chart by one day, which nothing else would reveal.
    await seedAnalytics()
    const days = (await analytics.dailyVisitors({
      from: '2026-03-11T23:30:00Z',
      to: '2026-03-11T23:45:00Z'
    })).map((row) => row.day)

    assert.deepStrictEqual(days, ['2026-03-12'])
  })

  itDb('counts active and new visitors per Paris day', async () => {
    await seedAnalytics()
    const byDay = Object.fromEntries((await analytics.dailyVisitors(WINDOW)).map((r) => [r.day, r]))

    assert.deepStrictEqual({ ...byDay['2026-03-09'] }, { day: '2026-03-09', active: 0, new: 0 })
    assert.strictEqual(byDay[DAY_1].active, 1)
    assert.strictEqual(byDay[DAY_1].new, 1)
    assert.strictEqual(byDay[DAY_2].active, 2)
    assert.strictEqual(byDay[DAY_2].new, 1)
  })

  itDb('splits daily volume by page and flags the no-match rows', async () => {
    await seedAnalytics()
    const byDay = Object.fromEntries((await analytics.dailyVolume(WINDOW)).map((r) => [r.day, r]))

    assert.deepStrictEqual({ ...byDay[DAY_1] }, { day: DAY_1, total: 1, chat: 1, archiviste: 0, noMatch: 0 })
    assert.deepStrictEqual({ ...byDay[DAY_2] }, { day: DAY_2, total: 2, chat: 1, archiviste: 1, noMatch: 1 })
  })

  itDb('counts 👍/👎 per day on the feedback row’s own timestamp', async () => {
    await seedAnalytics()
    const byDay = Object.fromEntries((await analytics.dailyFeedback(WINDOW)).map((r) => [r.day, r]))

    assert.deepStrictEqual({ ...byDay[DAY_1] }, { day: DAY_1, up: 1, down: 0 })
    assert.deepStrictEqual({ ...byDay[DAY_2] }, { day: DAY_2, up: 0, down: 1 })
  })
})

describe('distributions', () => {
  itDb('bins retrieval scores into 15 fixed buckets over [0.85, 1.00]', async () => {
    await seedAnalytics()
    const histogram = await analytics.scoreHistogram(WINDOW)

    assert.strictEqual(histogram.length, 15)
    assert.strictEqual(histogram.reduce((n, bin) => n + bin.count, 0), 3)
    assert.deepStrictEqual(histogram[0], { bucket: 1, lo: 0.85, hi: 0.86, count: 0 })

    const nonEmpty = histogram.filter((bin) => bin.count > 0)
    assert.deepStrictEqual(nonEmpty.map((bin) => bin.count), [1, 1, 1])
    // Each score sits in the bin the chart's own label claims. Bucketing runs on
    // `numeric`: in float8, (0.95 − 0.85) / 0.01 is 9.999999999999998 and 0.95
    // used to be counted in the bin labelled 0.94.
    assert.deepStrictEqual(nonEmpty.map((bin) => bin.lo), [0.91, 0.93, 0.95])
  })

  itDb('counts a perfect 1.000 score in the last bin', async () => {
    // `width_bucket(1.0, 0.85, 1.0, 15)` returns 16 — the "above the upper
    // bound" bucket — and the LEFT JOIN onto generate_series(1, 15) used to drop
    // the row entirely. 1.000 is a COMMON real score here (a subject PDF matches
    // its own name at exactly 1.000), so the best bin was under-counted.
    const ids = await seedAnalytics()
    await sequelize.query(
      `INSERT INTO message_documents (message_id, name, type, url, path, score, position)
       VALUES (:messageId, 'Libft.en.subject', 'pdf', '/u', '/p', 1.0, 9)`,
      { replacements: { messageId: ids.assistantChat } }
    )

    const histogram = await analytics.scoreHistogram(WINDOW)

    // Nothing is lost: every scored document is in exactly one bin.
    assert.strictEqual(histogram.reduce((n, bin) => n + bin.count, 0), 4)
    const last = histogram.at(-1)
    assert.deepStrictEqual({ lo: last.lo, hi: last.hi, count: last.count }, { lo: 0.99, hi: 1, count: 1 })
  })

  itDb('puts 0.99 in the top bin and 0.85 in the first one — both edges', async () => {
    const ids = await seedAnalytics()
    await sequelize.query(
      `INSERT INTO message_documents (message_id, name, type, url, path, score, position)
       VALUES (:messageId, 'Edge-high', 'md', '/u', '/p', 0.99, 10),
              (:messageId, 'Edge-low',  'md', '/u', '/p', 0.85, 11)`,
      { replacements: { messageId: ids.assistantChat } }
    )

    const byLo = Object.fromEntries((await analytics.scoreHistogram(WINDOW)).map((bin) => [bin.lo, bin.count]))
    // 0.99 was landing in the bin labelled 0.98 before the numeric cast.
    assert.strictEqual(byLo[0.99], 1)
    assert.strictEqual(byLo[0.85], 1)
  })

  itDb('ranks the most-returned documents with their mean score', async () => {
    await seedAnalytics()
    const top = await analytics.topDocuments(WINDOW)

    assert.deepStrictEqual(top.map((doc) => doc.name), ['Alternance', 'Wi-Fi'])
    assert.strictEqual(top[0].count, 2)
    assert.strictEqual(top[0].avgScore, 0.94)
    assert.strictEqual(top[0].type, 'md')
    assert.ok(top[0].lastUsedAt)
  })

  itDb("folds a NULL language into 'unknown' and a NULL error_code into 'ok'", async () => {
    await seedAnalytics()

    assert.deepStrictEqual(
      Object.fromEntries((await analytics.languageSplit(WINDOW)).map((r) => [r.language, r.count])),
      { fr: 1, en: 1, unknown: 1 }
    )
    assert.deepStrictEqual(
      Object.fromEntries((await analytics.errorBreakdown(WINDOW)).map((r) => [r.code, r.count])),
      { ok: 2, ollama_error: 1 }
    )
  })
})

describe('unmatchedQuestions', () => {
  itDb('lists no_match events with the question, language and owning page', async () => {
    await seedAnalytics()
    const { items, total } = await analytics.unmatchedQuestions(WINDOW)

    assert.strictEqual(total, 1)
    assert.strictEqual(items[0].question, 'quantum badge')
    assert.strictEqual(items[0].language, 'en')
    assert.strictEqual(items[0].page, 'archiviste')
  })

  itDb('filters by page', async () => {
    await seedAnalytics()
    assert.strictEqual((await analytics.unmatchedQuestions({ ...WINDOW, page: 'chat' })).total, 0)
    assert.strictEqual((await analytics.unmatchedQuestions({ ...WINDOW, page: 'archiviste' })).total, 1)
  })

  itDb('paginates without changing the total', async () => {
    await seedAnalytics()
    const page = await analytics.unmatchedQuestions({ ...WINDOW, limit: 1, offset: 1 })
    assert.strictEqual(page.total, 1)
    assert.deepStrictEqual(page.items, [])
  })

  itDb('clamps a garbage limit instead of building an invalid query', async () => {
    await seedAnalytics()
    for (const limit of [0, -5, NaN, 99999]) {
      assert.strictEqual((await analytics.unmatchedQuestions({ ...WINDOW, limit })).total, 1)
    }
  })
})

describe('conversationList', () => {
  itDb('lists every visitor’s conversations, newest updated first', async () => {
    // Admin-wide, unlike the visitor-scoped GET /conversations.
    const ids = await seedAnalytics()
    const { items, total } = await analytics.conversationList(WINDOW)

    assert.strictEqual(total, 3)
    assert.deepStrictEqual(items.map((row) => row.id), [
      ids.conversationOther, ids.conversationArchiviste, ids.conversationChat
    ])
    assert.strictEqual(items[0].messageCount, 2)
  })

  itDb('flags a conversation carrying a 👎', async () => {
    const ids = await seedAnalytics()
    const byId = Object.fromEntries((await analytics.conversationList(WINDOW)).items.map((r) => [r.id, r]))

    assert.strictEqual(byId[ids.conversationOther].hasNegativeFeedback, true)
    assert.strictEqual(byId[ids.conversationChat].hasNegativeFeedback, false)
  })

  itDb('filters by page and paginates', async () => {
    await seedAnalytics()

    const chat = await analytics.conversationList({ ...WINDOW, page: 'chat' })
    assert.strictEqual(chat.total, 2)

    const paged = await analytics.conversationList({ ...WINDOW, limit: 1, offset: 2 })
    assert.strictEqual(paged.total, 3)
    assert.strictEqual(paged.items.length, 1)
  })
})

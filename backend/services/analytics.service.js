'use strict'

const { QueryTypes } = require('sequelize')
const { sequelize } = require('../models')

/**
 * Aggregation layer for the /lab 🔬 usage dashboard. One exported function per
 * metric, each a single raw SQL query through `sequelize.query` — no ORM, no
 * `fastify`, counting done by Postgres (`COUNT(*) FILTER`, `percentile_cont`,
 * `date_trunc` + `generate_series`), never by pulling rows into JS.
 *
 * ── Conventions ─────────────────────────────────────────────────────────────
 * - Every function takes a `{ from, to }` window; both are ISO strings or Date
 *   objects, bound as `:from` / `:to` replacements (never interpolated).
 * - "One request / exchange" = one `messages` row with `role = 'assistant'`
 *   (exactly one per exchange, happy path, error path and /archiviste alike).
 *   The chat / archiviste split is `JOIN conversations c ON c.id =
 *   m.conversation_id` then `c.page`. `events` are NOT counted for volume.
 * - "nothing matched" is `messages.document_count = 0` (NULL only on
 *   pre-migration rows), paired with a `no_match` event.
 * - Day buckets are the Paris local day: `created_at AT TIME ZONE
 *   'Europe/Paris'` then `::date`. Daily series are LEFT JOINed onto a
 *   `generate_series` of days so a day with no traffic is a real `0` point.
 */

// Paris-local calendar day of a timestamptz column.
const PARIS_DAY = (col) => `(${col} AT TIME ZONE 'Europe/Paris')::date`

// A gap-fill spine of Paris-local days covering [from, to] inclusive. Used as a
// CTE named `days(day)` that every daily series LEFT JOINs against.
const DAYS_CTE = `
  days AS (
    SELECT generate_series(
      date_trunc('day', (:from)::timestamptz AT TIME ZONE 'Europe/Paris'),
      date_trunc('day', (:to)::timestamptz   AT TIME ZONE 'Europe/Paris'),
      interval '1 day'
    )::date AS day
  )`

/** @param {*} rows @returns {Object} the single row of a one-row query */
const one = (rows) => rows[0] || {}

const DEFAULT_WINDOW_DAYS = 7

/**
 * Normalise an optional `{ from, to }` (ISO strings from a querystring) into a
 * concrete window. `to` defaults to now, `from` to `defaultDays` before `to`.
 * Unparseable values fall back to the default. Pure — kept here (not in a route)
 * so the routes stay transport-only and this is unit-testable.
 *
 * @param {{ from?: string, to?: string }} [query]
 * @param {number} [defaultDays]
 * @returns {{ from: string, to: string }}
 */
function resolveWindow ({ from, to } = {}, defaultDays = DEFAULT_WINDOW_DAYS) {
  const toDate = parseDate(to) || new Date()
  const fromDate = parseDate(from) || new Date(toDate.getTime() - defaultDays * 864e5)
  return { from: fromDate.toISOString(), to: toDate.toISOString() }
}

/** @param {*} value @returns {Date | null} */
function parseDate (value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Counter-tile figures for one window. Run twice by `overview` — once with the
 * real `{ from, to }` (the "range" block) and once with `-infinity` / `infinity`
 * (the "all-time" block) — from the same SQL text.
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<import('../types/types').AnalyticsTotals>}
 */
async function totals ({ from, to }) {
  const rows = await sequelize.query(
    `
    WITH am AS (
      -- every assistant message in the window, tagged with its conversation's page
      SELECT m.id, m.latency_ms, m.document_count, m.error_code,
             m.conversation_id, c.page, c.visitor_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant' AND m.created_at BETWEEN :from AND :to
    ),
    allm AS (
      -- every message (both roles) in the window, for messages-per-conversation
      SELECT m.conversation_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.created_at BETWEEN :from AND :to
    ),
    fb AS (
      SELECT rating FROM message_feedback
      WHERE created_at BETWEEN :from AND :to
    )
    SELECT
      (SELECT count(*) FROM am)::int                                        AS requests,
      (SELECT count(*) FROM am WHERE page = 'chat')::int                    AS requests_chat,
      (SELECT count(*) FROM am WHERE page = 'archiviste')::int              AS requests_archiviste,
      (SELECT count(*) FROM fb WHERE rating = 1)::int                       AS thumbs_up,
      (SELECT count(*) FROM fb WHERE rating = -1)::int                      AS thumbs_down,
      (SELECT count(*) FROM am WHERE document_count = 0)::int               AS no_match,
      (SELECT count(*) FROM am WHERE document_count IS NOT NULL)::int       AS answered_with_doc_count,
      (SELECT count(DISTINCT visitor_id) FROM am)::int                      AS active_visitors,
      (SELECT count(DISTINCT conversation_id) FROM allm)::int               AS conversations,
      (SELECT count(*)::float8 FROM allm)
        / NULLIF((SELECT count(DISTINCT conversation_id) FROM allm), 0)     AS avg_messages_per_conversation,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
         FROM am WHERE page = 'chat' AND latency_ms IS NOT NULL)            AS chat_latency_p50,
      (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
         FROM am WHERE page = 'chat' AND latency_ms IS NOT NULL)            AS chat_latency_p95,
      (SELECT max(latency_ms) FROM am WHERE page = 'chat')::int             AS chat_latency_max
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )

  const r = one(rows)
  const noMatchRate = r.requests > 0 ? r.no_match / r.requests : null
  return {
    requests: r.requests,
    requestsChat: r.requests_chat,
    requestsArchiviste: r.requests_archiviste,
    thumbsUp: r.thumbs_up,
    thumbsDown: r.thumbs_down,
    noMatch: r.no_match,
    noMatchRate,
    activeVisitors: r.active_visitors,
    conversations: r.conversations,
    avgMessagesPerConversation:
      r.avg_messages_per_conversation == null ? null : Number(r.avg_messages_per_conversation),
    chatLatencyP50: r.chat_latency_p50 == null ? null : Math.round(r.chat_latency_p50),
    chatLatencyP95: r.chat_latency_p95 == null ? null : Math.round(r.chat_latency_p95),
    chatLatencyMax: r.chat_latency_max ?? null
  }
}

/**
 * Active visitors per day (distinct `conversations.visitor_id` with an assistant
 * message that day) and new visitors per day (`visitors.first_seen_at`).
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ day: string, active: number, new: number }>>}
 */
async function dailyVisitors ({ from, to }) {
  return sequelize.query(
    `
    WITH ${DAYS_CTE},
    active AS (
      SELECT ${PARIS_DAY('m.created_at')} AS day,
             count(DISTINCT c.visitor_id) AS active
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant' AND m.created_at BETWEEN :from AND :to
      GROUP BY 1
    ),
    fresh AS (
      SELECT ${PARIS_DAY('v.first_seen_at')} AS day, count(*) AS new
      FROM visitors v
      WHERE v.first_seen_at BETWEEN :from AND :to
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(a.active, 0)::int  AS active,
           COALESCE(f.new, 0)::int     AS new
    FROM days d
    LEFT JOIN active a ON a.day = d.day
    LEFT JOIN fresh  f ON f.day = d.day
    ORDER BY d.day
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )
}

/**
 * Exchanges per day, split by page, with the no-match count as a fourth series.
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ day: string, total: number, chat: number, archiviste: number, noMatch: number }>>}
 */
async function dailyVolume ({ from, to }) {
  return sequelize.query(
    `
    WITH ${DAYS_CTE},
    vol AS (
      SELECT ${PARIS_DAY('m.created_at')} AS day,
             count(*)                                        AS total,
             count(*) FILTER (WHERE c.page = 'chat')         AS chat,
             count(*) FILTER (WHERE c.page = 'archiviste')   AS archiviste,
             count(*) FILTER (WHERE m.document_count = 0)     AS no_match
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant' AND m.created_at BETWEEN :from AND :to
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD')       AS day,
           COALESCE(v.total, 0)::int          AS total,
           COALESCE(v.chat, 0)::int           AS chat,
           COALESCE(v.archiviste, 0)::int     AS archiviste,
           COALESCE(v.no_match, 0)::int       AS "noMatch"
    FROM days d
    LEFT JOIN vol v ON v.day = d.day
    ORDER BY d.day
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )
}

/**
 * 👍 / 👎 counts per day, by `message_feedback.created_at`.
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ day: string, up: number, down: number }>>}
 */
async function dailyFeedback ({ from, to }) {
  return sequelize.query(
    `
    WITH ${DAYS_CTE},
    fb AS (
      SELECT ${PARIS_DAY('created_at')} AS day,
             count(*) FILTER (WHERE rating = 1)  AS up,
             count(*) FILTER (WHERE rating = -1) AS down
      FROM message_feedback
      WHERE created_at BETWEEN :from AND :to
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(f.up, 0)::int       AS up,
           COALESCE(f.down, 0)::int     AS down
    FROM days d
    LEFT JOIN fb f ON f.day = d.day
    ORDER BY d.day
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )
}

// Retrieval-score histogram: 15 fixed 0.01-wide buckets over [0.85, 1.00].
// `MIN_SCORE` on both pages is 0.89, so real data lives in the top ~11 buckets;
// the wider floor catches any pre-tuning row without an "other" bin. Bins are
// half-open, [lo, hi), except the last one which includes 1.00 — see the
// bucket expression in scoreHistogram().
const HIST_LO = 0.85
const HIST_HI = 1.0
const HIST_BUCKETS = 15

/**
 * Distribution of `message_documents.score`, filtered by the owning assistant
 * message's `created_at`.
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ bucket: number, lo: number, hi: number, count: number }>>}
 */
async function scoreHistogram ({ from, to }) {
  return sequelize.query(
    `
    WITH s AS (
      -- Two deliberate corrections to a plain width_bucket(md.score, :lo, :hi, :n):
      --
      -- 1. a numeric cast, not the float8 the column stores. In double precision
      --    (0.95 - 0.85) / 0.01 evaluates to 9.999999999999998, so a score
      --    sitting exactly on a bin edge fell one bin low — 0.95 was counted in
      --    [0.94, 0.95) and 0.99 in [0.98, 0.99). Exact decimal arithmetic puts
      --    each score in the bin the chart's own label claims.
      -- 2. least(..., :n) folds the upper bound into the last bin. width_bucket
      --    puts x >= hi in bucket n+1, and the LEFT JOIN on
      --    generate_series(1, :n) below then DROPPED those rows entirely — while
      --    1.000 is a common real score here (a subject PDF matches its own name
      --    at exactly 1.000 -- see "Services & RAG storage"). The histogram was
      --    silently under-counting its best bin.
      SELECT least(
               width_bucket(md.score::numeric, (:lo)::numeric, (:hi)::numeric, :n),
               :n
             ) AS bucket
      FROM message_documents md
      JOIN messages m ON m.id = md.message_id
      WHERE md.score IS NOT NULL AND m.created_at BETWEEN :from AND :to
    )
    SELECT g.bucket,
           round((:lo + (g.bucket - 1) * (:hi - :lo) / :n)::numeric, 4)::float8 AS lo,
           round((:lo + g.bucket       * (:hi - :lo) / :n)::numeric, 4)::float8 AS hi,
           count(s.bucket)::int AS count
    FROM generate_series(1, :n) AS g(bucket)
    LEFT JOIN s ON s.bucket = g.bucket
    GROUP BY g.bucket
    ORDER BY g.bucket
    `,
    { type: QueryTypes.SELECT, replacements: { from, to, lo: HIST_LO, hi: HIST_HI, n: HIST_BUCKETS } }
  )
}

/**
 * Most-returned documents in the window: name + type, how many times returned,
 * mean score, and the most recent use.
 *
 * @param {{ from: string | Date, to: string | Date, limit?: number }} opts
 * @returns {Promise<Array<{ name: string, type: string | null, count: number, avgScore: number | null, lastUsedAt: string }>>}
 */
async function topDocuments ({ from, to, limit = 15 }) {
  return sequelize.query(
    `
    SELECT md.name,
           md.type,
           count(*)::int                              AS count,
           round(avg(md.score)::numeric, 4)::float8   AS "avgScore",
           max(m.created_at)                          AS "lastUsedAt"
    FROM message_documents md
    JOIN messages m ON m.id = md.message_id
    WHERE m.created_at BETWEEN :from AND :to
    GROUP BY md.name, md.type
    ORDER BY count(*) DESC, "avgScore" DESC NULLS LAST
    LIMIT :limit
    `,
    { type: QueryTypes.SELECT, replacements: { from, to, limit: clampLimit(limit, 50) } }
  )
}

/**
 * Assistant messages by `language` (NULL folded to `'unknown'`).
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ language: string, count: number }>>}
 */
async function languageSplit ({ from, to }) {
  return sequelize.query(
    `
    SELECT COALESCE(NULLIF(m.language, ''), 'unknown') AS language, count(*)::int AS count
    FROM messages m
    WHERE m.role = 'assistant' AND m.created_at BETWEEN :from AND :to
    GROUP BY 1
    ORDER BY count DESC, language
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )
}

/**
 * Assistant messages by `error_code` (NULL folded to `'ok'`).
 *
 * @param {{ from: string | Date, to: string | Date }} window
 * @returns {Promise<Array<{ code: string, count: number }>>}
 */
async function errorBreakdown ({ from, to }) {
  return sequelize.query(
    `
    SELECT COALESCE(NULLIF(m.error_code, ''), 'ok') AS code, count(*)::int AS count
    FROM messages m
    WHERE m.role = 'assistant' AND m.created_at BETWEEN :from AND :to
    GROUP BY 1
    ORDER BY count DESC, code
    `,
    { type: QueryTypes.SELECT, replacements: { from, to } }
  )
}

/**
 * The list of what the document base is missing: `no_match` events, newest
 * first. The question and language come from `payload`; the page comes from the
 * owning conversation (LEFT JOIN — `conversation_id` is a nullable FK).
 *
 * @param {{ from: string | Date, to: string | Date, limit?: number, offset?: number, page?: 'chat' | 'archiviste' | null }} opts
 * @returns {Promise<{ items: Array<{ id: string, question: string | null, language: string | null, page: string | null, createdAt: string }>, total: number }>}
 */
async function unmatchedQuestions ({ from, to, limit = 100, offset = 0, page = null }) {
  const replacements = { from, to, limit: clampLimit(limit, 500), offset: Math.max(0, offset | 0), page }

  const items = await sequelize.query(
    `
    SELECT e.id::text                 AS id,
           e.payload->>'question'     AS question,
           e.payload->>'language'     AS language,
           c.page::text               AS page,
           e.created_at               AS "createdAt"
    FROM events e
    LEFT JOIN conversations c ON c.id = e.conversation_id
    WHERE e.type = 'no_match'
      AND e.created_at BETWEEN :from AND :to
      AND (:page::text IS NULL OR c.page::text = :page::text)
    ORDER BY e.created_at DESC
    LIMIT :limit OFFSET :offset
    `,
    { type: QueryTypes.SELECT, replacements }
  )

  const total = one(
    await sequelize.query(
      `
      SELECT count(*)::int AS total
      FROM events e
      LEFT JOIN conversations c ON c.id = e.conversation_id
      WHERE e.type = 'no_match'
        AND e.created_at BETWEEN :from AND :to
        AND (:page::text IS NULL OR c.page::text = :page::text)
      `,
      { type: QueryTypes.SELECT, replacements }
    )
  ).total

  return { items, total }
}

/**
 * A page of the admin-wide conversation list, newest `updated_at` first.
 * Filtered by creation date and (optionally) page. Each row carries its message
 * count and whether any assistant answer in it was rated −1.
 *
 * @param {{ from: string | Date, to: string | Date, limit?: number, offset?: number, page?: 'chat' | 'archiviste' | null }} opts
 * @returns {Promise<{ items: Array<Object>, total: number }>}
 */
async function conversationList ({ from, to, limit = 25, offset = 0, page = null }) {
  const replacements = { from, to, limit: clampLimit(limit, 200), offset: Math.max(0, offset | 0), page }

  const items = await sequelize.query(
    `
    SELECT c.id,
           c.page::text        AS page,
           c.title,
           c.created_at        AS "createdAt",
           c.updated_at        AS "updatedAt",
           (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::int AS "messageCount",
           EXISTS (
             SELECT 1 FROM messages m
             JOIN message_feedback mf ON mf.message_id = m.id
             WHERE m.conversation_id = c.id AND m.role = 'assistant' AND mf.rating = -1
           ) AS "hasNegativeFeedback"
    FROM conversations c
    WHERE c.created_at BETWEEN :from AND :to
      AND (:page::text IS NULL OR c.page::text = :page::text)
    ORDER BY c.updated_at DESC
    LIMIT :limit OFFSET :offset
    `,
    { type: QueryTypes.SELECT, replacements }
  )

  const total = one(
    await sequelize.query(
      `
      SELECT count(*)::int AS total
      FROM conversations c
      WHERE c.created_at BETWEEN :from AND :to
        AND (:page::text IS NULL OR c.page::text = :page::text)
      `,
      { type: QueryTypes.SELECT, replacements }
    )
  ).total

  return { items, total }
}

/**
 * @param {number} value
 * @param {number} max
 * @returns {number} a positive integer ≤ max (default 1 on garbage)
 */
function clampLimit (value, max) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, max)
}

module.exports = {
  resolveWindow,
  totals,
  dailyVisitors,
  dailyVolume,
  dailyFeedback,
  scoreHistogram,
  topDocuments,
  languageSplit,
  errorBreakdown,
  unmatchedQuestions,
  conversationList
}

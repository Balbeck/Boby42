'use strict'

const { QueryTypes } = require('sequelize')
const { sequelize } = require('../models')

/**
 * Read-only raw-row inspector for the /lab db-viz tab. This is NOT the ORM path:
 * it runs `SELECT *` through `sequelize.query` so the grid shows columns exactly
 * as they sit on disk (snake_case FKs, `events.payload` JSONB, declaration
 * order). No aggregation, no shaping — that is the separate analytics task.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * The two /lab-data routes ship UNGATED for now (a later task adds
 * `fastify.verifyLab`). Until then this whitelist is the ONLY thing between the
 * routes and the database, so it is load-bearing, not defence-in-depth:
 *
 *   ALLOWED = every registered Sequelize model's table  MINUS  `users`
 *
 * `users` holds the /lab login principal — the bcrypt `password_hash` and the
 * live `session_token` — and must never be reachable here. Any table a future
 * model adds shows up automatically; nothing schema-qualified or outside this
 * set is ever accepted. The validated name is the only identifier interpolated
 * into `FROM "<name>"`, and it is always double-quoted.
 */

const EXCLUDED = new Set(['users']) // bcrypt hash + live session token — never expose

const MODEL_BY_TABLE = new Map(
  Object.values(sequelize.models).map((model) => {
    const table = model.getTableName()
    return [typeof table === 'string' ? table : table.tableName, model]
  })
)

const ALLOWED = new Set(
  [...MODEL_BY_TABLE.keys()].filter((name) => !EXCLUDED.has(name))
)

const DEFAULT_LIMIT = 1000
const MIN_LIMIT = 1
const MAX_LIMIT = 10000

// data_type strings that should render right-aligned with tabular figures.
const NUMERIC_TYPE_RE = /int|numeric|real|double|decimal|float|serial|money/i

/**
 * The public-schema columns of one table, in declaration order.
 *
 * @param {string} name - a table name already checked against ALLOWED
 * @returns {Promise<import('../types/types').LabColumn[]>}
 */
async function columnsOf (name) {
  const rows = await sequelize.query(
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :name
      ORDER BY ordinal_position`,
    { type: QueryTypes.SELECT, replacements: { name } }
  )
  return rows.map((row) => ({
    name: row.column_name,
    // USER-DEFINED covers the pg enums (conversations.page, messages.role) —
    // the udt_name (e.g. enum_conversations_page) is more honest than the label.
    type: row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type,
    nullable: row.is_nullable === 'YES',
    numeric: NUMERIC_TYPE_RE.test(row.data_type)
  }))
}

/**
 * True row count of one table (not the capped slice).
 *
 * @param {string} name - a table name already checked against ALLOWED
 * @returns {Promise<number>}
 */
async function countOf (name) {
  const [{ count }] = await sequelize.query(
    `SELECT count(*)::int AS count FROM "${name}"`,
    { type: QueryTypes.SELECT }
  )
  return count
}

/**
 * Order rows by recency: `created_at` when the table has it, otherwise the
 * model's primary-key column. Both come from trusted sources (information_schema
 * / the registered model), both get double-quoted at the call site.
 *
 * @param {string} name
 * @param {import('../types/types').LabColumn[]} columns
 * @returns {string}
 */
function recencyKey (name, columns) {
  if (columns.some((column) => column.name === 'created_at')) return 'created_at'
  const model = MODEL_BY_TABLE.get(name)
  const pkAttr = model && model.primaryKeyAttributes && model.primaryKeyAttributes[0]
  const pkColumn = pkAttr && ((model.rawAttributes[pkAttr] && model.rawAttributes[pkAttr].field) || pkAttr)
  return pkColumn || (columns[0] && columns[0].name) || 'id'
}

/**
 * Every inspectable table with its schema and current row count. Feeds the
 * db-viz selector so the header can show the real schema even for an empty
 * table.
 *
 * @returns {Promise<import('../types/types').LabTableInfo[]>}
 */
async function listTables () {
  const names = [...ALLOWED].sort()
  const out = []
  for (const name of names) {
    out.push({
      name,
      columns: await columnsOf(name),
      rowCount: await countOf(name)
    })
  }
  return out
}

/**
 * One table's whole contents, newest first, capped at `limit`.
 *
 * @param {string} name
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<import('../types/types').LabTableData | null>} null when
 *   `name` is not whitelisted (the route turns that into a 404).
 */
async function readTable (name, { limit = DEFAULT_LIMIT } = {}) {
  if (!ALLOWED.has(name)) return null

  const capped = clamp(Math.trunc(Number(limit)) || DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT)
  const columns = await columnsOf(name)
  const key = recencyKey(name, columns)

  const rows = await sequelize.query(
    `SELECT * FROM "${name}" ORDER BY "${key}" DESC LIMIT :limit`,
    { type: QueryTypes.SELECT, replacements: { limit: capped } }
  )
  const rowCount = await countOf(name)

  return { name, columns, rows, rowCount, truncated: rowCount > rows.length }
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

module.exports = { listTables, readTable, ALLOWED }

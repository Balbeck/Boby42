'use strict'

// The database side of the harness.
//
// There is no second container and no second Postgres: this creates ONE extra
// database, `boby42_test`, inside the `boby42-postgres` container the project
// already runs, applies the same umzug migrations the backend applies at boot,
// and TRUNCATEs between tests. `make down` / `make localMac` are untouched.
//
// When Postgres is not reachable (containers down, fresh clone with no
// .env.lab), `available()` returns false with a reason instead of throwing, and
// every DB-backed suite skips itself — `npm test` still runs the pure suites.

const { Client } = require('pg')
const { sequelize } = require('../models')
const { createUmzug } = require('../db/umzug')
const { seedLabUser } = require('../db/seed')

const TEST_DB = process.env.POSTGRES_DB

// Hard stop: reset() TRUNCATEs every table, so the target must be a test
// database. test/env.js pins it, this is the second lock.
if (!/_test$/.test(String(TEST_DB))) {
  throw new Error(`refusing to run tests against database "${TEST_DB}" — the name must end in _test`)
}

// The tables reset() empties, children first (CASCADE covers the rest anyway).
const TABLES = [
  'message_feedback', 'message_documents', 'events', 'messages',
  'conversations', 'visitors', 'users'
]

/** @type {Promise<{ ok: true } | { ok: false, reason: string }> | null} */
let preparing = null

/** @returns {{ host: string, port: number, user: string, password: string }} */
function connection () {
  return {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD || ''
  }
}

/**
 * Connects to the maintenance database, creates `boby42_test` if missing, then
 * runs the migrations through the app's own umzug instance. Memoised per test
 * process (node --test gives each file its own process).
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function prepare () {
  const admin = new Client({ ...connection(), database: 'postgres', connectionTimeoutMillis: 3000 })
  try {
    await admin.connect()
  } catch (err) {
    return {
      ok: false,
      reason: `postgres unreachable at ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT} (${err.message}) — run \`make localMac\``
    }
  }

  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB])
    if (!rowCount) await admin.query(`CREATE DATABASE "${TEST_DB}"`)
  } catch (err) {
    return { ok: false, reason: `could not create database ${TEST_DB}: ${err.message}` }
  } finally {
    await admin.end()
  }

  try {
    await sequelize.authenticate()
    await createUmzug().up()
  } catch (err) {
    return { ok: false, reason: `migrating ${TEST_DB} failed: ${err.message}` }
  }

  return { ok: true }
}

/**
 * True when the DB-backed suites can run. Never throws — the reason is kept for
 * the skip message.
 *
 * @returns {Promise<boolean>}
 */
async function available () {
  if (!preparing) preparing = prepare()
  return (await preparing).ok
}

/** @returns {Promise<string>} why the DB suites are skipping */
async function skipReason () {
  if (!preparing) preparing = prepare()
  const result = await preparing
  return result.ok ? '' : result.reason
}

/**
 * Empties every table and restores the single /lab user, so each test starts
 * from the same known state. `users` is emptied too (labAuth tests mutate
 * `session_token`) and re-seeded from LAB_LOGIN / LAB_PASSWORD.
 *
 * @returns {Promise<void>}
 */
async function reset () {
  await sequelize.query(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
  )
  await seedLabUser()
}

/**
 * Closes the pool. Call once per test file, from the LAST `after` hook — the
 * Sequelize instance is a module singleton, so a closed pool cannot be reused
 * inside the same process.
 *
 * @returns {Promise<void>}
 */
async function close () {
  if (!preparing || !(await preparing).ok) return
  // The app's own onClose hook may already have closed the pool — closing an
  // already-closed Sequelize instance is not worth failing a whole file over.
  try {
    await sequelize.close()
  } catch { /* already closed */ }
}

module.exports = { available, skipReason, reset, close, TABLES, TEST_DB }

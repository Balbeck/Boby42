'use strict'

// Unit suite for plugins/sequelize.js — the boot sequence, with no Postgres.
//
// This plugin is why every route suite built on the real app skips when the
// containers are down: it authenticates, migrates and seeds before the app is
// ready. Here all three are replaced, so what runs is the ORDER and the
// DECORATIONS — plus the retry loop, which is the one piece of this file that
// has ever mattered in production (a momentarily-unready Postgres must not take
// the backend down, and the per-attempt log line is the first thing to check
// when prod login breaks).
//
// ⚠️ `createUmzug` and `seedLabUser` are DESTRUCTURED by the plugin at require
// time, so they are replaced on their own module objects BEFORE the plugin is
// required. That require order is the whole trick; do not reorder these lines.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const Fastify = require('fastify')
const { patch, spy, restoreAll } = require('../../sequelizeStub')
const { sequelize } = require('../../../models')

// --- replaced before the plugin is loaded ------------------------------------
const umzugModule = require('../../../db/umzug')
const seedModule = require('../../../db/seed')

let migrationsApplied = []
let seedCalls = []

umzugModule.createUmzug = () => ({ up: async () => migrationsApplied })
seedModule.seedLabUser = async (hooks) => { seedCalls.push(hooks) }

const sequelizePlugin = require('../../../plugins/sequelize')
// -----------------------------------------------------------------------------

afterEach(() => {
  restoreAll()
  migrationsApplied = []
  seedCalls = []
})
after(() => restoreAll())

// The retry sleeps 2 s between attempts and the count is hardcoded at 5, so a
// full failure is 8 real seconds. `instant` collapses ONLY that sleep: it
// matches on the exact 2000 ms delay and only while a build is in flight, and
// delegates everything else to the real timer. A blanket replacement was tried
// first and broke unrelated library code that does
// `const timer = setTimeout(() => …timer…)` — running the callback
// synchronously trips the TDZ on `timer`.
const REAL_SET_TIMEOUT = globalThis.setTimeout
const RETRY_DELAY_MS = 2000
let collapseRetryDelay = false

/**
 * Builds a bare app with the plugin, capturing its log lines.
 *
 * @param {{ authenticate?: Function, instant?: boolean }} [opts]
 * @returns {Promise<{ app: import('fastify').FastifyInstance, logs: string[] }>}
 */
async function buildDbApp ({ authenticate = async () => undefined, instant = false } = {}) {
  patch(sequelize, 'authenticate', authenticate)
  patch(sequelize, 'close', async () => undefined)

  if (instant) {
    patch(globalThis, 'setTimeout', function (fn, ms, ...rest) {
      if (collapseRetryDelay && ms === RETRY_DELAY_MS) {
        const timer = REAL_SET_TIMEOUT(() => {}, 0)
        fn()
        return timer
      }
      return REAL_SET_TIMEOUT(fn, ms, ...rest)
    })
  }

  const logs = []
  const app = Fastify()
  app.log.info = (...args) => logs.push(String(args[args.length - 1]))
  app.log.warn = (...args) => logs.push(String(args[args.length - 1]))

  collapseRetryDelay = instant
  try {
    await app.register(sequelizePlugin)
    await app.ready()
  } finally {
    collapseRetryDelay = false
  }
  return { app, logs }
}

describe('boot', () => {
  it('connects, migrates, seeds, then decorates', async () => {
    const { app, logs } = await buildDbApp()

    assert.ok(logs.some((line) => line.includes('[db] connected')))
    assert.strictEqual(seedCalls.length, 1)
    assert.strictEqual(typeof app.sequelize, 'object')
    await app.close()
  })

  it('logs the host, port and database it actually reached', async () => {
    // The line that tells you a prod backend is talking to the wrong database.
    const { app, logs } = await buildDbApp()

    const line = logs.find((entry) => entry.includes('[db] connected'))
    assert.ok(line.includes(sequelize.config.database), line)
    assert.ok(line.includes(String(sequelize.config.port)), line)
    await app.close()
  })

  it('decorates every model the routes ask for', async () => {
    const { app } = await buildDbApp()

    assert.deepStrictEqual(Object.keys(app.models).sort(), [
      'Conversation', 'Event', 'Message', 'MessageDocument', 'MessageFeedback', 'User', 'Visitor'
    ])
    assert.strictEqual(app.sequelize, sequelize)
    await app.close()
  })

  it('stays quiet about migrations when there are none pending', async () => {
    const { app, logs } = await buildDbApp()

    assert.ok(!logs.some((line) => line.includes('DB migrations applied')))
    await app.close()
  })

  it('names the migrations it applied', async () => {
    migrationsApplied = [{ name: '20260828235529-create-users.js' }, { name: '20260829011006-create-interaction-logging.js' }]
    const { app, logs } = await buildDbApp()

    const line = logs.find((entry) => entry.includes('DB migrations applied'))
    assert.ok(line.includes('20260828235529-create-users.js'), line)
    assert.ok(line.includes('20260829011006-create-interaction-logging.js'), line)
    await app.close()
  })

  it('hands the seeder its own log/warn hooks rather than console', async () => {
    const { app, logs } = await buildDbApp()

    const [hooks] = seedCalls
    hooks.log('[seed] hello')
    hooks.warn('[seed] careful')

    assert.ok(logs.includes('[seed] hello'))
    assert.ok(logs.includes('[seed] careful'))
    await app.close()
  })

  it('closes the pool on shutdown', async () => {
    const close = spy(async () => undefined)
    patch(sequelize, 'authenticate', async () => undefined)
    patch(sequelize, 'close', close)

    const app = Fastify()
    await app.register(sequelizePlugin)
    await app.ready()
    await app.close()

    assert.strictEqual(close.callCount, 1)
  })
})

describe('the connection retry', () => {
  it('retries and succeeds, warning once per failed attempt', async () => {
    // `depends_on: service_healthy` already gates start order; this keeps a
    // Postgres that is up but not yet accepting connections from taking the
    // whole backend down.
    let attempts = 0
    const { app, logs } = await buildDbApp({
      instant: true,
      authenticate: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('ECONNREFUSED')
      }
    })

    assert.strictEqual(attempts, 3)
    const warnings = logs.filter((line) => line.includes('[db] not reachable'))
    assert.strictEqual(warnings.length, 2)
    assert.ok(warnings[0].includes('attempt 1/5'), warnings[0])
    assert.ok(warnings[1].includes('attempt 2/5'), warnings[1])
    assert.ok(logs.some((line) => line.includes('[db] connected')))
    await app.close()
  })

  it('gives up after five attempts and fails the boot', async () => {
    // Failing to start is correct here: a backend that boots with no database
    // would answer 500 on every logged route and look healthy to the tunnel.
    let attempts = 0
    await assert.rejects(
      () => buildDbApp({
        instant: true,
        authenticate: async () => { attempts += 1; throw new Error('ECONNREFUSED') }
      }),
      /ECONNREFUSED/
    )

    assert.strictEqual(attempts, 5)
  })
})

'use strict'

// Shared test scaffolding.
//
// Loading order matters: `test/env.js` is pulled in by `--require` (see the npm
// scripts) BEFORE anything here, so the Sequelize singleton in `../models` is
// already built against boby42_test by the time test/db.js requires it.

const { build: buildApplication } = require('fastify-cli/helper')
const path = require('node:path')
const test = require('node:test')

const db = require('./db')
const ollamaStub = require('./ollamaStub')

const AppPath = path.join(__dirname, '..', 'app.js')

/** Config the fastify-cli helper needs — fastify-plugin exposes the decorators. */
function config () {
  return { skipOverride: true }
}

/** @type {Promise<import('fastify').FastifyInstance> | null} */
let appPromise = null

/**
 * The app (autoloaded plugins + routes) built against boby42_test, ONE instance
 * per test file.
 *
 * Why memoised rather than per-test: `plugins/sequelize.js` registers an
 * onClose hook that closes the shared Sequelize pool, and that module singleton
 * cannot be reopened inside the same process — a second build would run every
 * query against a closed pool. node --test gives each file its own process, so
 * one app per file costs nothing.
 *
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
function getApp () {
  if (!appPromise) appPromise = buildApplication([AppPath], config())
  return appPromise
}

// Registered once per test process (every DB suite requires this module).
test.after(async () => {
  if (appPromise) await (await appPromise).close()
  await db.close()
  ollamaStub.restoreFetch()
})

/**
 * A test that needs Postgres. When the database is unreachable the test is
 * SKIPPED with the reason instead of failing, so `npm test` stays green on a
 * machine with no containers up and the pure suites still run and still count.
 *
 * Every such test starts from an empty database with the /lab user re-seeded.
 *
 * @param {string} name
 * @param {(t: import('node:test').TestContext) => any} fn
 */
function itDb (name, fn) {
  test.it(name, async (t) => {
    if (!(await db.available())) {
      t.skip(await db.skipReason())
      return
    }
    await db.reset()
    return fn(t)
  })
}

/**
 * Signs in as the seeded /lab user and returns the `lab_token` cookie value —
 * every /lab-data/* and /analytics/* request needs one.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<string>}
 */
async function labCookie (app) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/lab/login',
    payload: { login: process.env.LAB_LOGIN, password: process.env.LAB_PASSWORD }
  })
  if (res.statusCode !== 200) {
    throw new Error(`[helper] /auth/lab/login returned ${res.statusCode}: ${res.payload}`)
  }
  return res.cookies.find((cookie) => cookie.name === 'lab_token').value
}

module.exports = {
  config,
  getApp,
  itDb,
  labCookie,
  db,
  ...ollamaStub
}

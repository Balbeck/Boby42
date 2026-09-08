'use strict'

// The unit-test side of the harness: everything needed to exercise a service or
// a route with NO database at all.
//
// Why this exists next to test/db.js rather than replacing it: the two answer
// different questions. test/db.js runs the real schema and proves the SQL is
// valid Postgres — but it skips whenever the containers are down, which is most
// of the time on a dev box, and it makes those suites integration tests. This
// module swaps `sequelize.query` / `sequelize.transaction` / the model statics
// for recorders, so every branch of every service is reachable offline and
// `npm run test:coverage` is a real number instead of a number-when-Docker-is-up.
//
// What a stubbed query CAN'T prove is that the SQL text is correct — so the unit
// suites assert on the *shape* of the call (which table, which replacements,
// which clauses are present) and leave "does Postgres accept this" to the
// existing DB suites. Both layers are needed; neither replaces the other.
//
// Every stub returns a `{ restore }` handle. Use `restoreAll()` in an `after`
// hook rather than restoring by hand — an un-restored stub leaks into the next
// test in the same file (node --test gives each FILE its own process, not each
// test).

const { sequelize } = require('../models')

/** @type {Array<() => void>} every stub installed since the last restoreAll() */
const installed = []

/**
 * Replaces one property, remembering whether the target actually owned it.
 * Model statics and `sequelize.query` are inherited from a prototype, so a naive
 * `target[name] = original` on restore would leave a shadowing own property
 * behind — harmless in practice, but it makes `Object.hasOwn` lie and that is
 * exactly the kind of thing a test harness must not do.
 *
 * @param {Object} target
 * @param {string} name
 * @param {*} impl
 * @returns {{ restore: () => void }}
 */
function patch (target, name, impl) {
  const owned = Object.prototype.hasOwnProperty.call(target, name)
  const original = target[name]
  target[name] = impl

  const handle = {
    restore () {
      if (owned) target[name] = original
      else delete target[name]
    }
  }
  installed.push(handle.restore)
  return handle
}

/**
 * A recording function. `fn.calls` is the list of argument arrays, in order;
 * `fn.callCount` the number of invocations.
 *
 * @param {Function} [impl] - what to return / do (default: undefined)
 * @returns {Function & { calls: any[][], callCount: number }}
 */
function spy (impl = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args)
    fn.callCount = fn.calls.length
    return impl(...args)
  }
  fn.calls = []
  fn.callCount = 0
  return fn
}

/**
 * Swaps `sequelize.query` for a recorder.
 *
 * `respond` is either:
 *   - an array — one entry consumed per call, in order, `[]` once exhausted.
 *     This is the common case: a service that runs three queries gets three
 *     fixtures, and the ORDER of the array documents the order of the queries.
 *   - a function `(call, index) => rows` — for the few places where the answer
 *     depends on the SQL (labData.listTables loops over N tables).
 *
 * @param {Array<*> | ((call: { sql: string, options: Object, replacements: Object }, index: number) => *)} [respond]
 * @returns {{ calls: Array<{ sql: string, options: Object, replacements: Object }>, restore: () => void }}
 */
function stubQuery (respond = []) {
  const calls = []
  const queue = Array.isArray(respond) ? [...respond] : null

  const handle = patch(sequelize, 'query', async (sql, options = {}) => {
    const call = { sql: String(sql), options, replacements: (options && options.replacements) || {} }
    calls.push(call)

    if (queue) return queue.length ? queue.shift() : []
    const rows = await respond(call, calls.length - 1)
    return rows === undefined ? [] : rows
  })

  return { calls, restore: handle.restore }
}

/**
 * Swaps `sequelize.transaction` for a pass-through that hands the callback a
 * sentinel object. Services thread that object into every model call as
 * `{ transaction }`, so asserting `opts.transaction === tx` is how a unit test
 * proves the whole exchange really is written inside ONE transaction — the thing
 * `recordExchange` exists to guarantee.
 *
 * The sentinel is a plain object, not a Symbol, because Sequelize options are
 * spread and a Symbol would not survive `{ ...opts }` in some call paths.
 *
 * @returns {{ tx: Object, calls: any[][], restore: () => void }}
 */
function stubTransaction () {
  const tx = { __testTransaction: true }
  const calls = []

  const handle = patch(sequelize, 'transaction', async (fn) => {
    calls.push([fn])
    return fn(tx)
  })

  return { tx, calls, restore: handle.restore }
}

/**
 * Swaps a set of statics on a Sequelize model (or any object).
 *
 *   stubModel(Visitor, { upsert: spy(async () => [null, true]) })
 *
 * @param {Object} target
 * @param {Record<string, Function>} methods
 * @returns {{ restore: () => void }}
 */
function stubModel (target, methods) {
  const handles = Object.entries(methods).map(([name, impl]) => patch(target, name, impl))
  return { restore () { for (const handle of handles) handle.restore() } }
}

/** Undoes every stub installed since the last call. Use it in an `after` hook. */
function restoreAll () {
  while (installed.length) installed.pop()()
}

module.exports = { patch, spy, stubQuery, stubTransaction, stubModel, restoreAll }

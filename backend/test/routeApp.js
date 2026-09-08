'use strict'

// Builds a Fastify instance carrying ONE route file and nothing else — the unit
// harness for the transport layer.
//
// Why not `helper.js`'s `getApp()`: that one builds the whole app through
// fastify-cli, which autoloads `plugins/sequelize.js`, which authenticates
// against Postgres and applies migrations. Every route suite built on it
// therefore skips when the containers are down — which is why `routes/` did not
// appear in the coverage report at all before this. Here the route is registered
// on a bare instance with its services stubbed, so what runs is exactly the
// transport layer: schema validation, status codes, the shape of the response,
// and the preHandler gate.
//
// `plugins/sensible.js` is registered for real because the routes depend on what
// it provides (`reply.notFound`, `fastify.httpErrors`) — stubbing it would test
// a different application.

const Fastify = require('fastify')

const sensible = require('../plugins/sensible')

/**
 * @param {Function} route - a route plugin, i.e. `require('../../routes/x')`
 * @param {{
 *   prefix?: string,
 *   decorate?: Record<string, *>,
 *   plugins?: Function[],
 *   logger?: boolean
 * }} [opts] - `decorate` lands BEFORE the route is registered, which matters:
 *   a route reads `fastify.verifyLab` at registration time, not per request.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildRouteApp (route, { prefix = '', decorate = {}, plugins = [], logger = false } = {}) {
  const app = Fastify({ logger })

  await app.register(sensible)
  for (const plugin of plugins) await app.register(plugin)
  for (const [name, value] of Object.entries(decorate)) app.decorate(name, value)

  await app.register(route, { prefix })
  await app.ready()
  return app
}

/** A `verifyLab` that always lets the request through, with a fake session. */
function allowLab (labUser = { id: 1, login: 'test-lab-login' }) {
  return async function verifyLab (request) {
    request.labUser = labUser
  }
}

/** A `verifyLab` that rejects like the real one does when there is no session. */
function denyLab (app) {
  return async function verifyLab () {
    throw app.httpErrors.unauthorized('Invalid session')
  }
}

/**
 * Replaces one exported function of an already-required service module with a
 * controllable stub, and returns the handle to steer it per test.
 *
 * **Call this before requiring the route under test.** Several route files
 * destructure their service at require time (`const { readTable } =
 * require(...)`), so a replacement installed later would never be seen. Test
 * files therefore do their stubbing at module scope, top-down, and require the
 * route last — the require order in those files is load-bearing, not style.
 *
 * @param {Object} target - the service module object
 * @param {string} name - the exported function to replace
 * @param {Function} [initial] - the default implementation
 * @returns {{ calls: any[][], callCount: number, set: (impl: Function) => void, reset: () => void }}
 */
function serviceStub (target, name, initial = async () => undefined) {
  let impl = initial

  const handle = {
    calls: [],
    get callCount () { return handle.calls.length },
    /** @param {Function} next */
    set (next) { impl = next },
    reset () {
      impl = initial
      handle.calls = []
    }
  }

  target[name] = (...args) => {
    handle.calls.push(args)
    return impl(...args)
  }

  return handle
}

/** Resets a batch of stubs — for an `afterEach`. @param {...Object} stubs */
function resetStubs (...stubs) {
  for (const stub of stubs) stub.reset()
}

module.exports = { buildRouteApp, allowLab, denyLab, serviceStub, resetStubs }

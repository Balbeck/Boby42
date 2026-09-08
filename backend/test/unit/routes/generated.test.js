'use strict'

// The two routes the Fastify scaffold generated. They are still autoloaded and
// still answer in production, so they belong in the coverage denominator like
// anything else the app serves — and `GET /` doubles as the liveness check
// anyone hitting the backend directly will try first.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp } = require('../../routeApp')

describe('GET /', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  before(async () => { app = await buildRouteApp(require('../../../routes/root')) })
  after(async () => app.close())

  it('answers the scaffold payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { root: true })
  })
})

describe('GET /example', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  before(async () => {
    // The folder name is what gives this route its prefix under autoload.
    app = await buildRouteApp(require('../../../routes/example/index'), { prefix: '/example' })
  })
  after(async () => app.close())

  it('answers its plain-text string', async () => {
    const res = await app.inject({ method: 'GET', url: '/example' })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload, 'this is an example')
  })
})

'use strict'

// OLLAMA_PROXY_KEY is read at MODULE LOAD in routes/ollama.js, so the "feature
// off" state cannot be produced by deleting the variable mid-run the way the
// /lab gate can. It needs its own file: node --test gives each test file its own
// process, and the variable is removed here before the app is ever built.
delete process.env.OLLAMA_PROXY_KEY

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, stubOllama } = require('../helper')

describe('ALL /ollama/* with OLLAMA_PROXY_KEY unset', () => {
  itDb('404s even when a key is presented — the feature is off', async () => {
    stubOllama({ '/api': () => assert.fail('upstream must not be reached') })
    const app = await getApp()

    for (const headers of [{}, { 'x-ollama-key': 'anything' }, { 'x-ollama-key': '' }]) {
      const res = await app.inject({ method: 'GET', url: '/ollama/api/tags', headers })
      assert.strictEqual(res.statusCode, 404)
    }
  })

  itDb('404s the key handout route too', async () => {
    // GET /auth/lab/ollama-key reads the variable live, so it also goes dark.
    const app = await getApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/lab/login',
      payload: { login: process.env.LAB_LOGIN, password: process.env.LAB_PASSWORD }
    })
    const token = login.cookies.find((cookie) => cookie.name === 'lab_token').value

    const res = await app.inject({ method: 'GET', url: '/auth/lab/ollama-key', cookies: { lab_token: token } })
    assert.strictEqual(res.statusCode, 404)
  })
})

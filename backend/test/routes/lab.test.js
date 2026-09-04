'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb, labCookie } = require('../helper')
const { seedAnalytics, WINDOW } = require('../fixtures/seedAnalytics')
const { User } = require('../../models')

const LOGIN = process.env.LAB_LOGIN
const PASSWORD = process.env.LAB_PASSWORD

// Every route behind the gate, so the three states can be swept in one place.
const GATED = [
  '/auth/lab/me',
  '/auth/lab/ollama-key',
  '/lab-data/tables',
  '/lab-data/tables/messages',
  '/lab-data/tree/66666666-6666-4666-8666-666666666666',
  '/analytics/overview',
  '/analytics/unmatched',
  '/analytics/conversations'
]

const get = async (url, token) => (await getApp()).inject({
  method: 'GET', url, cookies: token ? { lab_token: token } : undefined
})

const login = async (payload) => (await getApp()).inject({ method: 'POST', url: '/auth/lab/login', payload })

/** Runs `fn` with LAB_JWT_SECRET unset, then restores it. */
async function withGateOff (fn) {
  const secret = process.env.LAB_JWT_SECRET
  delete process.env.LAB_JWT_SECRET
  try {
    await fn()
  } finally {
    process.env.LAB_JWT_SECRET = secret
  }
}

describe('the /lab gate', () => {
  itDb('404s every gated route when LAB_JWT_SECRET is unset', async () => {
    // 404, not 401: an unconfigured deployment must not confirm the feature
    // exists. isConfigured() reads process.env live, so no restart is involved.
    const token = await labCookie(await getApp())
    await withGateOff(async () => {
      for (const url of [...GATED, '/auth/lab/logout']) {
        const res = url.endsWith('logout')
          ? await (await getApp()).inject({ method: 'POST', url, cookies: { lab_token: token } })
          : await get(url, token)
        assert.strictEqual(res.statusCode, 404, `${url} answered ${res.statusCode}`)
      }
      assert.strictEqual((await login({ login: LOGIN, password: PASSWORD })).statusCode, 404)
    })
  })

  itDb('404s every gated route when no /lab user is seeded', async () => {
    const token = await labCookie(await getApp())
    await User.destroy({ where: {} })

    for (const url of GATED) {
      assert.strictEqual((await get(url, token)).statusCode, 404, url)
    }
    assert.strictEqual((await login({ login: LOGIN, password: PASSWORD })).statusCode, 404)
  })

  itDb('401s every gated route without a cookie', async () => {
    for (const url of GATED) {
      assert.strictEqual((await get(url)).statusCode, 401, url)
    }
  })

  itDb('401s on a cookie that is not the stored session token', async () => {
    await labCookie(await getApp())
    for (const url of GATED) {
      assert.strictEqual((await get(url, 'not.a.valid.jwt')).statusCode, 401, url)
    }
  })
})

describe('POST /auth/lab/login', () => {
  itDb('sets an httpOnly lab_token cookie on the right credentials', async () => {
    const res = await login({ login: LOGIN, password: PASSWORD })

    assert.strictEqual(res.statusCode, 200)
    assert.deepStrictEqual(res.json(), { login: LOGIN })

    const cookie = res.cookies.find((entry) => entry.name === 'lab_token')
    assert.ok(cookie.httpOnly)
    assert.strictEqual(cookie.sameSite, 'Lax')
    assert.strictEqual(cookie.path, '/')
    // Reached server-side over plain HTTP in this deployment (Vite proxy /
    // loopback), so Secure is off — it still rides the HTTPS tunnel.
    assert.ok(!cookie.secure)
  })

  itDb('401s on a wrong password and on an unknown login', async () => {
    assert.strictEqual((await login({ login: LOGIN, password: 'wrong' })).statusCode, 401)
    assert.strictEqual((await login({ login: 'nobody', password: PASSWORD })).statusCode, 401)
  })

  itDb('400s on a malformed body', async () => {
    assert.strictEqual((await login({ login: LOGIN })).statusCode, 400)
    assert.strictEqual((await login({ login: '', password: '' })).statusCode, 400)
  })
})

describe('GET /auth/lab/me and POST /auth/lab/logout', () => {
  itDb('me returns the login of the signed-in session', async () => {
    const token = await labCookie(await getApp())
    assert.deepStrictEqual((await get('/auth/lab/me', token)).json(), { login: LOGIN })
  })

  itDb('logout clears the cookie and invalidates the token at once', async () => {
    const token = await labCookie(await getApp())
    const res = await (await getApp()).inject({
      method: 'POST', url: '/auth/lab/logout', cookies: { lab_token: token }
    })

    assert.deepStrictEqual(res.json(), { ok: true })
    assert.strictEqual(res.cookies.find((entry) => entry.name === 'lab_token').value, '')
    assert.strictEqual((await User.findOne({ where: { login: LOGIN } })).session_token, null)
    assert.strictEqual((await get('/auth/lab/me', token)).statusCode, 401)
  })
})

describe('GET /auth/lab/ollama-key', () => {
  itDb('hands the proxy key to an authenticated session', async () => {
    const token = await labCookie(await getApp())
    assert.deepStrictEqual((await get('/auth/lab/ollama-key', token)).json(), {
      key: process.env.OLLAMA_PROXY_KEY
    })
  })

  itDb('404s when OLLAMA_PROXY_KEY is unset — the proxy is off, do not confirm it', async () => {
    const token = await labCookie(await getApp())
    const key = process.env.OLLAMA_PROXY_KEY
    delete process.env.OLLAMA_PROXY_KEY
    try {
      assert.strictEqual((await get('/auth/lab/ollama-key', token)).statusCode, 404)
    } finally {
      process.env.OLLAMA_PROXY_KEY = key
    }
  })
})

describe('GET /lab-data/*', () => {
  itDb('lists the inspectable tables and never users', async () => {
    const token = await labCookie(await getApp())
    await seedAnalytics()

    const tables = (await get('/lab-data/tables', token)).json()
    const names = tables.map((table) => table.name)

    assert.ok(names.includes('message_feedback'))
    assert.ok(!names.includes('users'), 'users must never be listed')
    assert.strictEqual(tables.find((table) => table.name === 'messages').rowCount, 6)
  })

  itDb('404s on /lab-data/tables/users even with a valid session', async () => {
    // The whitelist is defence-in-depth behind the gate; users stays out of it
    // whatever happens to the gate.
    const token = await labCookie(await getApp())
    assert.strictEqual((await get('/lab-data/tables/users', token)).statusCode, 404)
    assert.strictEqual((await get('/lab-data/tables/pg_shadow', token)).statusCode, 404)
  })

  itDb('caps rows with ?limit and reports truncated', async () => {
    const token = await labCookie(await getApp())
    await seedAnalytics()

    const body = (await get('/lab-data/tables/messages?limit=2', token)).json()
    assert.strictEqual(body.rows.length, 2)
    assert.strictEqual(body.rowCount, 6)
    assert.strictEqual(body.truncated, true)
  })

  itDb('nests a conversation subtree', async () => {
    const token = await labCookie(await getApp())
    const ids = await seedAnalytics()

    const tree = (await get(`/lab-data/tree/${ids.conversationChat}`, token)).json()
    assert.strictEqual(tree.visitor.anon_id, ids.anonA)
    assert.strictEqual(tree.messages[1].documents.length, 2)
    assert.strictEqual(tree.messages[1].feedback.rating, 1)
  })

  itDb('400s a malformed tree id and 404s an unknown one', async () => {
    const token = await labCookie(await getApp())
    assert.strictEqual((await get('/lab-data/tree/not-a-uuid', token)).statusCode, 400)
    assert.strictEqual(
      (await get('/lab-data/tree/66666666-6666-4666-8666-666666666666', token)).statusCode, 404
    )
  })
})

describe('GET /analytics/*', () => {
  itDb('overview returns the whole dashboard payload in one response', async () => {
    const token = await labCookie(await getApp())
    await seedAnalytics()

    const body = (await get(
      `/analytics/overview?from=${WINDOW.from}&to=${WINDOW.to}`, token
    )).json()

    assert.deepStrictEqual(Object.keys(body).sort(), [
      'daily', 'errors', 'languages', 'scoreHistogram', 'topDocuments', 'totals', 'window'
    ])
    assert.strictEqual(body.totals.range.requests, 3)
    assert.strictEqual(body.totals.allTime.requests, 3)
    assert.deepStrictEqual(Object.keys(body.daily).sort(), ['feedback', 'visitors', 'volume'])
    assert.strictEqual(body.scoreHistogram.length, 15)
    assert.strictEqual(body.topDocuments[0].name, 'Alternance')
  })

  itDb('overview falls back to the 7-day window on unparseable dates', async () => {
    const token = await labCookie(await getApp())
    const body = (await get('/analytics/overview?from=nope&to=nope', token)).json()
    const span = new Date(body.window.to).getTime() - new Date(body.window.from).getTime()
    assert.strictEqual(span, 7 * 864e5)
  })

  itDb('unmatched lists the no_match questions', async () => {
    const token = await labCookie(await getApp())
    await seedAnalytics()

    const body = (await get(`/analytics/unmatched?from=${WINDOW.from}&to=${WINDOW.to}`, token)).json()
    assert.strictEqual(body.total, 1)
    assert.strictEqual(body.items[0].question, 'quantum badge')
    assert.strictEqual(body.items[0].page, 'archiviste')
  })

  itDb('conversations is admin-wide, unlike the visitor-scoped GET /conversations', async () => {
    const token = await labCookie(await getApp())
    const ids = await seedAnalytics()

    const body = (await get('/analytics/conversations', token)).json()
    assert.strictEqual(body.total, 3, 'every visitor’s conversations, not one visitor’s')

    const tree = (await get(`/analytics/conversations/${ids.conversationChat}`, token)).json()
    assert.strictEqual(tree.conversation.id, ids.conversationChat)
    assert.strictEqual(tree.messages.length, 2)
  })

  itDb('rejects out-of-range paging and an unknown page filter', async () => {
    const token = await labCookie(await getApp())
    assert.strictEqual((await get('/analytics/unmatched?limit=501', token)).statusCode, 400)
    assert.strictEqual((await get('/analytics/conversations?limit=201', token)).statusCode, 400)
    assert.strictEqual((await get('/analytics/conversations?page=lab', token)).statusCode, 400)
    assert.strictEqual((await get('/analytics/unmatched?offset=-1', token)).statusCode, 400)
  })

  itDb('400s a malformed conversation id and 404s an unknown one', async () => {
    const token = await labCookie(await getApp())
    assert.strictEqual((await get('/analytics/conversations/nope', token)).statusCode, 400)
    assert.strictEqual(
      (await get('/analytics/conversations/66666666-6666-4666-8666-666666666666', token)).statusCode, 404
    )
  })
})

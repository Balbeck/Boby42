'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const jwt = require('jsonwebtoken')

const { itDb } = require('../helper')
const labAuth = require('../../services/labAuth.service')
const { User } = require('../../models')

const LOGIN = process.env.LAB_LOGIN
const PASSWORD = process.env.LAB_PASSWORD

describe('isConfigured', () => {
  it('is driven by LAB_JWT_SECRET, read live rather than at module load', () => {
    assert.strictEqual(labAuth.isConfigured(), true)

    const secret = process.env.LAB_JWT_SECRET
    delete process.env.LAB_JWT_SECRET
    try {
      // Read at call time is what lets the gate fail closed without a restart.
      assert.strictEqual(labAuth.isConfigured(), false)
    } finally {
      process.env.LAB_JWT_SECRET = secret
    }
  })
})

describe('login', () => {
  itDb('returns a signed token and stores it on the user row', async () => {
    const session = await labAuth.login(LOGIN, PASSWORD)

    assert.strictEqual(session.login, LOGIN)
    const payload = jwt.verify(session.token, process.env.LAB_JWT_SECRET)
    const user = await User.findOne({ where: { login: LOGIN } })
    assert.strictEqual(payload.sub, user.id)
    // Stateful: the signed token is also the row's session_token.
    assert.strictEqual(user.session_token, session.token)
  })

  itDb('returns null on a wrong password and on an unknown login', async () => {
    assert.strictEqual(await labAuth.login(LOGIN, 'wrong'), null)
    assert.strictEqual(await labAuth.login('nobody', PASSWORD), null)
  })

  itDb('never writes a session_token on a failed login', async () => {
    await labAuth.login(LOGIN, 'wrong')
    assert.strictEqual((await User.findOne({ where: { login: LOGIN } })).session_token, null)
  })
})

describe('getSession', () => {
  itDb('accepts the current token', async () => {
    const { token } = await labAuth.login(LOGIN, PASSWORD)
    assert.strictEqual((await labAuth.getSession(token)).login, LOGIN)
  })

  // Single session: only the token currently on the row is accepted, so a later
  // login kills the earlier one. Without this, every token ever issued stays
  // valid for its full 12 h.
  //
  // Asserted through the column rather than by comparing two logins: the JWT
  // payload is just { sub, iat, exp } with second precision, so two logins
  // inside the same second produce the byte-identical token string.
  itDb('rejects a validly-signed token that is not the row’s current one', async () => {
    const { token } = await labAuth.login(LOGIN, PASSWORD)
    const user = await User.findOne({ where: { login: LOGIN } })

    // Same secret, same subject, never stored — a token from a session that has
    // since been replaced looks exactly like this.
    const stale = jwt.sign({ sub: user.id, jti: 'stale' }, process.env.LAB_JWT_SECRET, { expiresIn: '12h' })
    assert.notStrictEqual(stale, token)
    assert.strictEqual(await labAuth.getSession(stale), null)
    assert.ok(await labAuth.getSession(token), 'the current token still works')
  })

  itDb('a new login overwrites session_token', async () => {
    await labAuth.login(LOGIN, PASSWORD)
    const user = await User.findOne({ where: { login: LOGIN } })
    await user.update({ session_token: 'some-older-token' })

    const { token } = await labAuth.login(LOGIN, PASSWORD)
    assert.strictEqual((await User.findOne({ where: { login: LOGIN } })).session_token, token)
    assert.strictEqual(await labAuth.getSession('some-older-token'), null)
  })

  itDb('rejects a token after logout', async () => {
    const { token } = await labAuth.login(LOGIN, PASSWORD)
    const user = await User.findOne({ where: { login: LOGIN } })
    await labAuth.logout(user.id)

    assert.strictEqual(await labAuth.getSession(token), null)
    assert.strictEqual((await User.findOne({ where: { login: LOGIN } })).session_token, null)
  })

  itDb('rejects a token signed with another secret, even if it is on the row', async () => {
    // Signature check AND row match — either one alone would be a hole.
    const user = await User.findOne({ where: { login: LOGIN } })
    const forged = jwt.sign({ sub: user.id }, 'not-the-real-secret')
    await user.update({ session_token: forged })

    assert.strictEqual(await labAuth.getSession(forged), null)
  })

  itDb('rejects an expired token', async () => {
    const user = await User.findOne({ where: { login: LOGIN } })
    const expired = jwt.sign({ sub: user.id }, process.env.LAB_JWT_SECRET, { expiresIn: '-1s' })
    await user.update({ session_token: expired })

    assert.strictEqual(await labAuth.getSession(expired), null)
  })

  itDb('rejects garbage, an empty token and a token for a deleted user', async () => {
    assert.strictEqual(await labAuth.getSession(''), null)
    assert.strictEqual(await labAuth.getSession('not.a.jwt'), null)

    const orphan = jwt.sign({ sub: 999999 }, process.env.LAB_JWT_SECRET)
    assert.strictEqual(await labAuth.getSession(orphan), null)
  })

  itDb('rejects any token when the feature is unconfigured', async () => {
    const { token } = await labAuth.login(LOGIN, PASSWORD)
    const secret = process.env.LAB_JWT_SECRET
    delete process.env.LAB_JWT_SECRET
    try {
      assert.strictEqual(await labAuth.getSession(token), null)
    } finally {
      process.env.LAB_JWT_SECRET = secret
    }
  })
})

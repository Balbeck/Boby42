'use strict'

// Unit suite for services/labAuth.service.js — no Postgres.
//
// `User` is stubbed; bcryptjs and jsonwebtoken run for real, because they ARE
// the logic here — a stubbed `jwt.verify` would test nothing. The point of the
// suite is the stateful half of the design: a signature that verifies is not
// enough, the token must still equal the row's `session_token`. Every way that
// second check can fail gets its own test, since the DB suite can only reach
// them by mutating the row behind the service's back.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const { stubModel, spy, restoreAll } = require('../sequelizeStub')
const { User } = require('../../models')
const labAuth = require('../../services/labAuth.service')

const SECRET = process.env.LAB_JWT_SECRET
const PASSWORD = 'test-lab-password'
// Cost 4 rather than the seeder's default: this is a throwaway hash and the
// suite creates one per test.
const HASH = bcrypt.hashSync(PASSWORD, 4)

afterEach(() => {
  restoreAll()
  process.env.LAB_JWT_SECRET = SECRET
})
after(() => restoreAll())

/**
 * A User row whose `update` records what it was given, the way the real
 * instance method persists `session_token`.
 *
 * @param {Object} [overrides]
 */
function userRow (overrides = {}) {
  const row = {
    id: 1,
    login: 'test-lab-login',
    password_hash: HASH,
    session_token: null,
    ...overrides
  }
  row.update = spy(async (values) => Object.assign(row, values))
  return row
}

describe('isConfigured', () => {
  it('is true when a signing secret is present', () => {
    assert.strictEqual(labAuth.isConfigured(), true)
  })

  it('is false when LAB_JWT_SECRET is unset — the whole gate fails closed on this', () => {
    delete process.env.LAB_JWT_SECRET
    assert.strictEqual(labAuth.isConfigured(), false)
  })

  it('is false for an empty secret, not just an absent one', () => {
    process.env.LAB_JWT_SECRET = ''
    assert.strictEqual(labAuth.isConfigured(), false)
  })
})

describe('login', () => {
  it('returns a token and stores it on the row', async () => {
    const row = userRow()
    stubModel(User, { findOne: spy(async () => row) })

    const result = await labAuth.login('test-lab-login', PASSWORD)

    assert.strictEqual(result.login, 'test-lab-login')
    assert.strictEqual(typeof result.token, 'string')
    // Stateful session: the signed token IS the stored one. Without this write
    // logout would have nothing to revoke.
    assert.strictEqual(row.update.calls[0][0].session_token, result.token)
    assert.strictEqual(row.session_token, result.token)
  })

  it('signs the user id as `sub`, with a 12h expiry', async () => {
    stubModel(User, { findOne: spy(async () => userRow({ id: 42 })) })
    const { token } = await labAuth.login('test-lab-login', PASSWORD)

    const payload = jwt.verify(token, SECRET)
    assert.strictEqual(payload.sub, 42)
    assert.strictEqual(payload.exp - payload.iat, 12 * 3600)
  })

  it('looks the user up by login, not by id', async () => {
    const findOne = spy(async () => userRow())
    stubModel(User, { findOne })

    await labAuth.login('test-lab-login', PASSWORD)
    assert.deepStrictEqual(findOne.calls[0][0], { where: { login: 'test-lab-login' } })
  })

  it('returns null for an unknown login', async () => {
    stubModel(User, { findOne: spy(async () => null) })
    assert.strictEqual(await labAuth.login('nobody', PASSWORD), null)
  })

  it('returns null for a wrong password, and writes nothing', async () => {
    const row = userRow()
    stubModel(User, { findOne: spy(async () => row) })

    assert.strictEqual(await labAuth.login('test-lab-login', 'wrong'), null)
    assert.strictEqual(row.update.callCount, 0, 'a failed login must not touch the session')
  })

  it('returns null for an empty password rather than treating it as a match', async () => {
    stubModel(User, { findOne: spy(async () => userRow()) })
    assert.strictEqual(await labAuth.login('test-lab-login', ''), null)
  })

  it('overwrites an existing session — a second login revokes the first', async () => {
    const row = userRow({ session_token: 'older-token' })
    stubModel(User, { findOne: spy(async () => row) })

    const { token } = await labAuth.login('test-lab-login', PASSWORD)
    assert.notStrictEqual(row.session_token, 'older-token')
    assert.strictEqual(row.session_token, token)
  })
})

describe('logout', () => {
  it('nulls the stored session token for that user only', async () => {
    const update = spy(async () => [1])
    stubModel(User, { update })

    await labAuth.logout(42)
    assert.deepStrictEqual(update.calls[0], [{ session_token: null }, { where: { id: 42 } }])
  })
})

describe('getSession', () => {
  /** A row carrying a freshly signed, currently valid token. */
  function signedInRow (overrides = {}) {
    const row = userRow(overrides)
    row.session_token = jwt.sign({ sub: row.id }, SECRET, { expiresIn: '12h' })
    return row
  }

  it('returns the user when the signature verifies and the token is the stored one', async () => {
    const row = signedInRow()
    stubModel(User, { findByPk: spy(async () => row) })

    assert.strictEqual(await labAuth.getSession(row.session_token), row)
  })

  it('looks the user up by the token\'s `sub`', async () => {
    const row = signedInRow({ id: 7 })
    const findByPk = spy(async () => row)
    stubModel(User, { findByPk })

    await labAuth.getSession(row.session_token)
    assert.strictEqual(findByPk.calls[0][0], 7)
  })

  const absent = [['an empty string', ''], ['undefined', undefined], ['null', null]]
  for (const [label, token] of absent) {
    it(`returns null for ${label} without hitting the database`, async () => {
      const findByPk = spy(async () => userRow())
      stubModel(User, { findByPk })

      assert.strictEqual(await labAuth.getSession(token), null)
      assert.strictEqual(findByPk.callCount, 0)
    })
  }

  it('returns null when the gate is unconfigured, even for a token that would verify', async () => {
    const row = signedInRow()
    const findByPk = spy(async () => row)
    stubModel(User, { findByPk })

    delete process.env.LAB_JWT_SECRET
    assert.strictEqual(await labAuth.getSession(row.session_token), null)
    assert.strictEqual(findByPk.callCount, 0)
  })

  it('returns null on a token signed with another secret', async () => {
    const forged = jwt.sign({ sub: 1 }, 'attacker-secret', { expiresIn: '12h' })
    stubModel(User, { findByPk: spy(async () => userRow({ session_token: forged })) })

    assert.strictEqual(await labAuth.getSession(forged), null)
  })

  it('returns null on garbage that is not a JWT at all', async () => {
    stubModel(User, { findByPk: spy(async () => userRow()) })
    assert.strictEqual(await labAuth.getSession('not.a.token'), null)
  })

  it('returns null on an expired token', async () => {
    const expired = jwt.sign({ sub: 1 }, SECRET, { expiresIn: -10 })
    stubModel(User, { findByPk: spy(async () => userRow({ session_token: expired })) })

    assert.strictEqual(await labAuth.getSession(expired), null)
  })

  it('returns null when the signed user no longer exists', async () => {
    const token = jwt.sign({ sub: 999 }, SECRET, { expiresIn: '12h' })
    stubModel(User, { findByPk: spy(async () => null) })

    assert.strictEqual(await labAuth.getSession(token), null)
  })

  it('returns null when the row was logged out — a valid signature is not enough', async () => {
    // The whole reason the token is also stored: this is what makes logout and
    // "one session at a time" actually revoke anything.
    const token = jwt.sign({ sub: 1 }, SECRET, { expiresIn: '12h' })
    stubModel(User, { findByPk: spy(async () => userRow({ session_token: null })) })

    assert.strictEqual(await labAuth.getSession(token), null)
  })

  it('returns null when the row holds a different, also-valid token', async () => {
    const older = jwt.sign({ sub: 1, jti: 'a' }, SECRET, { expiresIn: '12h' })
    const current = jwt.sign({ sub: 1, jti: 'b' }, SECRET, { expiresIn: '12h' })
    stubModel(User, { findByPk: spy(async () => userRow({ session_token: current })) })

    assert.strictEqual(await labAuth.getSession(older), null)
  })
})

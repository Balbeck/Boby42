'use strict'

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { User } = require('../models')

// The /lab session JWT. Stateful and single-session: the signed token is also
// stored on User.session_token, and a protected request must present a cookie
// whose exact string equals that column. Logout nulls it; a second login
// overwrites it — either way, older tokens stop working immediately.
//
// jsonwebtoken (pure JS) is used directly here rather than @fastify/jwt: the
// service layer owns signing/verifying (per the plan) and @fastify/jwt's
// request-bound API would drag Fastify into this module.
const TOKEN_TTL = '12h'

/** The feature is configured only when a signing secret is present. */
function isConfigured() {
  return Boolean(process.env.LAB_JWT_SECRET)
}

/**
 * @param {string} login
 * @param {string} password
 * @returns {Promise<{ token: string, login: string } | null>} null on bad creds
 */
async function login(login, password) {
  const user = await User.findOne({ where: { login } })
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null

  const token = jwt.sign({ sub: user.id }, process.env.LAB_JWT_SECRET, { expiresIn: TOKEN_TTL })
  await user.update({ session_token: token })
  return { token, login: user.login }
}

/** @param {number} userId */
async function logout(userId) {
  await User.update({ session_token: null }, { where: { id: userId } })
}

/**
 * Verify a token's signature AND confirm it is the user's current session_token.
 * @param {string} token
 * @returns {Promise<User | null>}
 */
async function getSession(token) {
  if (!token || !isConfigured()) return null

  let payload
  try {
    payload = jwt.verify(token, process.env.LAB_JWT_SECRET)
  } catch {
    return null
  }

  const user = await User.findByPk(payload.sub)
  if (!user || user.session_token !== token) return null
  return user
}

module.exports = { login, logout, getSession, isConfigured, TOKEN_TTL }

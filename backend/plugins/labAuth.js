'use strict'

const fp = require('fastify-plugin')
const cookie = require('@fastify/cookie')
const { User } = require('../models')
const labAuth = require('../services/labAuth.service')

/**
 * Wires the `lab_token` cookie and the `verifyLab` guard for the /lab feature.
 *
 * Fail closed — if LAB_JWT_SECRET is unset OR no user row is seeded, every
 * guarded route calls the not-found handler (404): we don't confirm the feature
 * exists. Otherwise the cookie must be present, its JWT signature valid, and its
 * exact string equal to User.session_token (stateful single session) — anything
 * else is 401.
 *
 * `verifyLab` asks those questions in the cheapest order that keeps those
 * semantics: configured check (no query) → session → seeded check ONLY when the
 * session came back empty, to decide which rejection applies. So a valid session
 * costs one query on the one-row `users` table instead of two. The seeded check
 * is never cached, because a user row can appear (`make db-seed`) or disappear
 * while the process is live and that has to be observable immediately —
 * `test/routes/lab.test.js` asserts exactly that.
 *
 * Not attached to any existing route — only routes/auth/lab/* opt in.
 */
module.exports = fp(async function (fastify) {
  await fastify.register(cookie)

  // Make the fail-closed reason visible in the logs — a prod `/auth/lab/* → 404`
  // is otherwise indistinguishable from a missing route.
  if (labAuth.isConfigured()) {
    fastify.log.info('[lab] gate enabled (LAB_JWT_SECRET set)')
  } else {
    fastify.log.warn('[lab] LAB_JWT_SECRET unset — /lab gate disabled, /auth/lab/* return 404')
  }

  fastify.decorate('verifyLab', async function verifyLab(request, reply) {
    if (!labAuth.isConfigured()) return reply.callNotFound()

    const token = request.cookies?.lab_token
    const user = token ? await labAuth.getSession(token) : null
    if (user) {
      request.labUser = user
      return
    }

    // No valid session. `getSession()` returning null does NOT tell us whether
    // the deployment is unseeded (404) or the caller is simply unauthenticated
    // (401) — that is the only thing this second query decides, and it is why it
    // runs on the failure path alone.
    if (!(await User.findOne({ attributes: ['id'] }))) return reply.callNotFound()
    throw fastify.httpErrors.unauthorized('Invalid session')
  })
})

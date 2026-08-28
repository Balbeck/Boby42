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
    if (!(await User.findOne({ attributes: ['id'] }))) return reply.callNotFound()

    const token = request.cookies?.lab_token
    const user = token ? await labAuth.getSession(token) : null
    if (!user) throw fastify.httpErrors.unauthorized('Invalid session')

    request.labUser = user
  })
})

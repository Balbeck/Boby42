'use strict'

const labAuth = require('../../../services/labAuth.service')
const { User } = require('../../../models')

// Transport only — all logic is in services/labAuth.service.js. Autoload gives
// this folder the `/auth/lab` prefix, so the paths below resolve to
// /auth/lab/login, /auth/lab/logout, /auth/lab/me. `/auth/lab` has no page
// collision in the SPA, so vite.config.js proxies it plainly (no bypass).

const loginSchema = {
  body: {
    type: 'object',
    required: ['login', 'password'],
    properties: {
      login: { type: 'string', minLength: 1 },
      password: { type: 'string', minLength: 1 }
    }
  }
}

module.exports = async function (fastify) {
  // Public, but fails closed exactly like the guarded routes: unconfigured or
  // unseeded → 404 (never a 401 that would confirm the feature exists).
  fastify.post('/login', { schema: loginSchema }, async function (request, reply) {
    if (!labAuth.isConfigured() || !(await User.findOne({ attributes: ['id'] }))) {
      return reply.callNotFound()
    }

    const { login, password } = request.body
    const session = await labAuth.login(login, password)
    if (!session) throw fastify.httpErrors.unauthorized('Invalid credentials')

    reply.setCookie('lab_token', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // In this deployment the backend is always reached server-side over plain
      // HTTP (Vite proxy / loopback), so this is false — the cookie still rides
      // the HTTPS Cloudflare tunnel, httpOnly + sameSite=lax. On a direct HTTPS
      // hit it becomes Secure.
      secure: request.protocol === 'https'
    })
    return { login: session.login }
  })

  fastify.post('/logout', { preHandler: fastify.verifyLab }, async function (request, reply) {
    await labAuth.logout(request.labUser.id)
    reply.clearCookie('lab_token', { path: '/' })
    return { ok: true }
  })

  fastify.get('/me', { preHandler: fastify.verifyLab }, async function (request) {
    return { login: request.labUser.login }
  })
}

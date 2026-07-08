'use strict'

const fp = require('fastify-plugin')

/**
 * Allows the frontend origin to call this API.
 *
 * @see https://github.com/fastify/fastify-cors
 */
module.exports = fp(async function (fastify, opts) {
  fastify.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN
  })
})

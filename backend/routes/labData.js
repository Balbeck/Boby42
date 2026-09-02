'use strict'

const { listTables, readTable, readConversationTree } = require('../services/labData.service')

// Raw read-only inspector for the /lab db-viz tab. Transport only — the
// whitelist, the row cap and the SELECT live in services/labData.service.js.
//
// Gated: every route runs `{ preHandler: fastify.verifyLab }`, so an
// unconfigured deployment answers 404 and a request without a valid `lab_token`
// cookie answers 401. The frontend already sends `credentials: 'include'`. The
// model-derived table whitelist (which drops `users`) in the service stays as
// defence-in-depth behind the gate.
//
// Top-level route file: autoload does not prefix these, so the full paths are
// declared explicitly (same as routes/chat.js, routes/subjectspdf.js).

const readSchema = {
  params: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 }
    }
  },
  querystring: {
    type: 'object',
    properties: {
      // Upper bound is clamped in the service (to 10000); keep the schema loose.
      limit: { type: 'integer', minimum: 1 }
    }
  }
}

const treeSchema = {
  params: {
    type: 'object',
    required: ['conversationId'],
    properties: {
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.get('/lab-data/tables', { preHandler: fastify.verifyLab }, async function () {
    return listTables()
  })

  fastify.get(
    '/lab-data/tables/:name',
    { schema: readSchema, preHandler: fastify.verifyLab },
    async function (request, reply) {
      const result = await readTable(request.params.name, { limit: request.query.limit })
      // null → the name is not in the whitelist (includes `users`).
      if (!result) return reply.notFound('Unknown table')
      return result
    }
  )

  // Relations explorer — one conversation with its subtree assembled by FK.
  fastify.get('/lab-data/tree/:conversationId', { schema: treeSchema, preHandler: fastify.verifyLab }, async function (request, reply) {
    const tree = await readConversationTree(request.params.conversationId)
    if (!tree) return reply.notFound('Conversation not found')
    return tree
  })
}

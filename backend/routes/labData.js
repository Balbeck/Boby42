'use strict'

const { listTables, readTable } = require('../services/labData.service')

// Raw read-only inspector for the /lab db-viz tab. Transport only — the
// whitelist, the row cap and the SELECT live in services/labData.service.js.
//
// UNGATED for now, by decision: this task is display-only. A later dedicated
// task adds `{ preHandler: fastify.verifyLab }` to both routes and nothing
// else. Until then the model-derived table whitelist (which drops `users`) in
// the service is the only safeguard — do not add a cookie check or feature flag
// here.
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

module.exports = async function (fastify, opts) {
  fastify.get('/lab-data/tables', async function () {
    return listTables()
  })

  fastify.get('/lab-data/tables/:name', { schema: readSchema }, async function (request, reply) {
    const result = await readTable(request.params.name, { limit: request.query.limit })
    // null → the name is not in the whitelist (includes `users`).
    if (!result) return reply.notFound('Unknown table')
    return result
  })
}

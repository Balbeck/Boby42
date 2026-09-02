'use strict'

const analytics = require('../../services/analytics.service')
const { readConversationTree } = require('../../services/labData.service')

// The admin-wide conversation browser:
//   GET /analytics/conversations        — a filterable, paginated list
//   GET /analytics/conversations/:id    — one conversation's full subtree,
//                                         delegated to readConversationTree()
//                                         (same shape as GET /lab-data/tree/:id)
// Not visitor-scoped — the Lab operator sees every conversation. Transport only;
// both behind `fastify.verifyLab`. Folder prefix → `/analytics`.

const listQuerystring = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    offset: { type: 'integer', minimum: 0 },
    page: { type: 'string', enum: ['chat', 'archiviste'] }
  }
}

const detailParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' }
  }
}

module.exports = async function (fastify) {
  fastify.get(
    '/conversations',
    { schema: { querystring: listQuerystring }, preHandler: fastify.verifyLab },
    async function (request) {
      // No `from` given → a decade-wide window, i.e. "all" (the browser owns its
      // own date filter and defaults to all; the 7-day panel default does not
      // apply here).
      const window = analytics.resolveWindow(request.query, 3650)
      const { limit = 25, offset = 0, page = null } = request.query
      return analytics.conversationList({ ...window, limit, offset, page })
    }
  )

  fastify.get(
    '/conversations/:id',
    { schema: { params: detailParams }, preHandler: fastify.verifyLab },
    async function (request, reply) {
      const tree = await readConversationTree(request.params.id)
      if (!tree) return reply.notFound('Conversation not found')
      return tree
    }
  )
}

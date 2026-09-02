'use strict'

const analytics = require('../../services/analytics.service')

// The copyable list of what the document base is missing: `no_match` events,
// newest first, each tagged with the page it happened on. Paginated by
// limit/offset; optional `page` filter (chat | archiviste). Transport only.
//
// Path: `/analytics/unmatched` (folder prefix). Behind `fastify.verifyLab`.

const querystring = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 },
    page: { type: 'string', enum: ['chat', 'archiviste'] }
  }
}

module.exports = async function (fastify) {
  fastify.get(
    '/unmatched',
    { schema: { querystring }, preHandler: fastify.verifyLab },
    async function (request) {
      const window = analytics.resolveWindow(request.query)
      const { limit = 100, offset = 0, page = null } = request.query
      return analytics.unmatchedQuestions({ ...window, limit, offset, page })
    }
  )
}

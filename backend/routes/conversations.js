'use strict'

const { listConversations, getConversation } = require('../services/conversation.service')

// The visitor's own history — what the frontend drawer lists and reopens.
// Read-only, transport only: the ownership check (conversations → visitors on
// `anon_id`) and the SELECTs live in services/conversation.service.js.
//
// `visitorId` is a **required** query param on both routes. There is no auth
// here: the anonymous id the browser stores is the only thing scoping a read,
// so an unknown/foreign id simply sees nothing (list) or a 404 (detail) rather
// than another student's questions.
//
// Top-level route file: autoload does not prefix these, so the full paths are
// declared explicitly (same as routes/feedback.js, routes/labData.js).

const listSchema = {
  querystring: {
    type: 'object',
    required: ['visitorId'],
    properties: {
      visitorId: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    }
  }
}

const detailSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' }
    }
  },
  querystring: {
    type: 'object',
    required: ['visitorId'],
    properties: {
      visitorId: { type: 'string', minLength: 1 }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.get('/conversations', { schema: listSchema }, async function (request) {
    const { visitorId, limit = 50 } = request.query
    return listConversations(visitorId, { limit })
  })

  fastify.get('/conversations/:id', { schema: detailSchema }, async function (request, reply) {
    const conversation = await getConversation(request.params.id, request.query.visitorId)

    // 404, not 403 — same stance as /feedback: never confirm to a stranger that
    // the conversation exists.
    if (!conversation) return reply.notFound('Conversation not found')

    return conversation
  })
}

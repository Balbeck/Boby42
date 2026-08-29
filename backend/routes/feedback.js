'use strict'

const { setFeedback } = require('../services/conversation.service')

// Transport only — ownership + upsert/delete logic lives in the service.
const schema = {
  body: {
    type: 'object',
    required: ['messageId', 'visitorId', 'rating'],
    additionalProperties: false,
    properties: {
      messageId: { type: 'string', format: 'uuid' },
      visitorId: { type: 'string', minLength: 1 },
      // -1 = 👎, 1 = 👍, 0 = withdraw (deletes the row).
      rating: { type: 'integer', enum: [-1, 0, 1] },
      // Optional, only kept on a 👎. ~500 chars is plenty for one useful line.
      comment: { type: 'string', maxLength: 500 }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/feedback', { schema }, async function (request, reply) {
    const { messageId, visitorId, rating, comment } = request.body

    const result = await setFeedback({ messageId, anonId: visitorId, rating, comment })

    // 404, not 403 — don't confirm the message exists to someone who doesn't own it.
    if (!result.ok) return reply.notFound('Message not found')

    return { ok: true, rating: result.rating }
  })
}

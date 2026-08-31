'use strict'

const { retrieveUnified } = require('../services/retriever.service')
const { recordExchange } = require('../services/conversation.service')

const schema = {
  body: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 },
      language: { type: 'string', enum: ['fr', 'en', 'origin'] },
      // Interaction logging (T4) — both optional, existing clients keep working.
      visitorId: { type: 'string' },
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

// Autoloaded from routes/ root — declares its own full path (see
// routes/archivisteDocument.js for the precedent). Phase 1 of the two-phase
// /chat: retrieval only (~2 s), no LLM. Returns rows in the exact /archiviste
// shape so the frontend can render them while the generation call runs.
module.exports = async function (fastify, opts) {
  fastify.post('/chat/documents', { schema }, async function (request, reply) {
    const { question, language, visitorId, conversationId } = request.body
    const startedAt = Date.now()

    try {
      const { count, documents } = await retrieveUnified(question, language ?? 'fr')
      return { count, documents }
    } catch (err) {
      request.log.error(err)
      // No exchange exists yet on success, but a failed search must not be
      // invisible in the DB — mirror routes/archiviste.js's error path.
      try {
        await recordExchange({
          anonId: visitorId,
          conversationId,
          page: 'chat',
          question,
          answer: null,
          language: language ?? null,
          documents: [],
          latencyMs: Date.now() - startedAt,
          errorCode: 'retrieval_error'
        })
      } catch (recErr) {
        request.log.error({ err: recErr }, 'chat/documents: failed to record exchange (error path)')
      }
      return reply.badGateway('Failed to search the document base')
    }
  })
}

'use strict'

const { getAnswer } = require('../services/orchestrator.service')
const { recordExchange } = require('../services/conversation.service')

const schema = {
  body: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 },
      // Interaction logging (T4) — both optional, existing clients keep working.
      visitorId: { type: 'string' },
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/chat', { schema }, async function (request, reply) {
    const { question, visitorId, conversationId } = request.body
    const startedAt = Date.now()

    let answer, sources
    try {
      ({ answer, sources } = await getAnswer(question))
    } catch (err) {
      request.log.error(err)
      // Still record the failed exchange, then return the unchanged 502.
      try {
        await recordExchange({
          anonId: visitorId,
          conversationId,
          page: 'chat',
          question,
          answer: null,
          language: null,
          documents: [],
          latencyMs: Date.now() - startedAt,
          errorCode: 'ollama_error'
        })
      } catch (recErr) {
        request.log.error({ err: recErr }, 'chat: failed to record exchange (error path)')
      }
      return reply.badGateway('Failed to get an answer from Ollama')
    }

    // Persistence must never break the response — log failures and move on.
    let recordedConversationId = conversationId
    try {
      const rec = await recordExchange({
        anonId: visitorId,
        conversationId,
        page: 'chat',
        question,
        answer,
        language: null,
        documents: sources,
        latencyMs: Date.now() - startedAt,
        errorCode: null
      })
      recordedConversationId = rec.conversationId
    } catch (err) {
      request.log.error({ err }, 'chat: failed to record exchange')
    }

    return { answer, sources, conversationId: recordedConversationId }
  })
}

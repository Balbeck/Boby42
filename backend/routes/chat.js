'use strict'

const { getAnswer } = require('../services/orchestrator.service')
const { recordExchange } = require('../services/conversation.service')

const schema = {
  body: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 },
      // Optional — defaults to 'fr'. Decides the Notion url built for the
      // preview and which language copy the generation call reads.
      language: { type: 'string', enum: ['fr', 'en', 'origin'] },
      // Optional — the rows a prior POST /chat/documents returned. When present,
      // getAnswer reads exactly those (no second embedding); when absent it
      // retrieves them itself (one-call fallback — keeps bare clients working).
      documents: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          required: ['name', 'type'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 300 },
            type: { type: 'string', enum: ['md', 'pdf'] },
            score: { type: 'number' },
            url: { type: 'string' }
          }
        }
      },
      // Interaction logging (T4) — both optional, existing clients keep working.
      visitorId: { type: 'string' },
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/chat', { schema }, async function (request, reply) {
    const { question, visitorId, conversationId, language, documents } = request.body
    const startedAt = Date.now()

    let answer, sources
    try {
      ({ answer, sources } = await getAnswer(question, documents, language ?? 'fr'))
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
          language: language ?? 'fr',
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
    // The assistant message id — the handle a later /feedback call rates.
    // Absent only if the logging write below fails (like conversationId).
    let messageId
    try {
      const rec = await recordExchange({
        anonId: visitorId,
        conversationId,
        page: 'chat',
        question,
        answer,
        language: language ?? 'fr',
        documents: sources,
        latencyMs: Date.now() - startedAt,
        errorCode: null
      })
      recordedConversationId = rec.conversationId
      messageId = rec.messageId
    } catch (err) {
      request.log.error({ err }, 'chat: failed to record exchange')
    }

    return { answer, sources, conversationId: recordedConversationId, messageId }
  })
}

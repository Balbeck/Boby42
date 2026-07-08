'use strict'

const { getAnswer } = require('../services/orchestrator.service')

const schema = {
  body: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/chat', { schema }, async function (request, reply) {
    const { question } = request.body

    let answer
    try {
      answer = await getAnswer(question)
    } catch (err) {
      request.log.error(err)
      return reply.badGateway('Failed to get an answer from Ollama')
    }

    return { answer, sources: [] }
  })
}

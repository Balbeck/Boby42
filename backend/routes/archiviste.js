'use strict'

const { retrieve } = require('../services/retriever.service')

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
  fastify.post('/archiviste', { schema }, async function (request, reply) {
    const { question } = request.body

    let documents
    try {
      documents = await retrieve(question)
    } catch (err) {
      request.log.error(err)
      return reply.badGateway('Failed to search the document base')
    }

    const results = documents.map(({ name, score }) => {
      const cleanName = name.replace(/\.md$/, '')
      return {
        name: cleanName,
        score,
        url: `/archiviste/documents/${encodeURIComponent(cleanName)}`
      }
    })

    return { count: results.length, documents: results }
  })
}

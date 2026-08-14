'use strict'

const { readBaseDocumentaireDocument } = require('../services/documentReader.service')

const schema = {
  params: {
    type: 'object',
    required: ['language', 'name'],
    properties: {
      language: { type: 'string', enum: ['fr', 'en', 'origin'] },
      name: { type: 'string', minLength: 1 }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.get('/BaseDocumentaire/:language/Notion/:name', { schema }, async function (request, reply) {
    const { language, name } = request.params

    const document = await readBaseDocumentaireDocument(language, name)
    if (!document) {
      return reply.notFound('Document not found')
    }

    return document
  })
}

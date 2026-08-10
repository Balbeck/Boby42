'use strict'

const { readDocumentByName } = require('../services/documentReader.service')

const schema = {
  params: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.get('/archiviste/documents/:name', { schema }, async function (request, reply) {
    const { name } = request.params

    const document = await readDocumentByName(name)
    if (!document) {
      return reply.notFound('Document not found')
    }

    return document
  })
}

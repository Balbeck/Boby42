'use strict'

const fs = require('node:fs')
const { resolveSubjectsPdfFile } = require('../services/subjectsPdfLibrary.service')

const schema = {
  params: {
    type: 'object',
    required: ['file'],
    properties: {
      // must end in .pdf; the whitelist in resolveSubjectsPdfFile is the real guard
      file: { type: 'string', minLength: 1, pattern: '\\.pdf$' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.get('/subjectspdf/:file', { schema }, async function (request, reply) {
    const { file } = request.params

    const absolutePath = await resolveSubjectsPdfFile(file)
    if (!absolutePath) {
      return reply.notFound('Subject PDF not found')
    }

    reply.header('Content-Disposition', `inline; filename="${file}"`)
    reply.type('application/pdf')
    return reply.send(fs.createReadStream(absolutePath))
  })
}

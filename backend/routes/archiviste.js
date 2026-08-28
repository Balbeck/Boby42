'use strict'

const path = require('node:path')
const { retrieveWithSubjectsPdf } = require('../services/retriever.service')

const schema = {
  body: {
    type: 'object',
    required: ['question', 'language'],
    properties: {
      question: { type: 'string', minLength: 1 },
      language: { type: 'string', enum: ['fr', 'en', 'origin'] }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/archiviste', { schema }, async function (request, reply) {
    const { question, language } = request.body

    let result
    try {
      result = await retrieveWithSubjectsPdf(question)
    } catch (err) {
      request.log.error(err)
      return reply.badGateway('Failed to search the document base')
    }

    // Notion documents — url built dynamically from name + language, as before.
    const notionResults = result.documents.map(({ name, score }) => {
      const cleanName = name.replace(/\.md$/, '')
      return {
        name: cleanName,
        score,
        type: 'md',
        url: `/BaseDocumentaire/${language}/Notion/${encodeURIComponent(cleanName)}.md`
      }
    })

    // Subject PDFs — same idea: url built here from the basename, language-agnostic
    // (subjects are English-only). name drops the .pdf to match the Notion contract.
    const pdfResults = result.subjectsPdf.map(({ filename, score }) => {
      const base = path.basename(filename)
      return {
        name: base.replace(/\.pdf$/i, ''),
        score,
        type: 'pdf',
        url: `/subjectspdf/${encodeURIComponent(base)}`
      }
    })

    const documents = [...notionResults, ...pdfResults]
    return { count: documents.length, documents }
  })
}

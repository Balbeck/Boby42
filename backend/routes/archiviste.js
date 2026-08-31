'use strict'

const path = require('node:path')
const { retrieveWithSubjectsPdf } = require('../services/retriever.service')
const { recordExchange, logEvent } = require('../services/conversation.service')
const { resolveNotionDir } = require('../services/documentReader.service')
const { resolveSubjectsPdfFile } = require('../services/subjectsPdfLibrary.service')

const schema = {
  body: {
    type: 'object',
    required: ['question', 'language'],
    properties: {
      question: { type: 'string', minLength: 1 },
      language: { type: 'string', enum: ['fr', 'en', 'origin'] },
      // Interaction logging (T4) — both optional, existing clients keep working.
      visitorId: { type: 'string' },
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/archiviste', { schema }, async function (request, reply) {
    const { question, language, visitorId, conversationId } = request.body
    const startedAt = Date.now()

    let result
    try {
      result = await retrieveWithSubjectsPdf(question)
    } catch (err) {
      request.log.error(err)
      // Still record the failed exchange, then return the unchanged 502.
      try {
        await recordExchange({
          anonId: visitorId,
          conversationId,
          page: 'archiviste',
          question,
          answer: null,
          language,
          documents: [],
          latencyMs: Date.now() - startedAt,
          errorCode: 'retrieval_error'
        })
      } catch (recErr) {
        request.log.error({ err: recErr }, 'archiviste: failed to record exchange (error path)')
      }
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

    // Persistence must never break the response — log failures and move on.
    let recordedConversationId = conversationId
    // The assistant message id — the handle a later /feedback call rates
    // (on /archiviste the rating applies to the result list as a whole).
    // Absent only if the logging write below fails (like conversationId).
    let messageId
    try {
      // Same by-reference shape /chat logs: keep `type`, and resolve the real
      // on-disk `path` through the existing whitelists (the language copy for
      // md, the resolved PDF path for pdf) — never built from a request string.
      const notionDir = resolveNotionDir(language)
      const documentsForLog = await Promise.all(
        documents.map(async (d) => ({
          name: d.name,
          type: d.type,
          url: d.url,
          path: d.type === 'md'
            ? (notionDir ? path.join(notionDir, `${d.name}.md`) : null)
            : await resolveSubjectsPdfFile(`${d.name}.pdf`),
          score: d.score
        }))
      )

      const rec = await recordExchange({
        anonId: visitorId,
        conversationId,
        page: 'archiviste',
        question,
        answer: null, // no LLM answer on /archiviste — the assistant row carries only the docs
        language,
        documents: documentsForLog,
        latencyMs: Date.now() - startedAt,
        errorCode: null
      })
      recordedConversationId = rec.conversationId
      messageId = rec.messageId

      // A matched-nothing question is a gap in the document base — record it.
      if (documents.length === 0) {
        await logEvent({
          anonId: visitorId,
          conversationId: recordedConversationId,
          type: 'no_match',
          payload: { question, language }
        })
      }
    } catch (err) {
      request.log.error({ err }, 'archiviste: failed to record exchange')
    }

    return { count: documents.length, documents, conversationId: recordedConversationId, messageId }
  })
}

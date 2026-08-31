'use strict'

const { getAnswer } = require('../services/orchestrator.service')
const { recordExchange, logEvent } = require('../services/conversation.service')

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
      // Optional — when true the answer is streamed back as NDJSON (one
      // {type:'token'} line per fragment, then a terminal {type:'done'} line
      // carrying sources/conversationId/messageId). Absent/false → the plain
      // JSON response below, kept for bare curl / scripts.
      stream: { type: 'boolean' },
      // Interaction logging (T4) — both optional, existing clients keep working.
      visitorId: { type: 'string' },
      conversationId: { type: 'string', format: 'uuid' }
    }
  }
}

module.exports = async function (fastify, opts) {
  fastify.post('/chat', { schema }, async function (request, reply) {
    const { question, visitorId, conversationId, language, documents, stream } = request.body
    const lang = language ?? 'fr'
    const startedAt = Date.now()

    // Record a successful exchange; never let a persistence failure break the
    // response. Returns { conversationId, messageId } (or {} on failure).
    const recordOk = async (answer, sources) => {
      try {
        return await recordExchange({
          anonId: visitorId,
          conversationId,
          page: 'chat',
          question,
          answer,
          language: lang,
          documents: sources,
          latencyMs: Date.now() - startedAt,
          errorCode: null
        })
      } catch (err) {
        request.log.error({ err }, 'chat: failed to record exchange')
        return {}
      }
    }

    // Record a failed exchange (LLM/retrieval error path) — same fail-safe.
    const recordFailed = async () => {
      try {
        await recordExchange({
          anonId: visitorId,
          conversationId,
          page: 'chat',
          question,
          answer: null,
          language: lang,
          documents: [],
          latencyMs: Date.now() - startedAt,
          errorCode: 'ollama_error'
        })
      } catch (err) {
        request.log.error({ err }, 'chat: failed to record exchange (error path)')
      }
    }

    // A question that matched nothing is a gap in the document base — log it,
    // mirroring routes/archiviste.js. Only on the success path (an ollama_error
    // is not a no-match). Fail-safe like the rest.
    const recordNoMatch = async (recordedConversationId) => {
      try {
        await logEvent({
          anonId: visitorId,
          conversationId: recordedConversationId,
          type: 'no_match',
          payload: { question, language: lang }
        })
      } catch (err) {
        request.log.error({ err }, 'chat: failed to log no_match event')
      }
    }

    // ---- Streaming path (NDJSON) ---------------------------------------------
    if (stream) {
      reply.hijack()
      const raw = reply.raw
      raw.on('error', () => {}) // swallow EPIPE if the client vanished mid-write
      raw.writeHead(200, {
        ...reply.getHeaders(), // keep CORS / plugin headers hijack would drop
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform'
      })
      const write = (obj) => raw.write(JSON.stringify(obj) + '\n')

      // Stop Ollama generation as soon as the client goes away. The signal is
      // the *response* socket closing before we finished writing it — the
      // request stream ('request.raw') closing just means the body is in, which
      // happens before generation even starts.
      const ac = new AbortController()
      raw.on('close', () => {
        if (!raw.writableFinished) ac.abort()
      })

      let answer, sources
      try {
        ({ answer, sources } = await getAnswer(question, documents, lang, {
          onToken: (value) => write({ type: 'token', value }),
          signal: ac.signal
        }))
      } catch (err) {
        if (ac.signal.aborted) return raw.end() // client left — nothing to send or log
        request.log.error(err)
        await recordFailed()
        write({ type: 'error', message: 'Failed to get an answer from Ollama' })
        return raw.end()
      }

      const { conversationId: recordedConversationId = conversationId, messageId } =
        await recordOk(answer, sources)
      if (sources.length === 0) await recordNoMatch(recordedConversationId)

      write({ type: 'done', answer, sources, conversationId: recordedConversationId, messageId })
      return raw.end()
    }

    // ---- Plain JSON path (bare curl / scripts) -----------------------------
    let answer, sources
    try {
      ({ answer, sources } = await getAnswer(question, documents, lang))
    } catch (err) {
      request.log.error(err)
      await recordFailed()
      return reply.badGateway('Failed to get an answer from Ollama')
    }

    const { conversationId: recordedConversationId = conversationId, messageId } =
      await recordOk(answer, sources)
    if (sources.length === 0) await recordNoMatch(recordedConversationId)

    return { answer, sources, conversationId: recordedConversationId, messageId }
  })
}

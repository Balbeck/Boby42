'use strict'

const {
  sequelize, Visitor, Conversation, Message, MessageDocument, Event, MessageFeedback
} = require('../models')

// Everything an anonymous request can't attribute (blank/missing anon id) lands
// on this single synthetic visitor row rather than throwing.
const FALLBACK_ANON_ID = 'anonymous'

// conversations.title = the first question, collapsed and truncated to this.
const TITLE_MAX = 80

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Upsert a visitor by `anon_id` and bump `last_seen_at`. A missing/blank id
 * falls back to a single fixed synthetic row. `conflictFields` pins the
 * ON CONFLICT target to `anon_id` (the model also has a unique `intra_login`,
 * so the target would otherwise be ambiguous).
 *
 * @param {string | null | undefined} anonId
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 * @returns {Promise<import('sequelize').Model>}
 */
async function ensureVisitor(anonId, { transaction } = {}) {
  const key = String(anonId ?? '').trim() || FALLBACK_ANON_ID

  await Visitor.upsert(
    { anon_id: key, last_seen_at: new Date() },
    { transaction, conflictFields: ['anon_id'] }
  )

  return Visitor.findOne({ where: { anon_id: key }, transaction })
}

/**
 * Records one full exchange (question + answer/documents) in a single
 * transaction: resolve the visitor, reuse or create the conversation, insert
 * the `user` then the `assistant` message, attach the documents in `position`
 * order, touch `conversations.updated_at`.
 *
 * The caller wraps this so a failure only logs — a logging error must never
 * change the HTTP response.
 *
 * @param {import('../types/types').RecordExchangeInput} input
 * @returns {Promise<import('../types/types').RecordExchangeResult>}
 */
async function recordExchange({
  anonId,
  conversationId,
  page,
  question,
  answer,
  language,
  documents = [],
  latencyMs,
  errorCode
}) {
  return sequelize.transaction(async (transaction) => {
    const visitor = await ensureVisitor(anonId, { transaction })

    let conversation = null
    if (conversationId && UUID_RE.test(conversationId)) {
      conversation = await Conversation.findByPk(conversationId, { transaction })
      // Never append to a conversation owned by another visitor or another page.
      if (conversation && (conversation.visitor_id !== visitor.id || conversation.page !== page)) {
        conversation = null
      }
    }

    if (!conversation) {
      conversation = await Conversation.create(
        { visitor_id: visitor.id, page, title: buildTitle(question) },
        { transaction }
      )
    } else {
      // Touch updated_at so the conversation floats to the top of the history
      // list (index: conversations(visitor_id, updated_at DESC)). Model.update()
      // strips managed timestamp fields and then no-ops when nothing else
      // changed, so this has to be a raw statement.
      await sequelize.query(
        'UPDATE "conversations" SET "updated_at" = :now WHERE "id" = :id',
        { replacements: { now: new Date(), id: conversation.id }, transaction }
      )
    }

    await Message.create(
      {
        conversation_id: conversation.id,
        role: 'user',
        content: question,
        language: language ?? null
      },
      { transaction }
    )

    const assistant = await Message.create(
      {
        conversation_id: conversation.id,
        role: 'assistant',
        content: answer ?? '',
        language: language ?? null,
        latency_ms: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
        error_code: errorCode ?? null,
        // `0` is the meaningful "nothing matched" value (see the 'no_match' event).
        document_count: documents.length
      },
      { transaction }
    )

    if (documents.length) {
      await MessageDocument.bulkCreate(
        documents.map((doc, position) => ({
          message_id: assistant.id,
          name: doc.name,
          type: doc.type ?? null,
          url: doc.url ?? null,
          path: doc.path ?? null,
          score: Number.isFinite(doc.score) ? doc.score : null,
          position
        })),
        { transaction }
      )
    }

    return { conversationId: conversation.id, messageId: assistant.id }
  })
}

/**
 * Appends a row to `events`. Own tiny transaction; the caller swallows failures.
 *
 * @param {import('../types/types').LogEventInput} input
 * @returns {Promise<import('sequelize').Model>}
 */
async function logEvent({ anonId, conversationId, type, payload }) {
  return sequelize.transaction(async (transaction) => {
    const visitor = await ensureVisitor(anonId, { transaction })
    return Event.create(
      {
        visitor_id: visitor.id,
        conversation_id: conversationId && UUID_RE.test(conversationId) ? conversationId : null,
        type,
        payload: payload ?? null
      },
      { transaction }
    )
  })
}

/**
 * Records (or updates, or withdraws) the 👍 / 👎 on one assistant message.
 *
 * Ownership is enforced server-side: the rating is accepted only if the message
 * is an `assistant` row in a conversation owned by the visitor identified by
 * `anonId` (INNER JOIN messages → conversations → visitors on `anon_id`). This
 * is the only thing stopping anyone from poisoning the project's one quality
 * signal — a mismatch returns `{ ok: false, reason: 'not_found' }` (the route
 * maps that to a 404, never confirming the message exists).
 *
 * `rating: 0` means "withdraw" → the row is deleted. `rating: 1` never keeps a
 * comment (no free-text on positive ratings). Otherwise it's an upsert on the
 * unique `message_id`, so re-rating updates in place.
 *
 * @param {{ messageId: string, anonId: string | null | undefined, rating: -1 | 0 | 1, comment?: string | null }} input
 * @returns {Promise<{ ok: true, rating: -1 | 0 | 1 } | { ok: false, reason: 'not_found' }>}
 */
async function setFeedback({ messageId, anonId, rating, comment }) {
  if (!messageId || !UUID_RE.test(messageId)) return { ok: false, reason: 'not_found' }

  const key = String(anonId ?? '').trim() || FALLBACK_ANON_ID

  // INNER JOINs (`required: true`) — a message whose conversation isn't this
  // visitor's simply doesn't come back.
  const message = await Message.findByPk(messageId, {
    attributes: ['id', 'role'],
    include: [
      {
        model: Conversation,
        required: true,
        attributes: ['id'],
        include: [{ model: Visitor, required: true, attributes: ['id'], where: { anon_id: key } }]
      }
    ]
  })
  if (!message || message.role !== 'assistant') return { ok: false, reason: 'not_found' }

  if (rating === 0) {
    await MessageFeedback.destroy({ where: { message_id: messageId } })
    return { ok: true, rating: 0 }
  }

  await MessageFeedback.upsert(
    {
      message_id: messageId,
      rating,
      comment: rating === -1 ? (comment ?? null) : null
    },
    { conflictFields: ['message_id'] }
  )
  return { ok: true, rating }
}

/**
 * @param {string} question
 * @returns {string}
 */
function buildTitle(question) {
  const clean = String(question ?? '').trim().replace(/\s+/g, ' ')
  if (!clean) return '(sans titre)'
  if (clean.length <= TITLE_MAX) return clean
  return clean.slice(0, TITLE_MAX - 1).trimEnd() + '…'
}

module.exports = { ensureVisitor, recordExchange, logEvent, setFeedback }

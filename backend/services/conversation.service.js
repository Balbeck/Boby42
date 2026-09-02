'use strict'

const { QueryTypes } = require('sequelize')
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
 * The visitor's own conversations, most recently updated first — what the
 * frontend drawer lists. Scoped by `anon_id`, so a visitor only ever sees their
 * own threads (there is no auth; the join *is* the ownership check).
 *
 * Raw SQL rather than a Sequelize include: the message count is a correlated
 * subquery, and the payload is a flat read-only list.
 *
 * @param {string | null | undefined} anonId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<import('../types/types').ConversationSummary[]>}
 */
async function listConversations (anonId, { limit = 50 } = {}) {
  const key = String(anonId ?? '').trim() || FALLBACK_ANON_ID
  const rows = await sequelize.query(
    `SELECT c."id", c."page", c."title", c."updated_at",
            (SELECT COUNT(*) FROM "messages" m WHERE m."conversation_id" = c."id") AS message_count
       FROM "conversations" c
       JOIN "visitors" v ON v."id" = c."visitor_id"
      WHERE v."anon_id" = :key
      ORDER BY c."updated_at" DESC
      LIMIT :limit`,
    { type: QueryTypes.SELECT, replacements: { key, limit } }
  )

  return rows.map((row) => ({
    id: row.id,
    page: row.page,
    title: row.title,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count)
  }))
}

/**
 * One conversation with its messages and their referenced documents, so the
 * frontend can re-render a past thread.
 *
 * Returns `null` when the conversation doesn't exist **or** belongs to another
 * visitor — the id is a UUID in a system with no auth, so without this join
 * anyone could enumerate other students' questions. Same "don't confirm it
 * exists" stance as `setFeedback`; the route maps `null` to a 404.
 *
 * Each assistant message carries its current `rating` (LEFT JOIN on
 * `message_feedback`) and each document its `type` — the restored row needs the
 * type to pick the markdown renderer or the PDF <iframe>. Document **content**
 * is never included (cross-cutting decision 7): the frontend re-fetches it
 * lazily on expand, exactly like a fresh answer.
 *
 * @param {string} id
 * @param {string | null | undefined} anonId
 * @returns {Promise<import('../types/types').ConversationDetail | null>}
 */
async function getConversation (id, anonId) {
  if (!id || !UUID_RE.test(id)) return null
  const key = String(anonId ?? '').trim() || FALLBACK_ANON_ID

  const [conversation] = await sequelize.query(
    `SELECT c."id", c."page", c."title"
       FROM "conversations" c
       JOIN "visitors" v ON v."id" = c."visitor_id"
      WHERE c."id" = :id AND v."anon_id" = :key`,
    { type: QueryTypes.SELECT, replacements: { id, key } }
  )
  if (!conversation) return null

  // Chronological; on a millisecond tie the user row still precedes its answer
  // (same ordering as readConversationTree — the pairing depends on it).
  const messages = await sequelize.query(
    `SELECT m."id", m."role", m."content", m."language", m."created_at", m."error_code",
            m."document_count", f."rating"
       FROM "messages" m
       LEFT JOIN "message_feedback" f ON f."message_id" = m."id"
      WHERE m."conversation_id" = :id
      ORDER BY m."created_at" ASC, (m."role" = 'user') DESC
      LIMIT 1000`,
    { type: QueryTypes.SELECT, replacements: { id } }
  )

  const messageIds = messages.map((message) => message.id)
  let documents = []
  if (messageIds.length) {
    documents = await sequelize.query(
      `SELECT "message_id", "name", "type", "url", "score"
         FROM "message_documents"
        WHERE "message_id" IN (:ids)
        ORDER BY "position" ASC`,
      { type: QueryTypes.SELECT, replacements: { ids: messageIds } }
    )
  }

  const docsByMessage = new Map()
  for (const doc of documents) {
    if (!docsByMessage.has(doc.message_id)) docsByMessage.set(doc.message_id, [])
    docsByMessage.get(doc.message_id).push({
      name: doc.name,
      type: doc.type,
      url: doc.url,
      score: doc.score
    })
  }

  return {
    id: conversation.id,
    page: conversation.page,
    title: conversation.title,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      language: message.language,
      createdAt: message.created_at,
      errorCode: message.error_code,
      documentCount: message.document_count,
      rating: message.rating ?? null,
      documents: docsByMessage.get(message.id) || []
    }))
  }
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

module.exports = {
  ensureVisitor,
  recordExchange,
  logEvent,
  setFeedback,
  listConversations,
  getConversation
}

'use strict'

// A small, fully deterministic dataset for the analytics / lab-data suites.
//
// Rows are inserted with EXPLICIT `created_at` values so the Paris day buckets,
// the generate_series gap-fill and the `{ from, to }` windows can be asserted
// against known numbers. Timestamps sit at midday UTC, far from any DST edge,
// so `AT TIME ZONE 'Europe/Paris'` lands on the intended calendar day whatever
// the host clock says.

const { randomUUID } = require('node:crypto')
const { sequelize } = require('../../models')

const DAY_1 = '2026-03-10'
const DAY_2 = '2026-03-11'

// A window that contains everything, with an empty day on each side so the
// gap-fill can be checked.
// Both bounds are at midday UTC on purpose. The daily series bucket by the
// PARIS day, so a `to` of 23:59:59Z would already be 00:59 the next day in
// Paris and the gap-fill would produce one more day than the window looks like.
const WINDOW = { from: '2026-03-09T12:00:00Z', to: '2026-03-12T12:00:00Z' }

const at = (day, time) => `${day}T${time}:00Z`

/**
 * Inserts the dataset and returns every id, so a test can assert on a specific
 * row rather than on "the first one".
 *
 * Shape: 2 visitors, 3 conversations (2 chat / 1 archiviste), 3 exchanges
 * (6 messages), 3 documents, 2 ratings (one 👍 one 👎), 1 no_match event.
 *
 * @returns {Promise<Object>}
 */
async function seedAnalytics () {
  const ids = {
    conversationChat: randomUUID(),
    conversationArchiviste: randomUUID(),
    conversationOther: randomUUID(),
    userChat: randomUUID(),
    assistantChat: randomUUID(),
    userArchiviste: randomUUID(),
    assistantArchiviste: randomUUID(),
    userOther: randomUUID(),
    assistantOther: randomUUID(),
    anonA: 'anon-a',
    anonB: 'anon-b',
    day1: DAY_1,
    day2: DAY_2,
    window: WINDOW
  }

  const [[visitorA], [visitorB]] = await Promise.all([
    sequelize.query(
      `INSERT INTO visitors (anon_id, first_seen_at, last_seen_at)
       VALUES (:anon, :seen, :seen) RETURNING id`,
      { replacements: { anon: ids.anonA, seen: at(DAY_1, '12:00') } }
    ),
    sequelize.query(
      `INSERT INTO visitors (anon_id, first_seen_at, last_seen_at)
       VALUES (:anon, :seen, :seen) RETURNING id`,
      { replacements: { anon: ids.anonB, seen: at(DAY_2, '12:00') } }
    )
  ])
  ids.visitorA = visitorA[0].id
  ids.visitorB = visitorB[0].id

  const conversation = (id, visitorId, page, title, day, time) => sequelize.query(
    `INSERT INTO conversations (id, visitor_id, page, title, created_at, updated_at)
     VALUES (:id, :visitorId, :page::enum_conversations_page, :title, :ts, :ts)`,
    { replacements: { id, visitorId, page, title, ts: at(day, time) } }
  )

  await conversation(ids.conversationChat, ids.visitorA, 'chat', 'première question', DAY_1, '12:00')
  await conversation(ids.conversationArchiviste, ids.visitorA, 'archiviste', 'recherche docs', DAY_2, '12:00')
  await conversation(ids.conversationOther, ids.visitorB, 'chat', 'question de B', DAY_2, '13:00')

  const message = (id, conversationId, role, content, language, day, time, extra = {}) => sequelize.query(
    `INSERT INTO messages
       (id, conversation_id, role, content, language, latency_ms, error_code, document_count, created_at)
     VALUES (:id, :conversationId, :role::enum_messages_role, :content, :language,
             :latencyMs, :errorCode, :documentCount, :ts)`,
    {
      replacements: {
        id,
        conversationId,
        role,
        content,
        language,
        latencyMs: extra.latencyMs ?? null,
        errorCode: extra.errorCode ?? null,
        documentCount: extra.documentCount ?? null,
        ts: at(day, time)
      }
    }
  )

  // chat, answered with 2 documents, 👍
  await message(ids.userChat, ids.conversationChat, 'user', 'où est la cafét ?', 'fr', DAY_1, '12:00')
  await message(ids.assistantChat, ids.conversationChat, 'assistant', 'Au premier.', 'fr', DAY_1, '12:01',
    { latencyMs: 1000, documentCount: 2 })

  // archiviste, nothing matched, no rating
  await message(ids.userArchiviste, ids.conversationArchiviste, 'user', 'quantum badge', 'en', DAY_2, '12:00')
  await message(ids.assistantArchiviste, ids.conversationArchiviste, 'assistant', '', 'en', DAY_2, '12:01',
    { latencyMs: 3000, documentCount: 0 })

  // chat, failed generation, no language, 👎
  await message(ids.userOther, ids.conversationOther, 'user', 'et le wifi ?', null, DAY_2, '13:00')
  await message(ids.assistantOther, ids.conversationOther, 'assistant', '', null, DAY_2, '13:01',
    { latencyMs: 5000, errorCode: 'ollama_error', documentCount: 1 })

  const document = (messageId, name, type, score, position) => sequelize.query(
    `INSERT INTO message_documents (message_id, name, type, url, path, score, position)
     VALUES (:messageId, :name, :type::enum_message_documents_type, :url, :path, :score, :position)`,
    {
      replacements: {
        messageId,
        name,
        type,
        url: `/BaseDocumentaire/fr/Notion/${name}.md`,
        path: `/data/${name}.md`,
        score,
        position
      }
    }
  )

  await document(ids.assistantChat, 'Alternance', 'md', 0.95, 0)
  await document(ids.assistantChat, 'Wi-Fi', 'md', 0.91, 1)
  await document(ids.assistantOther, 'Alternance', 'md', 0.93, 0)

  const feedback = (messageId, rating, comment, day, time) => sequelize.query(
    `INSERT INTO message_feedback (message_id, rating, comment, created_at, updated_at)
     VALUES (:messageId, :rating, :comment, :ts, :ts)`,
    { replacements: { messageId, rating, comment, ts: at(day, time) } }
  )

  await feedback(ids.assistantChat, 1, null, DAY_1, '12:05')
  await feedback(ids.assistantOther, -1, 'faux', DAY_2, '13:05')

  await sequelize.query(
    `INSERT INTO events (visitor_id, conversation_id, type, payload, created_at)
     VALUES (:visitorId, :conversationId, 'no_match', :payload::jsonb, :ts)`,
    {
      replacements: {
        visitorId: ids.visitorA,
        conversationId: ids.conversationArchiviste,
        payload: JSON.stringify({ question: 'quantum badge', language: 'en' }),
        ts: at(DAY_2, '12:01')
      }
    }
  )

  return ids
}

module.exports = { seedAnalytics, WINDOW, DAY_1, DAY_2 }

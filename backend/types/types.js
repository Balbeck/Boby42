'use strict'

/**
 * Shared JSDoc typedefs for the backend. No runtime code — this file is never
 * required; it only gives the editor (`jsconfig.json` → `checkJs`) a single
 * place for the result shapes services pass around. Mirrors
 * `frontend/src/types/types.js`. Cover only what exists today; later tasks add
 * to it.
 */

/**
 * One entry selected from a vector store by the retriever: the filename as
 * stored, and a cosine score whose meaning depends on which selector produced
 * it — `searchVectorStore()` / `searchSubjectsPdfStore()` (the /archiviste
 * path) record the score of the *first* embedding that cleared the threshold
 * (per-document early-exit, not the document's best), while `rankStore()` (the
 * /chat path) records the document's *best* embedding score. Only
 * `path.basename(filename)` is used to resolve the file on disk.
 *
 * @typedef {Object} VectorMatch
 * @property {string} filename
 * @property {number} score - cosine similarity, 0–1
 */

/**
 * A retrieved Notion document with its content, as returned by `retrieve()` /
 * the Notion half of `retrieveWithSubjectsPdf()`.
 *
 * @typedef {Object} RetrievedDocument
 * @property {string} name - file basename, e.g. "Wi-Fi.md"
 * @property {string} path - absolute path on disk
 * @property {number} score - cosine similarity, 0–1
 * @property {string} content - raw markdown
 */

/**
 * One display-ready row from `retrieveUnified()` / `POST /chat/documents`,
 * identical in shape to a `POST /archiviste` result row. No content — the
 * generation call reads the language-specific copy itself.
 *
 * @typedef {Object} ChatDocument
 * @property {string} name - extension stripped (`Wi-Fi`, not `Wi-Fi.md`)
 * @property {number} score - cosine similarity, 0–1
 * @property {'md' | 'pdf'} type
 * @property {string} url - ready-to-call GET route (Notion url carries the language)
 */

/**
 * Response body of `POST /chat/documents` (phase 1 of the two-phase `/chat`).
 *
 * @typedef {Object} ChatDocumentsResponse
 * @property {number} count - `documents.length` (Notion + subject PDFs combined)
 * @property {ChatDocument[]} documents - Notion rows first, then PDF rows
 */

/**
 * One source echoed back in a `POST /chat` response. Since the two-phase flow it
 * carries the archiviste-style `type` / `url` too, and `name` has no extension
 * (was `Wi-Fi.md` when `/chat` still used `retrieve()`).
 *
 * @typedef {Object} Source
 * @property {string} name - extension stripped
 * @property {'md' | 'pdf'} type
 * @property {string} [url] - the preview route the client was handed
 * @property {string | null} path - absolute file path: the language copy for `md`, the resolved PDF path for `pdf`
 * @property {number} score - cosine similarity, 0–1
 */

/**
 * Response body of `POST /chat`. The answer is generated from the `md` sources'
 * content; `sources` lists every document (md + pdf) that resolved. When
 * `documents` was supplied in the request those exact rows are re-resolved
 * (no second embedding); otherwise `retrieveUnified()` runs as a one-call
 * fallback.
 *
 * @typedef {Object} ChatResponse
 * @property {string} answer - the LLM answer, or the no-documents fallback text
 * @property {Source[]} sources - resolved documents; `[]` when nothing cleared the threshold / nothing resolved
 * @property {string} [conversationId] - the conversation this exchange was logged under (T4); absent only if the logging write itself failed
 * @property {string} [messageId] - the assistant message UUID, the handle for `POST /feedback`; absent only if the logging write failed
 */

/**
 * One result row in a `POST /archiviste` response. Notion hits are `type: 'md'`
 * (content lazy-fetched from `url`); subject-PDF hits are `type: 'pdf'` (`url`
 * streams the file, never fetched as JSON). `name` has the extension stripped.
 *
 * @typedef {Object} ArchivisteResult
 * @property {string} name
 * @property {number} score - cosine similarity, 0–1
 * @property {'md' | 'pdf'} type
 * @property {string} url - ready-to-call GET route
 */

/**
 * Response body of `POST /archiviste`.
 *
 * @typedef {Object} ArchivisteResponse
 * @property {number} count - `documents.length` (Notion + subject PDFs combined)
 * @property {ArchivisteResult[]} documents
 * @property {string} [conversationId] - the conversation this search was logged under (T4); absent only if the logging write itself failed
 * @property {string} [messageId] - the assistant message UUID, the handle for `POST /feedback`; absent only if the logging write failed
 */

/* ─── Interaction logging (T4) — services/conversation.service.js ─────────── */

/**
 * One document to attach to an assistant message, by reference only (no
 * content). Both `/chat` (from its `sources`) and `/archiviste` (from its
 * result rows) pass `type`, `url` and the resolved on-disk `path`.
 *
 * @typedef {Object} ExchangeDocument
 * @property {string} name
 * @property {'md' | 'pdf'} [type]
 * @property {string} [url]
 * @property {string | null} [path] - absolute file path: the language copy for `md`, the resolved PDF path for `pdf`
 * @property {number} [score] - cosine similarity, 0–1
 */

/**
 * Input to `recordExchange()`.
 *
 * @typedef {Object} RecordExchangeInput
 * @property {string} [anonId] - the visitor's `anon_id`; blank/missing → the synthetic fallback visitor
 * @property {string} [conversationId] - reuse this conversation when it exists and belongs to the same visitor + page; otherwise a new one is created
 * @property {'chat' | 'archiviste'} page
 * @property {string} question
 * @property {string | null} answer - the assistant text; `null` on `/archiviste` and on the error path (stored as `''`)
 * @property {string | null} language
 * @property {ExchangeDocument[]} [documents] - also sets `messages.document_count` (its length; `0` = nothing matched)
 * @property {number} [latencyMs] - elapsed time around the service call
 * @property {string | null} [errorCode] - `'ollama_error'` | `'retrieval_error'` on failure, else `null`
 */

/**
 * Result of `recordExchange()`.
 *
 * @typedef {Object} RecordExchangeResult
 * @property {string} conversationId - the reused or newly-created conversation UUID
 * @property {string} messageId - the assistant message UUID (the `messageId` of the future /feedback contract)
 */

/**
 * Input to `logEvent()`.
 *
 * @typedef {Object} LogEventInput
 * @property {string} [anonId]
 * @property {string} [conversationId]
 * @property {string} type - e.g. `'no_match'`
 * @property {Object} [payload] - JSONB blob
 */

/* ─── /lab db-viz inspector — services/labData.service.js ─────────────────── */

/**
 * One column of an inspected table, straight from `information_schema.columns`.
 *
 * @typedef {Object} LabColumn
 * @property {string} name - the real column name (snake_case)
 * @property {string} type - Postgres `data_type` (or the enum's `udt_name` when `data_type` is `USER-DEFINED`)
 * @property {boolean} nullable
 * @property {boolean} numeric - hint for the grid (right-align, tabular figures)
 */

/**
 * One row of `GET /lab-data/tables` — a whitelisted table with its schema and
 * current size. `users` is never in this list.
 *
 * @typedef {Object} LabTableInfo
 * @property {string} name
 * @property {LabColumn[]} columns
 * @property {number} rowCount
 */

/**
 * Body of `GET /lab-data/tables/:name` — one table's whole contents, newest
 * first, capped at `limit` (default 1000, clamped to [1, 10000]).
 *
 * @typedef {Object} LabTableData
 * @property {string} name
 * @property {LabColumn[]} columns
 * @property {Object[]} rows - the capped slice, ordered by `created_at` (or the pk) DESC
 * @property {number} rowCount - the true total
 * @property {boolean} truncated - `rowCount > rows.length`
 */

/**
 * Body of `GET /lab-data/tree/:conversationId` — one conversation with its whole
 * subtree assembled by foreign key. Not aggregation: every field is a raw row,
 * only lightly nested. The relations explorer renders this directly.
 *
 * @typedef {Object} LabConversationTree
 * @property {Object} conversation - the `conversations` row
 * @property {Object | null} visitor - the owning `visitors` row
 * @property {Array<Object & { documents: Object[], feedback: Object | null }>} messages - `messages` rows in chronological order, each with its `message_documents` (by `position`) and its one `message_feedback`
 * @property {Object[]} events - `events` rows linked to this conversation
 */

/* ─── /lab 🔬 usage dashboard — services/analytics.service.js ─────────────── */

/**
 * Counter-tile figures for one window. `overview` returns two of these — a
 * `range` block for the selected period and an `allTime` block from the same SQL
 * with an unbounded window.
 *
 * @typedef {Object} AnalyticsTotals
 * @property {number} requests - assistant messages in the window
 * @property {number} requestsChat
 * @property {number} requestsArchiviste
 * @property {number} thumbsUp - `message_feedback.rating = 1`
 * @property {number} thumbsDown - `message_feedback.rating = -1`
 * @property {number} noMatch - assistant messages with `document_count = 0`
 * @property {number | null} noMatchRate - `noMatch / requests`; null when `requests = 0`
 * @property {number} activeVisitors - distinct `conversations.visitor_id` with an exchange in the window
 * @property {number} conversations - distinct conversations touched in the window
 * @property {number | null} avgMessagesPerConversation
 * @property {number | null} chatLatencyP50 - ms, `percentile_cont` over chat `latency_ms`
 * @property {number | null} chatLatencyP95 - ms
 * @property {number | null} chatLatencyMax - ms
 */

/**
 * One Paris-local day of a gap-filled series (a day with no traffic is a real
 * `0` row, never a gap).
 *
 * @typedef {Object} DailyVisitorsRow
 * @property {string} day - `YYYY-MM-DD`
 * @property {number} active - distinct visitors with an exchange that day
 * @property {number} new - visitors whose `first_seen_at` is that day
 */

/**
 * @typedef {Object} DailyVolumeRow
 * @property {string} day - `YYYY-MM-DD`
 * @property {number} total - all assistant messages that day
 * @property {number} chat
 * @property {number} archiviste
 * @property {number} noMatch - `document_count = 0` that day
 */

/**
 * @typedef {Object} DailyFeedbackRow
 * @property {string} day - `YYYY-MM-DD`
 * @property {number} up
 * @property {number} down
 */

/**
 * One bar of the retrieval-score histogram (15 fixed 0.01-wide bins over
 * [0.85, 1.00]).
 *
 * @typedef {Object} ScoreHistogramBin
 * @property {number} bucket - 1-based bin index
 * @property {number} lo - inclusive lower edge
 * @property {number} hi - exclusive upper edge
 * @property {number} count - `message_documents` rows in the bin
 */

/**
 * @typedef {Object} TopDocumentRow
 * @property {string} name
 * @property {'md' | 'pdf' | null} type - null on pre-migration rows
 * @property {number} count - times returned in the window
 * @property {number | null} avgScore
 * @property {string} lastUsedAt - ISO timestamp of the most recent use
 */

/**
 * Full body of `GET /analytics/overview`.
 *
 * @typedef {Object} AnalyticsOverview
 * @property {{ from: string, to: string }} window - the resolved window (ISO)
 * @property {{ range: AnalyticsTotals, allTime: AnalyticsTotals }} totals
 * @property {{ visitors: DailyVisitorsRow[], volume: DailyVolumeRow[], feedback: DailyFeedbackRow[] }} daily
 * @property {ScoreHistogramBin[]} scoreHistogram
 * @property {TopDocumentRow[]} topDocuments
 * @property {Array<{ language: string, count: number }>} languages
 * @property {Array<{ code: string, count: number }>} errors - `code = 'ok'` is a NULL `error_code`
 */

/**
 * One row of `GET /analytics/unmatched` — a `no_match` event.
 *
 * @typedef {Object} UnmatchedQuestionRow
 * @property {string} id - the `events.id` (as a string)
 * @property {string | null} question - `payload->>'question'`
 * @property {string | null} language - `payload->>'language'`
 * @property {'chat' | 'archiviste' | null} page - the owning conversation's page (LEFT JOIN; null if unlinked)
 * @property {string} createdAt - ISO timestamp
 */

/**
 * Body of `GET /analytics/unmatched`.
 *
 * @typedef {Object} UnmatchedQuestionsResponse
 * @property {UnmatchedQuestionRow[]} items
 * @property {number} total - rows matching the filter, ignoring limit/offset
 */

/**
 * One row of `GET /analytics/conversations` (the admin-wide list).
 *
 * @typedef {Object} ConversationListRow
 * @property {string} id - conversation UUID
 * @property {'chat' | 'archiviste'} page
 * @property {string} title
 * @property {string} createdAt - ISO
 * @property {string} updatedAt - ISO
 * @property {number} messageCount - all rows (both roles) in the conversation
 * @property {boolean} hasNegativeFeedback - any assistant answer in it rated −1
 */

/**
 * Body of `GET /analytics/conversations`.
 *
 * @typedef {Object} ConversationListResponse
 * @property {ConversationListRow[]} items
 * @property {number} total
 */

module.exports = {}

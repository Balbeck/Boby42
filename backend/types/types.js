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
 * stored, and the score of the *first* embedding that cleared the threshold
 * (per-document early-exit — not the document's best score; see
 * `retriever.service.js`). Only `path.basename(filename)` is used to resolve
 * the file on disk.
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

module.exports = {}

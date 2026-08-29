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
 * One source echoed back in a `POST /chat` response — a `RetrievedDocument`
 * without its `content`.
 *
 * @typedef {Object} Source
 * @property {string} name
 * @property {string} path
 * @property {number} score - cosine similarity, 0–1
 */

/**
 * Response body of `POST /chat`.
 *
 * @typedef {Object} ChatResponse
 * @property {string} answer - the LLM answer, or the no-documents fallback text
 * @property {Source[]} sources - RAG-selected documents; `[]` when nothing cleared the threshold
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
 * content). `/chat` passes its `sources` (`path` set, `url` null); `/archiviste`
 * passes its result rows (`url` set, `path` null).
 *
 * @typedef {Object} ExchangeDocument
 * @property {string} name
 * @property {string} [url]
 * @property {string} [path]
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
 * @property {ExchangeDocument[]} [documents]
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

module.exports = {}

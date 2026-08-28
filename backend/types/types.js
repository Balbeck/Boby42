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
 */

module.exports = {}

'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { cosineSimilarity } = require('../lib/cosine')
const { generateEmbedding } = require('./ollama.service')

const VECTOR_STORE_PATH = path.join(__dirname, '../data/vector_store.json')
const SUBJECTS_PDF_VECTOR_STORE_PATH = path.join(__dirname, '../data/subjectsPdf_vector_store.json')
const DOCUMENTS_ROOT = path.join(__dirname, '../data')

const MAX_DOCS = 5 // max full documents to use as LLM context
const MIN_SCORE = 0.89 // min cosine similarity to keep a result

const MAX_SUBJECTS_PDF_DOCS = 3 // own result budget for the subject-PDF store
const SUBJECTS_PDF_MIN_SCORE = 0.89 // own threshold, same value as MIN_SCORE for now, free to diverge later

/**
 * Resolves a vector store filename (e.g. "/data/documents/Alternance.md")
 * to the actual document path on disk (e.g. "<data>/documents/Notion/Alternance.md").
 * Only the basename is kept, so the exact prefix stored in vector_store.json
 * is irrelevant as long as the filename matches a real file under documents/Notion/.
 *
 * @param {string} filename
 * @returns {string}
 */
function resolveDocumentPath (filename) {
  const basename = path.basename(filename)
  return path.join(DOCUMENTS_ROOT, 'documents', 'Notion', basename)
}

/**
 * Scans the vector store one document at a time and keeps a document as soon
 * as one of its embeddings clears MIN_SCORE (the score kept is that first
 * embedding's score, not the document's best score). Stops once MAX_DOCS
 * documents have been selected.
 *
 * @param {number[]} queryEmbedding
 * @returns {Promise<{filename: string, score: number}[]>}
 */
async function searchVectorStore (queryEmbedding) {
  const raw = await fs.readFile(VECTOR_STORE_PATH, 'utf-8')
  const store = JSON.parse(raw)

  const selected = []

  for (const entry of store) {
    for (const embedding of entry.embeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score >= MIN_SCORE) {
        selected.push({ filename: entry.filename, score })
        break
      }
    }

    if (selected.length >= MAX_DOCS) {
      break
    }
  }

  return selected
}

/**
 * Same per-document early-exit scan as searchVectorStore, but against the
 * subject-PDF store and with its own budget/threshold. Returns { filename,
 * score }[] and reads NO file: a PDF has no text to return, and these entries
 * must never reach resolveDocumentPath()/readDocuments() — they would resolve
 * to documents/Notion/<name>.pdf, fail to open, and be dropped silently.
 *
 * @param {number[]} queryEmbedding
 * @returns {Promise<{filename: string, score: number}[]>}
 */
async function searchSubjectsPdfStore (queryEmbedding) {
  const raw = await fs.readFile(SUBJECTS_PDF_VECTOR_STORE_PATH, 'utf-8')
  const store = JSON.parse(raw)

  const selected = []

  for (const entry of store) {
    for (const embedding of entry.embeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score >= SUBJECTS_PDF_MIN_SCORE) {
        selected.push({ filename: entry.filename, score })
        break
      }
    }

    if (selected.length >= MAX_SUBJECTS_PDF_DOCS) {
      break
    }
  }

  return selected
}

/**
 * Reads the selected documents from disk.
 *
 * @param {{filename: string, score: number}[]} selected
 * @returns {Promise<{name: string, path: string, score: number, content: string}[]>}
 */
async function readDocuments (selected) {
  const documents = []

  for (const result of selected) {
    const fullPath = resolveDocumentPath(result.filename)
    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      documents.push({
        name: path.basename(fullPath),
        path: fullPath,
        score: result.score,
        content
      })
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  return documents
}

/**
 * Finds the documents relevant to a question via RAG (embedding + cosine similarity).
 * Used by /chat — knows only the Notion store, returns documents with content.
 *
 * @param {string} question
 * @returns {Promise<{name: string, path: string, score: number, content: string}[]>}
 */
async function retrieve (question) {
  const queryEmbedding = await generateEmbedding(question)
  const selected = await searchVectorStore(queryEmbedding)
  return readDocuments(selected)
}

/**
 * Retrieval for /archiviste: Notion documents (with content) AND subject-PDF
 * matches (filename + score only, no file read). The question is embedded once
 * and both stores are scanned with that same embedding.
 *
 * @param {string} question
 * @returns {Promise<{
 *   documents: {name: string, path: string, score: number, content: string}[],
 *   subjectsPdf: {filename: string, score: number}[]
 * }>}
 */
async function retrieveWithSubjectsPdf (question) {
  const queryEmbedding = await generateEmbedding(question)
  const [notionSelected, subjectsPdfSelected] = await Promise.all([
    searchVectorStore(queryEmbedding),
    searchSubjectsPdfStore(queryEmbedding)
  ])
  const documents = await readDocuments(notionSelected)
  return { documents, subjectsPdf: subjectsPdfSelected }
}

/**
 * Retrieval for /chat — the one retrieval this page owns. Same selection as
 * retrieveWithSubjectsPdf() (one shared question embedding, both stores, same
 * budgets and thresholds), but it reads no file: the generation call reads the
 * language-specific copy itself. Returns display-ready rows, identical in shape
 * to a POST /archiviste result.
 *
 * Deliberate copy, not a shared helper: /chat must be free to change its
 * retrieval later without any risk for /archiviste (the landing page).
 *
 * @param {string} question
 * @param {'fr' | 'en' | 'origin'} [language='fr'] - only decides the Notion url
 * @returns {Promise<{count: number, documents: import('../types/types').ChatDocument[]}>}
 */
async function retrieveUnified (question, language = 'fr') {
  const queryEmbedding = await generateEmbedding(question)
  const [notionSelected, subjectsPdfSelected] = await Promise.all([
    searchVectorStore(queryEmbedding),
    searchSubjectsPdfStore(queryEmbedding)
  ])

  // Notion rows — url built exactly as routes/archiviste.js does (names contain
  // spaces, e.g. "Visiter le campus.md", so encodeURIComponent is required).
  const notionRows = notionSelected.map(({ filename, score }) => {
    const name = path.basename(filename).replace(/\.md$/, '')
    return {
      name,
      score,
      type: 'md',
      url: `/BaseDocumentaire/${language}/Notion/${encodeURIComponent(name)}.md`
    }
  })

  // Subject PDFs — language-agnostic (subjects are English-only), name drops .pdf.
  const pdfRows = subjectsPdfSelected.map(({ filename, score }) => {
    const base = path.basename(filename)
    return {
      name: base.replace(/\.pdf$/i, ''),
      score,
      type: 'pdf',
      url: `/subjectspdf/${encodeURIComponent(base)}`
    }
  })

  const documents = [...notionRows, ...pdfRows]
  return { count: documents.length, documents }
}

module.exports = { retrieve, retrieveWithSubjectsPdf, retrieveUnified }

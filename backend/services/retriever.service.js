'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { cosineSimilarity } = require('../lib/cosine')
const { generateEmbedding } = require('./ollama.service')

const VECTOR_STORE_PATH = path.join(__dirname, '../data/vector_store.json')
const DOCUMENTS_ROOT = path.join(__dirname, '../data')

const MAX_DOCS = 5 // max full documents to use as LLM context
const MIN_SCORE = 0.89 // min cosine similarity to keep a result

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
 *
 * @param {string} question
 * @returns {Promise<{name: string, path: string, score: number, content: string}[]>}
 */
async function retrieve (question) {
  const queryEmbedding = await generateEmbedding(question)
  const selected = await searchVectorStore(queryEmbedding)
  return readDocuments(selected)
}

module.exports = { retrieve }

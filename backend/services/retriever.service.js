'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { cosineSimilarity } = require('../lib/cosine')
const { generateEmbedding } = require('./ollama.service')

const VECTOR_STORE_PATH = path.join(__dirname, '../data/vector_store.json')
const DOCUMENTS_ROOT = path.join(__dirname, '../data')

const TOP_K = 5 // max results to score
const MAX_DOCS = 2 // max full documents to use as LLM context
const MIN_SCORE = 0.85 // min cosine similarity to keep a result

/**
 * Resolves a vector store filepath (e.g. "/LLMWiki/documents/Wi-Fi/Wi-Fi.md")
 * to the actual document path on disk (e.g. "<data>/documents/Wi-Fi/Wi-Fi.md").
 *
 * @param {string} filepath
 * @returns {string}
 */
function resolveDocumentPath (filepath) {
  const relative = filepath.replace(/^\/?LLMWiki\/?/, '')
  return path.join(DOCUMENTS_ROOT, relative)
}

/**
 * Scores every entry of the vector store against the question embedding
 * and returns the top-k results, sorted by descending score.
 *
 * @param {number[]} queryEmbedding
 * @returns {Promise<{filepath: string, question: string, score: number}[]>}
 */
async function searchVectorStore (queryEmbedding) {
  const raw = await fs.readFile(VECTOR_STORE_PATH, 'utf-8')
  const store = JSON.parse(raw)

  const results = store.map((entry) => ({
    filepath: entry.filepath,
    question: entry.question,
    score: cosineSimilarity(queryEmbedding, entry.embedding)
  }))

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, TOP_K)
}

/**
 * Deduplicates results by filepath and keeps only those above MIN_SCORE,
 * up to MAX_DOCS unique documents.
 *
 * @param {{filepath: string, score: number}[]} results
 * @returns {{filepath: string, score: number}[]}
 */
function selectDocuments (results) {
  const seen = new Set()
  const selected = []

  for (const result of results) {
    if (result.score < MIN_SCORE) {
      break
    }

    if (seen.has(result.filepath)) {
      continue
    }
    seen.add(result.filepath)
    selected.push(result)

    if (selected.length >= MAX_DOCS) {
      break
    }
  }

  return selected
}

/**
 * Reads the selected documents from disk.
 *
 * @param {{filepath: string, score: number}[]} selected
 * @returns {Promise<{name: string, path: string, score: number, content: string}[]>}
 */
async function readDocuments (selected) {
  const documents = []

  for (const result of selected) {
    const fullPath = resolveDocumentPath(result.filepath)
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
  const results = await searchVectorStore(queryEmbedding)
  const selected = selectDocuments(results)
  return readDocuments(selected)
}

module.exports = { retrieve }

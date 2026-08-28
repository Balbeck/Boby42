'use strict'

// Regenerates data/subjectsPdf_vector_store.json from data/subjectsPdfQuestions.json
// by embedding each project PDF's curated strings via Ollama. Separate from
// scripts/generateVectorStore.js on purpose: the project PDF store has its own
// file, its own result budget and its own tuning cycle, and the Notion base must
// never be re-embedded when iterating on project metadata. Run standalone:
//   node scripts/generateSubjectsPdfVectorStore.js
// (needs OLLAMA_BASE_URL / OLLAMA_EMBEDDING_MODEL exported, and Ollama running)
//
// Output is the same shape as data/vector_store.json: an array of
//   { filename, embeddings: number[][] }
// one entry per PDF, one vector per curated string.

const fs = require('node:fs/promises')
const path = require('node:path')
const { generateEmbedding } = require('../services/ollama.service')

const QUESTIONS_PATH = path.join(__dirname, '../data/subjectsPdfQuestions.json')
const VECTOR_STORE_PATH = path.join(__dirname, '../data/subjectsPdf_vector_store.json')

/**
 * Embeds every curated string of a document and returns the store entry for it.
 *
 * @param {{filename: string, metaContexte: string[]}} doc
 * @returns {Promise<{filename: string, embeddings: number[][]}>}
 */
async function indexDocument (doc) {
  const embeddings = []

  for (const question of doc.metaContexte) {
    console.log(`  -> ${question}`)
    const embedding = await generateEmbedding(question)
    embeddings.push(embedding)
  }

  return { filename: doc.filename, embeddings }
}

async function main () {
  const raw = await fs.readFile(QUESTIONS_PATH, 'utf-8')
  const { documents } = JSON.parse(raw)
  console.log(`Found ${documents.length} documents\n`)

  const store = []
  for (const doc of documents) {
    console.log(`Document: ${doc.filename} (${doc.metaContexte.length} questions)`)
    store.push(await indexDocument(doc))
  }

  await fs.writeFile(VECTOR_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  console.log(`\nDone -> ${VECTOR_STORE_PATH}`)
}

main().catch((err) => {
  console.error('Failed to generate subjects PDF vector store:', err)
  process.exit(1)
})

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
//   { filename, embeddings: number[][], texts: string[] }
// one entry per PDF, one vector per curated string, and the string itself at
// the same index (see indexDocument).

const fs = require('node:fs/promises')
const path = require('node:path')
const { generateEmbedding } = require('../services/ollama.service')

// Cosine only needs a handful of significant digits, but JSON.stringify writes
// every float at full float64 width, and `null, 2` puts each one on its own
// indented line. Rounding to EMBEDDING_PRECISION decimals and emitting compact
// JSON takes the subject-PDF store from 138.7 MB to 43.3 MB and the Notion one
// from 42.7 MB to 13.4 MB — which matters because both files are committed and
// GitHub hard-rejects anything over 100 MB. Measured: cosine between a full
// vector and its 6-decimal rounding is 0.999999999957, i.e. identical far
// beyond the 3 decimals any threshold in this codebase compares.
const EMBEDDING_PRECISION = 6

/**
 * Rounds one embedding to EMBEDDING_PRECISION decimals.
 *
 * @param {number[]} embedding
 * @returns {number[]}
 */
function roundEmbedding (embedding) {
  return embedding.map((value) => Number(value.toFixed(EMBEDDING_PRECISION)))
}

const QUESTIONS_PATH = path.join(__dirname, '../data/subjectsPdfQuestions.json')
const VECTOR_STORE_PATH = path.join(__dirname, '../data/subjectsPdf_vector_store.json')

/**
 * Embeds every curated string of a document and returns the store entry for it.
 *
 * `texts` is written by this same loop, so `texts[i]` is by construction the
 * string that produced `embeddings[i]` — the two arrays cannot drift apart.
 * Retrieval needs it: `rankStore()` skips a match coming from a short curated
 * string unless it is near-exact (see retriever.service.js). NEVER rebuild
 * `texts` by zipping the questions file onto an existing store — that contract
 * is only self-consistent when one loop writes both.
 *
 * @param {{filename: string, metaContexte: string[]}} doc
 * @returns {Promise<{filename: string, embeddings: number[][], texts: string[]}>}
 */
async function indexDocument (doc) {
  const embeddings = []
  const texts = []

  for (const question of doc.metaContexte) {
    console.log(`  -> ${question}`)
    const embedding = await generateEmbedding(question)
    embeddings.push(roundEmbedding(embedding))
    texts.push(question)
  }

  return { filename: doc.filename, embeddings, texts }
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

  await fs.writeFile(VECTOR_STORE_PATH, JSON.stringify(store), 'utf-8')
  console.log(`\nDone -> ${VECTOR_STORE_PATH}`)
}

main().catch((err) => {
  console.error('Failed to generate subjects PDF vector store:', err)
  process.exit(1)
})

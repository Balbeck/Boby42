'use strict'

// Query embeddings for the route/retrieval suites, taken from the REAL vector
// stores rather than invented.
//
// Handing back a vector that is already in the store makes its cosine
// similarity with that document exactly 1.000, so the expected top hit is
// deterministic and the real ranking code (rankStore, the margin cut, the
// gate) runs for real. Parsing both stores costs ~250 ms once per test process
// — measured, and cheaper than any fixture store would be to maintain.

const fs = require('node:fs')
const path = require('node:path')

const DATA = path.join(__dirname, '..', '..', 'data')

const STORES = {
  notion: path.join(DATA, 'vector_store.json'),
  subjects: path.join(DATA, 'subjectsPdf_vector_store.json')
}

/** @type {Record<string, {filename: string, embeddings: number[][]}[]>} */
const loaded = {}

/**
 * @param {'notion' | 'subjects'} store
 * @returns {{filename: string, embeddings: number[][]}[]}
 */
function loadStore (store) {
  if (!loaded[store]) loaded[store] = JSON.parse(fs.readFileSync(STORES[store], 'utf-8'))
  return loaded[store]
}

/**
 * One curated string's embedding for a given document — i.e. a query vector
 * that scores 1.000 against it.
 *
 * @param {'notion' | 'subjects'} store
 * @param {string} basename e.g. 'Alternance.md' or 'Libft.en.subject.pdf'
 * @returns {number[]}
 */
function embeddingFor (store, basename) {
  const entry = loadStore(store).find((row) => path.basename(row.filename) === basename)
  if (!entry) throw new Error(`[fixtures] no ${store} store entry for ${basename}`)
  return entry.embeddings[0]
}

/**
 * A vector that matches nothing: cosineSimilarity() returns 0 for a zero
 * vector, which is below both MIN_SCORE thresholds.
 *
 * @param {'notion' | 'subjects'} [store] only to read the real dimension
 * @returns {number[]}
 */
function embeddingMatchingNothing (store = 'notion') {
  return new Array(loadStore(store)[0].embeddings[0].length).fill(0)
}

module.exports = { embeddingFor, embeddingMatchingNothing, loadStore }

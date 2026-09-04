'use strict'

const { describe, it, after } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const {
  retrieve, retrieveWithSubjectsPdf, retrieveUnified, rankStore, gateSubjectsPdf
} = require('../../services/retriever.service')
const { stubOllama, restoreFetch, jsonResponse } = require('../ollamaStub')
const { embeddingFor, embeddingMatchingNothing } = require('../fixtures/embeddings')

after(restoreFetch)

/**
 * Ollama's embeddings endpoint, answering with a fixed vector.
 * @param {number[]} embedding
 */
function stubEmbedding (embedding) {
  return stubOllama({ '/api/embeddings': () => jsonResponse({ embedding }) })
}

/**
 * A store entry with hand-built vectors — 2 dimensions is enough, cosine only
 * cares about direction.
 *
 * @param {string} filename
 * @param {number[][]} embeddings
 */
const entry = (filename, embeddings) => ({ filename, embeddings })

// The unit vector at `deg` degrees; cosine against [1,0] is exactly cos(deg).
const at = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
const QUERY = [1, 0]

// rankStore is the whole of /chat's selection policy. Every one of its steps was
// measured and argued in backend/CLAUDE.md; a silent change to the ORDER of
// those steps still returns plausible-looking documents, just the wrong ones.
describe('rankStore', () => {
  const options = { minScore: 0.89, maxDocs: 5, margin: 0.01 }

  it('scores a document by its BEST embedding, not the first one over the floor', () => {
    // 25° ≈ 0.906 comes first, 10° ≈ 0.985 second: the early-exit scan this
    // replaced would have reported 0.906 and ranked the document on it.
    const store = [entry('/data/documents/A.md', [at(25), at(10)])]
    const [result] = rankStore(QUERY, store, options)
    assert.ok(Math.abs(result.score - Math.cos((10 * Math.PI) / 180)) < 1e-12)
  })

  it('drops documents below minScore', () => {
    const store = [
      entry('/data/documents/Keep.md', [at(10)]),  // ≈ 0.985
      entry('/data/documents/Drop.md', [at(45)])   // ≈ 0.707
    ]
    const names = rankStore(QUERY, store, options).map((r) => r.filename)
    assert.deepStrictEqual(names, ['/data/documents/Keep.md'])
  })

  it('returns an empty array when nothing clears the floor', () => {
    // The no-documents fallback in getAnswer() depends on [] rather than null.
    const ranked = rankStore(QUERY, [entry('/data/documents/A.md', [at(80)])], options)
    assert.deepStrictEqual(ranked, [])
  })

  it('sorts best-first', () => {
    const store = [
      entry('/data/documents/Third.md', [at(24)]),   // ≈ 0.9135
      entry('/data/documents/First.md', [at(5)]),    // ≈ 0.9962
      entry('/data/documents/Second.md', [at(15)])   // ≈ 0.9659
    ]
    const names = rankStore(QUERY, store, { ...options, margin: 1 }).map((r) => path.basename(r.filename))
    assert.deepStrictEqual(names, ['First.md', 'Second.md', 'Third.md'])
  })

  it('cuts everything further than `margin` from the best', () => {
    // best ≈ 0.99619 (5°); 0.99027 (8°) is within 0.01 of it, 0.98481 (10°) is not.
    const store = [
      entry('/data/documents/Best.md', [at(5)]),
      entry('/data/documents/Close.md', [at(8)]),
      entry('/data/documents/Far.md', [at(10)])
    ]
    const names = rankStore(QUERY, store, options).map((r) => path.basename(r.filename))
    assert.deepStrictEqual(names, ['Best.md', 'Close.md'])
  })

  it('caps at maxDocs after the margin cut', () => {
    const store = [0, 1, 2, 3, 4, 5].map((i) => entry(`/data/documents/D${i}.md`, [at(i * 0.1)]))
    assert.strictEqual(rankStore(QUERY, store, { ...options, maxDocs: 3 }).length, 3)
  })

  // The measured-and-rejected rule of L6: a short curated string is often a
  // document's most precise signal. rankStore must stay blind to string length.
  it('is blind to which curated string produced the winning vector', () => {
    const store = [entry('/data/documents/Badge perdu.md', [at(60), at(3)])]
    store[0].texts = ['une phrase longue et descriptive du document', "carte d'accès"]
    const [result] = rankStore(QUERY, store, options)
    assert.ok(result.score > 0.99, 'the short string must be allowed to win')
  })
})

// The /chat gate: subject PDFs are shown only when they outscore the Notion
// result. Flipping the comparison silently puts ML subjects under every
// administrative question — which is exactly the pre-L5 bug.
describe('gateSubjectsPdf', () => {
  const notion = (score) => [{ filename: '/data/documents/Alternance.md', score }]
  const pdf = (score) => [{ filename: '/data/SubjectsPdf/ML/x.pdf', score }]

  it('returns [] when there is no PDF result at all', () => {
    assert.deepStrictEqual(gateSubjectsPdf(notion(0.95), []), [])
  })

  it('keeps the PDFs when nothing matched in Notion', () => {
    const rows = pdf(0.91)
    assert.deepStrictEqual(gateSubjectsPdf([], rows), rows)
  })

  it('keeps the PDFs when they outscore the best Notion row', () => {
    const rows = pdf(0.941)
    assert.deepStrictEqual(gateSubjectsPdf(notion(0.892), rows), rows)
  })

  it('drops the PDFs when Notion scores higher', () => {
    // The narrowest measured case: "qui sont les délégués", 0.948 vs 0.939.
    assert.deepStrictEqual(gateSubjectsPdf(notion(0.948), pdf(0.939)), [])
  })

  it('keeps the PDFs on an exact tie (>=, not >)', () => {
    // Measured real case: "libft" matches Common Core 1.000 AND Libft 1.000.
    const rows = pdf(1)
    assert.deepStrictEqual(gateSubjectsPdf(notion(1), rows), rows)
  })
})

// The three entry points, against the REAL stores with the embedding stubbed.
describe('retrieval entry points', () => {
  it('retrieveUnified returns display rows for the document the query matches', async () => {
    stubEmbedding(embeddingFor('notion', 'Alternance.md'))
    const { count, documents } = await retrieveUnified('alternance', 'fr')

    assert.ok(count >= 1)
    const top = documents[0]
    assert.strictEqual(top.name, 'Alternance')
    assert.strictEqual(top.type, 'md')
    assert.strictEqual(top.url, '/BaseDocumentaire/fr/Notion/Alternance.md')
    assert.ok(top.score > 0.99)
    assert.strictEqual(count, documents.length)
  })

  it('retrieveUnified builds the url from `language` and url-encodes the name', async () => {
    stubEmbedding(embeddingFor('notion', 'Visiter le campus.md'))
    const { documents } = await retrieveUnified('visiter le campus', 'en')
    const row = documents.find((doc) => doc.name === 'Visiter le campus')

    assert.ok(row, 'expected the matched document among the rows')
    // Spaces have to be encoded — the frontend calls this url as-is.
    assert.strictEqual(row.url, '/BaseDocumentaire/en/Notion/Visiter%20le%20campus.md')
  })

  it('retrieveUnified surfaces a subject PDF, name stripped of .pdf, no language segment', async () => {
    stubEmbedding(embeddingFor('subjects', 'Libft.en.subject.pdf'))
    const { documents } = await retrieveUnified('libft', 'fr')
    const row = documents.find((doc) => doc.type === 'pdf')

    assert.ok(row, 'the subject PDF must clear the gate when it scores 1.000')
    assert.strictEqual(row.name, 'Libft.en.subject')
    assert.strictEqual(row.url, '/subjectspdf/Libft.en.subject.pdf')
  })

  it('retrieveUnified returns count 0 when the query matches nothing', async () => {
    stubEmbedding(embeddingMatchingNothing())
    assert.deepStrictEqual(await retrieveUnified('zzz', 'fr'), { count: 0, documents: [] })
  })

  it('retrieveWithSubjectsPdf reads the .md content but never opens a PDF', async () => {
    stubEmbedding(embeddingFor('subjects', 'Libft.en.subject.pdf'))
    const { documents, subjectsPdf } = await retrieveWithSubjectsPdf('libft')

    // Notion documents come back with their content read from disk…
    for (const doc of documents) {
      assert.strictEqual(typeof doc.content, 'string')
      assert.ok(doc.path.includes(path.join('documents', 'Notion')))
    }
    // …subject PDFs carry filename + score only (opening one here would be a bug).
    assert.ok(subjectsPdf.length >= 1)
    for (const row of subjectsPdf) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['filename', 'score'])
    }
  })

  it('retrieve() (the legacy Notion-only path) returns documents with content', async () => {
    stubEmbedding(embeddingFor('notion', 'Alternance.md'))
    const documents = await retrieve('alternance')

    assert.ok(documents.length >= 1)
    assert.strictEqual(documents[0].name, 'Alternance.md')
    assert.ok(documents[0].content.length > 0)
  })

  it('propagates an Ollama failure rather than returning an empty result', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({ error: 'nope' }, 500) })
    await assert.rejects(() => retrieveUnified('alternance', 'fr'), /status 500/)
  })
})

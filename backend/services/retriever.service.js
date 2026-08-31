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

// ── /chat-only selection (see retrieveUnified) ───────────────────────────────
// Keep only what sits within this much of the best-scoring document. The noise
// plateau moves with the question (0.892 on one, 0.927 on another), so no fixed
// MIN_SCORE separates signal from noise; a relative margin is scale-free.
// Measured 2026-08-31 on the 42AI host: 32 documents -> 1 on "qui sont les
// delegues", 20 -> 1 on "alternance", 14 -> 1 on "titres RNCP", 15 -> 1 on
// "systeme de progression", 6 -> 1 on "convention de stage"; multi-document
// questions that were already right keep their documents ("campus le week-end"
// 2, "creer ma startup" 2). 0.02 was measured too and re-admits noise on
// "perdu ma carte" (2 -> 5) — 0.01 is the value the checkpoint kept.
const SCORE_MARGIN = 0.01
// The PDF side needs a MUCH wider margin than the Notion side, and this is the
// constant that was always meant to diverge. Curated subject metadata contains
// the exact project name ("Libft", "Minishell", "machine learning"), so a query
// naming a subject scores a flat 1.000 — and at 0.01 that exact match wipes out
// everything else. Fine when the query IS a project name, wrong when it is a
// topic: "Machine learning" hits "machine learning" in Piscine_Datascience-4 at
// 1.000 and buried the actual ML modules sitting at 0.909 / 0.908 / 0.901.
// Measured 2026-08-31 on the 42AI host, at 0.10: "Machine learning" -> 3 module
// subjects instead of 1 unrelated one, "logistic regression" -> 3, while
// "minishell" / "ft_transcendence" / "philosophers" / "Multilayer perceptron"
// stay at exactly 1 (nothing else clears MIN_SCORE anyway).
//
// Accepted cost: a query that names one subject of a numbered family also shows
// its neighbours — "libft" adds Push_swap and Minitalk (0.929, matched via
// "libft authorized"), "C++ module 05" adds modules 02 and 06 (0.975 / 0.969).
// They are real, adjacent project subjects shown as extra rows, capped at
// MAX_SUBJECTS_PDF_DOCS (3), never text fed to the model. 0.05 was measured and
// is not enough (it leaves "Machine learning" at 1 result); 0.15 is identical to
// 0.10 everywhere, the cap binds first.
const SUBJECTS_PDF_SCORE_MARGIN = 0.10

// Subject-PDF budget for /chat. Its own constant, NOT MAX_SUBJECTS_PDF_DOCS,
// which searchSubjectsPdfStore() and /archiviste use unchanged — /chat gates
// these rows (see below) and /archiviste does not.
const CHAT_MAX_SUBJECTS_PDF_DOCS = 3

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
 * Decides whether /chat shows the subject-PDF rows at all, by comparing the two
 * stores' best scores: PDFs are kept only when their best row scores at least
 * as high as the best Notion row (so always when nothing matched in Notion).
 *
 * Why a comparison and not a threshold: the PDF store holds 19 documents, ALL
 * Machine_Learning (the 29 Old_Common_Core subjects have no entry in
 * subjectsPdfQuestions.json), and half its curated strings are bare keywords
 * (2 264 of 4 475 under 25 chars). So it answers ML questions well and returns
 * pure noise on everything else, at scores that overlap: a real hit can be
 * 0.913 while noise on an administrative question reaches 0.939. No fixed
 * SUBJECTS_PDF_MIN_SCORE separates them, and a margin cannot either — it always
 * keeps the set's best row, which off-topic is itself noise.
 *
 * What DOES separate them is the other store. When the question is
 * administrative the Notion store has a real answer and outscores the PDF
 * noise; when the question is about ML, Notion has nothing (or only noise of
 * its own) and the PDF wins by a wide margin. Measured 2026-08-31 on the 42AI
 * host, 15 questions, correct on all of them:
 *
 *   "Machine learning"        notion —      pdf 1.000  -> shown
 *   "Multilayer perceptron"   notion —      pdf 1.000  -> shown
 *   "data science piscine"    notion —      pdf 0.964  -> shown
 *   "logistic regression"     notion —      pdf 0.926  -> shown
 *   "apprendre le ML"         notion 0.892  pdf 0.941  -> shown
 *   "module de regularisation" notion 0.913 pdf 0.950  -> shown
 *   "qui sont les delegues"   notion 0.948  pdf 0.939  -> hidden
 *   "perdu ma carte"          notion 0.917  pdf 0.905  -> hidden
 *   "systeme de progression"  notion 0.928  pdf 0.909  -> hidden
 *   "alternance"              notion 0.959  pdf 0.916  -> hidden
 *   "convention de stage"     notion 0.942  pdf 0.895  -> hidden
 *   "titres RNCP"             notion 0.983  pdf 0.897  -> hidden
 *
 * Positive on 7/7 ML questions, negative on 6/6 administrative ones; the
 * narrowest case is -0.009 ("delegues"). If one ever flips, the failure is mild
 * — three ML subjects shown next to the right Notion document, i.e. exactly the
 * pre-L5 behaviour. This whole gate is a stopgap: it exists because the PDF
 * store is half-populated and half-curated. Delete it once that is fixed.
 *
 * @param {{filename: string, score: number}[]} notionSelected
 * @param {{filename: string, score: number}[]} pdfSelected
 * @returns {{filename: string, score: number}[]} pdfSelected, or []
 */
function gateSubjectsPdf (notionSelected, pdfSelected) {
  if (pdfSelected.length === 0) return []
  const notionBest = notionSelected.length ? notionSelected[0].score : 0
  return pdfSelected[0].score >= notionBest ? pdfSelected : []
}

/**
 * Ranks a loaded store against a query embedding: each document scores its
 * BEST embedding (not the first one over the threshold), documents below
 * `minScore` are dropped, the rest are sorted descending, everything further
 * than `margin` from the best is cut, and at most `maxDocs` survive.
 *
 * Every curated string counts, whatever its length. Skipping short ones below a
 * high bar was built and measured at L6 and REJECTED: a short string is not
 * only a keyword, it is often a document's most PRECISE string — on "j'ai perdu
 * ma carte", `Badge perdu`'s best signal is "carte d'accès" (13 chars, 0.927)
 * against 0.893 for its best long string, so the rule dropped the right
 * document and the answer switched to the lost-property channel. It changed
 * nothing on 4 of 5 other long questions, because SCORE_MARGIN already removes
 * that noise. Details in backend/CLAUDE.md.
 *
 * Order of operations: best score -> floor -> sort -> margin -> cap. An empty
 * result stays an empty array (the no-documents fallback depends on it).
 *
 * Exhaustive by design - the early-exit scan it replaces saved nothing
 * measurable (0.13 s vs 0.15 s over 1 377 embeddings) because so many
 * documents match anyway; both are dwarfed by parsing the store file.
 *
 * Pure function: takes the already-parsed store, so it can be checked without
 * touching Ollama or the filesystem.
 *
 * @param {number[]} queryEmbedding
 * @param {{filename: string, embeddings: number[][], texts?: string[]}[]} store
 * @param {{minScore: number, maxDocs: number, margin: number}} options
 * @returns {{filename: string, score: number}[]} best-first, never null
 */
function rankStore (queryEmbedding, store, { minScore, maxDocs, margin }) {
  const scored = []

  for (const entry of store) {
    let best = -Infinity
    for (const embedding of entry.embeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score > best) best = score
    }
    if (best >= minScore) {
      scored.push({ filename: entry.filename, score: best })
    }
  }

  if (scored.length === 0) return []

  scored.sort((a, b) => b.score - a.score)

  const cutoff = scored[0].score - margin
  return scored.filter((result) => result.score >= cutoff).slice(0, maxDocs)
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
 * Retrieval for /chat — the one retrieval this page owns. One question
 * embedding, and selection goes through rankStore(): best score per document,
 * floored at MIN_SCORE, ranked globally, cut at SCORE_MARGIN from the best,
 * capped at MAX_DOCS. Subject PDFs go through the same ranking, then through
 * gateSubjectsPdf(): they are shown only when they outscore the Notion result,
 * which is what keeps ML questions working without putting ML subjects under
 * every administrative question. It reads no .md file: the generation call
 * reads the language-specific copy itself. Returns display-ready rows,
 * identical in shape to a POST /archiviste result.
 *
 * /archiviste deliberately keeps the original first-over-threshold, file-order
 * scan (searchVectorStore / searchSubjectsPdfStore, untouched): /chat must be
 * free to change its retrieval without any risk for the landing page.
 *
 * @param {string} question
 * @param {'fr' | 'en' | 'origin'} [language='fr'] - only decides the Notion url
 * @returns {Promise<{count: number, documents: import('../types/types').ChatDocument[]}>}
 */
async function retrieveUnified (question, language = 'fr') {
  const queryEmbedding = await generateEmbedding(question)
  const [notionRaw, subjectsPdfRaw] = await Promise.all([
    fs.readFile(VECTOR_STORE_PATH, 'utf-8'),
    fs.readFile(SUBJECTS_PDF_VECTOR_STORE_PATH, 'utf-8')
  ])

  const notionSelected = rankStore(queryEmbedding, JSON.parse(notionRaw), {
    minScore: MIN_SCORE,
    maxDocs: MAX_DOCS,
    margin: SCORE_MARGIN
  })

  // Ranked first, then gated against the Notion result — see gateSubjectsPdf().
  const subjectsPdfSelected = gateSubjectsPdf(
    notionSelected,
    rankStore(queryEmbedding, JSON.parse(subjectsPdfRaw), {
      minScore: SUBJECTS_PDF_MIN_SCORE,
      maxDocs: CHAT_MAX_SUBJECTS_PDF_DOCS,
      margin: SUBJECTS_PDF_SCORE_MARGIN
    })
  )

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

module.exports = { retrieve, retrieveWithSubjectsPdf, retrieveUnified, rankStore, gateSubjectsPdf }

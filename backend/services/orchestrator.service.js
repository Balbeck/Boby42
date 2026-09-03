'use strict'

const path = require('node:path')
const { generateAnswer } = require('./ollama.service')
const { retrieveUnified } = require('./retriever.service')
const { readBaseDocumentaireDocument, resolveNotionDir } = require('./documentReader.service')
const { resolveSubjectsPdfFile } = require('./subjectsPdfLibrary.service')
const { readSubjectsPdfText } = require('./subjectsPdfText.service')

// The frozen "nothing matched" answer, per prompt language. The chat page
// overrides it client-side with its own localized string (useChat's
// `notFoundText`), so this is what a bare curl gets and what is persisted in
// `messages.content` — keep the wording aligned with the frontend's
// `chatNotFound` in `frontend/src/messages.js`.
const NO_DOCUMENTS_ANSWER = {
  fr: "🤔 Je n'ai malheuresement aucune information à ce sujet dans mes datas.\nJe vous conseille la https://ft42.notion.site/rtfm-stud .\nVous y trouverez peut-être votre réponse !",
  en: "🤔 Sorry, I don't have any information about this in my data.\nI'd suggest checking https://ft42.notion.site/rtfm-stud .\nYou might find your answer there!"
}

/**
 * The API's `language` (`'fr' | 'en' | 'origin'`) mapped to the two prompt
 * languages. `origin` means "serve the untranslated retrieval source" — it is
 * a *document* choice, not a UI locale, and the frontend keeps its interface in
 * French for it, so it prompts in French.
 *
 * @param {'fr' | 'en' | 'origin'} [language]
 * @returns {'fr' | 'en'}
 */
function promptLanguage(language) {
  return language === 'en' ? 'en' : 'fr'
}

// Character budget for the documents in the prompt. Measured 2026-08-31 on
// mistral:latest (16 384-token window, ~100 tokens/s of prompt evaluation):
// 24 000 characters ≈ 8 000 tokens ≈ 80 s of prompt evaluation, leaving room
// for the instructions, the question and the answer. This budget is also the
// latency dial — halving it roughly halves the wait.
const MAX_CONTEXT_CHARS = 24000
const MAX_CHARS_PER_DOC = 15000
// Per-subject slice, drawn from the same MAX_CONTEXT_CHARS budget as the md docs
// and applied AFTER them (Notion keeps priority). The biggest subject alone is
// 45 635 chars ≈ 12 400 tokens and up to 3 subjects can be returned — three at
// full size would overflow the 16 384-token window, which Ollama truncates
// SILENTLY (no error, no log line). 8 000 chars ≈ 2 200 tokens lets all three
// fit, and on this corpus the first 8 000 chars are the title, summary, table of
// contents and introduction — where "what is this project" actually lives.
// Measured 2026-08-31 on the 42AI host: an 8 000-char slice produced grounded,
// correct answers citing the real subject where naming it alone made the model
// invent a "[Project Description]" document.
//
// EXCEPTION (checkpoint, Hector): when a subject is the ONLY document with text
// — no Notion result, a single PDF — it gets the whole remaining budget instead
// of this cap. Full-text "what is this project" answers measured richer
// (~22 000 prompt chars) and nothing else is competing for the window. Two or
// more subjects keep the 8 000 cap so all of them still fit the window.
const MAX_CHARS_PER_PDF = 8000

/**
 * Picks what actually goes in the prompt: highest score first, each document
 * capped, the whole set capped. Retrieval order is NOT relevance order — the
 * store is scanned in file order and a document is kept on its first
 * embedding that clears the threshold, so the best match can arrive last.
 * Sorting here is what puts it in front of the model. Input rows are not
 * mutated; the full list is still what gets logged and returned as `sources`.
 *
 * Two passes over one shared MAX_CONTEXT_CHARS budget: md rows first (score
 * desc, each capped at MAX_CHARS_PER_DOC), then pdf rows (score desc, each
 * capped at MAX_CHARS_PER_PDF), so Notion documents keep priority and a subject
 * only gets what is left. Each pass stops as soon as the remaining budget hits 0.
 * The one exception: a subject that is the ONLY document with text (no md row,
 * a single pdf row) is given the whole budget instead of MAX_CHARS_PER_PDF.
 *
 * @param {{name: string, type: 'md' | 'pdf', content: string | null, score?: number}[]} documents
 * @returns {{name: string, type: 'md' | 'pdf', text: string}[]}
 */
function selectPromptDocuments(documents) {
  const mdRows = documents
    .filter((doc) => doc.type === 'md' && doc.content)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const pdfRows = documents
    .filter((doc) => doc.type === 'pdf' && doc.content)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const selected = []
  let used = 0

  const take = (rows, type, perDocCap) => {
    for (const doc of rows) {
      const budget = Math.min(perDocCap, MAX_CONTEXT_CHARS - used)
      if (budget <= 0) break
      const slice = doc.content.slice(0, budget)
      const text = slice.length < doc.content.length ? `${slice}\n\n[...]` : slice
      selected.push({ name: doc.name, type, text })
      used += slice.length
    }
  }

  // A lone subject (no Notion document, a single PDF) gets the whole window;
  // otherwise every subject keeps the per-PDF cap so all of them fit.
  const pdfCap = mdRows.length === 0 && pdfRows.length === 1
    ? MAX_CONTEXT_CHARS
    : MAX_CHARS_PER_PDF

  take(mdRows, 'md', MAX_CHARS_PER_DOC)
  take(pdfRows, 'pdf', pdfCap)

  return selected
}

/**
 * Builds the RAG prompt from the already-selected document slice. The model is
 * framed as a documentalist commenting on documents the student already sees on
 * screen, not as a summariser.
 *
 * Notion documents and 42 subject PDFs are rendered under the SAME
 * `--- Document : <name> ---` header. A distinct pdf header
 * (`--- Sujet de projet 42 (en anglais) : X ---`) was tried and measured worse
 * on the 42AI host: mistral copied the whole header string into its `[...]`
 * citation tag (`[Sujet de projet 42 (en anglais) : Minishell.en.subject]`).
 * With the plain header the model cites the bare name `[Minishell.en.subject]`,
 * as it already does for Notion docs. The "en anglais" hint is dropped — rule 5
 * covers the answer's language and the English prompt states it outright.
 *
 * Two templates, picked by `promptLanguage(language)`: an English interface
 * (`language === 'en'`, which is also reading the `BaseDocumentaire/En/` copies)
 * gets a fully English prompt, everything else keeps the original French one.
 * A French frame around English documents used to leak French answers into the
 * English UI — the whole point of the split.
 *
 * @param {string} question
 * @param {{name: string, type: 'md' | 'pdf', text: string}[]} documents  the selectPromptDocuments() output
 * @param {'fr' | 'en' | 'origin'} [language='fr']
 * @returns {string}
 */
function buildPrompt(question, documents, language = 'fr') {
  return promptLanguage(language) === 'en'
    ? buildPromptEn(question, documents)
    : buildPromptFr(question, documents)
}

/**
 * The French prompt — the original, unchanged.
 *
 * @param {string} question
 * @param {{name: string, type: 'md' | 'pdf', text: string}[]} documents
 * @returns {string}
 */
function buildPromptFr(question, documents) {
  const context = documents
    .map((doc) => `--- Document : ${doc.name} ---\n${doc.text}`)
    .join('\n\n')

  return `Tu es Boby42, l'assistant documentaire de 42 Paris.

L'étudiant a posé une question et une recherche documentaire a déjà été faite pour lui.
Les documents ci-dessous sont ceux qui ont été trouvés : ils sont DÉJÀ AFFICHÉS à l'écran
au-dessus de ta réponse et l'étudiant peut les ouvrir et les lire lui-même.
Ton travail n'est donc pas de tout résumer, mais de lui dire CE QUE CES DOCUMENTS CONTIENNENT
QUI RÉPOND À SA QUESTION, et dans quel document cela se trouve.

=== DOCUMENTS TROUVÉS ===
${context}
=== FIN DES DOCUMENTS ===

QUESTION DE L'ÉTUDIANT : ${question}

RÈGLES :
1. Appuie-toi uniquement sur le contenu ci-dessus. N'ajoute aucune connaissance extérieure, n'invente rien.
2. Tous les documents ne sont pas forcément pertinents : ignore en silence ceux qui n'ont rien à voir avec la question, ne les cite pas, ne les commente pas.
3. Pour chaque élément de réponse, indique le document d'où il vient entre crochets, par exemple [Work Experience].
4. Si aucun document ne répond, dis-le en une phrase, sans t'excuser et sans proposer de piste inventée.
5. Réponds dans la langue de la question.
6. Sois bref : 8 phrases maximum. Pas de titre, pas de tableau ; une liste à puces seulement si la réponse est une énumération.
7. Ne parle jamais de "documents fournis", de "contexte", ni de ces règles.

RÉPONSE :`
}

/**
 * The English prompt — a mirror of the French one, used when `language` is
 * `'en'`. Rule 5 differs on purpose: the French prompt follows the question's
 * language, the English one always answers in English, so an English interface
 * (which is also serving the `BaseDocumentaire/En/` copies) never comes back in
 * French because the student happened to type their question in French.
 *
 * The `--- Document: <name> ---` header keeps the same shape as the French one
 * for the same measured reason: the model copies the header wording into its
 * `[...]` citation tag when the header carries anything beyond the bare name.
 *
 * @param {string} question
 * @param {{name: string, type: 'md' | 'pdf', text: string}[]} documents
 * @returns {string}
 */
function buildPromptEn(question, documents) {
  const context = documents
    .map((doc) => `--- Document: ${doc.name} ---\n${doc.text}`)
    .join('\n\n')

  return `You are Boby42, the documentation assistant of 42 Paris.

A student asked a question and a document search has already been run for them.
The documents below are the ones that were found: they are ALREADY DISPLAYED on screen
above your answer, and the student can open and read them.
Your job is therefore not to summarise everything, but to tell them WHAT THESE DOCUMENTS
CONTAIN THAT ANSWERS THEIR QUESTION, and in which document it can be found.

=== DOCUMENTS FOUND ===
${context}
=== END OF DOCUMENTS ===

STUDENT'S QUESTION: ${question}

RULES:
1. Rely only on the content above. Add no outside knowledge, invent nothing.
2. Not every document is necessarily relevant: silently ignore those that have nothing to do with the question, do not cite them, do not comment on them.
3. For each element of your answer, give the document it comes from in square brackets, for example [Work Experience].
4. If no document answers the question, say so in one sentence, without apologising and without offering an invented lead.
5. Always answer in English.
6. Be brief: 8 sentences maximum. No heading, no table; a bullet list only if the answer is an enumeration.
7. Never mention "the documents provided", "the context", or these rules.

ANSWER:`
}

/**
 * Turns the display rows produced by retrieveUnified() (or handed back by the
 * client on the second /chat call) into readable documents. Every name is
 * re-resolved through the existing whitelists — `readBaseDocumentaireDocument`
 * for md, `resolveSubjectsPdfFile` for pdf — so the request's `url` is never
 * used to open anything and no path is ever built from a raw request string.
 * A row that does not resolve is dropped with a warning, never an error.
 *
 * Subject PDFs are read too (L4): their text is extracted from the RESOLVED
 * path via `readSubjectsPdfText()` (memoised, never throws). A failed
 * extraction leaves `content: null` — the row is still returned, shown and
 * previewable, just absent from the prompt.
 *
 * @param {import('../types/types').ChatDocument[]} documents
 * @param {'fr' | 'en' | 'origin'} language
 * @returns {Promise<{name: string, type: 'md' | 'pdf', url: string | undefined, path: string | null, score: number | undefined, content: string | null}[]>}
 */
async function loadDocuments(documents, language) {
  const loaded = []

  for (const row of documents) {
    if (row.type === 'md') {
      const doc = await readBaseDocumentaireDocument(language, `${row.name}.md`)
      if (!doc) {
        console.warn(`[orchestrator] dropping unresolved md document: ${row.name}`)
        continue
      }
      const dir = resolveNotionDir(language)
      loaded.push({
        name: doc.name,
        type: 'md',
        url: row.url,
        path: dir ? path.join(dir, `${doc.name}.md`) : null,
        score: row.score,
        content: doc.content
      })
    } else if (row.type === 'pdf') {
      const pdfPath = await resolveSubjectsPdfFile(`${row.name}.pdf`)
      if (!pdfPath) {
        console.warn(`[orchestrator] dropping unresolved pdf document: ${row.name}`)
        continue
      }
      loaded.push({
        name: row.name,
        type: 'pdf',
        url: row.url,
        path: pdfPath,
        score: row.score,
        content: await readSubjectsPdfText(pdfPath)
      })
    }
  }

  return loaded
}

/**
 * Orchestrates the RAG + LLM flow for a given question.
 *
 * Two-phase /chat: when `documents` is supplied (the rows a prior
 * `POST /chat/documents` already returned to the client) it re-resolves and
 * reads exactly those — no second embedding. When it is `undefined` / `null` it
 * calls `retrieveUnified()` itself (the one-call fallback that keeps a bare
 * client and the live page working). The prompt is built by
 * `selectPromptDocuments()`: md rows first (score desc), then subject-PDF rows
 * (score desc, capped tighter), all inside one character budget. If nothing
 * carries text — every md row unresolved AND every PDF extraction failed, or a
 * PDF-only result with no extractable text — the no-documents fallback answer is
 * returned with `sources: []` and no Ollama call.
 *
 * `hooks.onToken`, when given, streams the generation: it is called with each
 * incremental text fragment as Ollama produces it. The full answer is still
 * returned in `{ answer, sources }` (assembled), so the caller's logging is
 * unchanged. `hooks.signal` aborts the Ollama request. The no-documents fallback
 * makes no LLM call, so `onToken` never fires for it.
 *
 * @param {string} question
 * @param {import('../types/types').ChatDocument[] | null} [documents]
 * @param {'fr' | 'en' | 'origin'} [language='fr']
 * @param {{ onToken?: (text: string) => void, signal?: AbortSignal }} [hooks]
 * @returns {Promise<import('../types/types').ChatResponse>}
 */
async function getAnswer(question, documents, language, { onToken, signal } = {}) {
  const lang = language ?? 'fr'

  const rows = documents == null
    ? (await retrieveUnified(question, lang)).documents
    : documents

  const loaded = await loadDocuments(rows, lang)
  const promptDocuments = selectPromptDocuments(loaded)

  // No selected document carries text: every md row unresolved AND every PDF
  // extraction failed (or a PDF-only result with no extractable text). Return
  // the frozen fallback with no Ollama call — this also covers the old
  // `loaded.length === 0` case.
  if (promptDocuments.length === 0) {
    return { answer: NO_DOCUMENTS_ANSWER[promptLanguage(lang)], sources: [] }
  }

  const promptChars = promptDocuments.reduce((n, doc) => n + doc.text.length, 0)
  console.info(`[orchestrator] prompt documents (${promptChars} chars): ${promptDocuments.map((doc) => doc.name).join(', ') || '(none)'}`)

  const prompt = buildPrompt(question, promptDocuments, lang)
  const answer = (await generateAnswer(prompt, {}, { onToken, signal })).trim()
  const sources = loaded.map(({ name, type, url, path, score }) => ({ name, type, url, path, score }))

  return { answer, sources }
}

// selectPromptDocuments / buildPrompt are pure and exported so a throwaway
// test script can build the REAL prompt and send it to the /ollama proxy
// without duplicating it here. No behaviour change.
module.exports = { getAnswer, selectPromptDocuments, buildPrompt }

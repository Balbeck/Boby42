'use strict'

const path = require('node:path')
const { generateAnswer } = require('./ollama.service')
const { retrieveUnified } = require('./retriever.service')
const { readBaseDocumentaireDocument, resolveNotionDir } = require('./documentReader.service')
const { resolveSubjectsPdfFile } = require('./subjectsPdfLibrary.service')

const NO_DOCUMENTS_ANSWER = "🤔 Je n'ai malheuresement aucune information à ce sujet dans mes datas.\nJe vous conseille la https://ft42.notion.site/rtfm-stud .\nVous y trouverez peut-être votre réponse !"

// Character budget for the documents in the prompt. Measured 2026-08-31 on
// mistral:latest (16 384-token window, ~100 tokens/s of prompt evaluation):
// 24 000 characters ≈ 8 000 tokens ≈ 80 s of prompt evaluation, leaving room
// for the instructions, the question and the answer. This budget is also the
// latency dial — halving it roughly halves the wait.
const MAX_CONTEXT_CHARS = 24000
const MAX_CHARS_PER_DOC = 15000

/**
 * Picks what actually goes in the prompt: highest score first, each document
 * capped, the whole set capped. Retrieval order is NOT relevance order — the
 * store is scanned in file order and a document is kept on its first
 * embedding that clears the threshold, so the best match can arrive last.
 * Sorting here is what puts it in front of the model. Input rows are not
 * mutated; the full list is still what gets logged and returned as `sources`.
 *
 * @param {{name: string, type: 'md' | 'pdf', content: string | null, score?: number}[]} documents
 * @returns {{name: string, text: string}[]}
 */
function selectPromptDocuments(documents) {
  const withText = documents
    .filter((doc) => doc.type === 'md' && doc.content)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const selected = []
  let used = 0

  for (const doc of withText) {
    const budget = Math.min(MAX_CHARS_PER_DOC, MAX_CONTEXT_CHARS - used)
    if (budget <= 0) break
    const slice = doc.content.slice(0, budget)
    const text = slice.length < doc.content.length ? `${slice}\n\n[...]` : slice
    selected.push({ name: doc.name, text })
    used += slice.length
  }

  return selected
}

/**
 * Builds the RAG prompt from the already-selected document slice. The model is
 * framed as a documentalist commenting on documents the student already sees on
 * screen, not as a summariser.
 *
 * @param {string} question
 * @param {{name: string, text: string}[]} documents  the selectPromptDocuments() output
 * @param {string[]} subjectNames  names of the type:'pdf' rows (their content is not available)
 * @returns {string}
 */
function buildPrompt(question, documents, subjectNames) {
  const context = documents
    .map((doc) => `--- Document : ${doc.name} ---\n${doc.text}`)
    .join('\n\n')

  const subjects = subjectNames.length
    ? `\nDes sujets de projet 42 ont aussi été trouvés et sont affichés à l'écran : ${subjectNames.join(', ')}.\nTu n'as pas leur contenu : mentionne-les en une phrase seulement s'ils semblent utiles, sans rien affirmer de ce qu'ils contiennent.\n`
    : ''

  return `Tu es Boby42, l'assistant documentaire de 42 Paris.

L'étudiant a posé une question et une recherche documentaire a déjà été faite pour lui.
Les documents ci-dessous sont ceux qui ont été trouvés : ils sont DÉJÀ AFFICHÉS à l'écran
au-dessus de ta réponse et l'étudiant peut les ouvrir et les lire lui-même.
Ton travail n'est donc pas de tout résumer, mais de lui dire CE QUE CES DOCUMENTS CONTIENNENT
QUI RÉPOND À SA QUESTION, et dans quel document cela se trouve.

=== DOCUMENTS TROUVÉS ===
${context}
=== FIN DES DOCUMENTS ===
${subjects}
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
 * Turns the display rows produced by retrieveUnified() (or handed back by the
 * client on the second /chat call) into readable documents. Every name is
 * re-resolved through the existing whitelists — `readBaseDocumentaireDocument`
 * for md, `resolveSubjectsPdfFile` for pdf — so the request's `url` is never
 * used to open anything and no path is ever built from a raw request string.
 * A row that does not resolve is dropped with a warning, never an error.
 *
 * PDFs carry no content in this phase (`content: null`); turning subject PDFs
 * into text is a separate later task.
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
        content: null
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
 * client and the live page working). The prompt is built from the md rows only,
 * sorted by descending score and clipped to a character budget by
 * `selectPromptDocuments()`; PDF rows are named to the model, never read.
 *
 * @param {string} question
 * @param {import('../types/types').ChatDocument[] | null} [documents]
 * @param {'fr' | 'en' | 'origin'} [language='fr']
 * @returns {Promise<import('../types/types').ChatResponse>}
 */
async function getAnswer(question, documents, language) {
  const lang = language ?? 'fr'

  const rows = documents == null
    ? (await retrieveUnified(question, lang)).documents
    : documents

  const loaded = await loadDocuments(rows, lang)

  if (loaded.length === 0) {
    return { answer: NO_DOCUMENTS_ANSWER, sources: [] }
  }

  const promptDocuments = selectPromptDocuments(loaded)
  const subjectNames = loaded.filter((doc) => doc.type === 'pdf').map((doc) => doc.name)
  const promptChars = promptDocuments.reduce((n, doc) => n + doc.text.length, 0)
  console.info(`[orchestrator] prompt documents (${promptChars} chars): ${promptDocuments.map((doc) => doc.name).join(', ') || '(none)'}`)

  const prompt = buildPrompt(question, promptDocuments, subjectNames)
  const answer = (await generateAnswer(prompt)).trim()
  const sources = loaded.map(({ name, type, url, path, score }) => ({ name, type, url, path, score }))

  return { answer, sources }
}

module.exports = { getAnswer }

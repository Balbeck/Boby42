'use strict'

const path = require('node:path')
const { generateAnswer } = require('./ollama.service')
const { retrieveUnified } = require('./retriever.service')
const { readBaseDocumentaireDocument, resolveNotionDir } = require('./documentReader.service')
const { resolveSubjectsPdfFile } = require('./subjectsPdfLibrary.service')

const NO_DOCUMENTS_ANSWER = "🤔 Je n'ai malheuresement aucune information à ce sujet dans mes datas.\nJe vous conseille la https://ft42.notion.site/rtfm-stud .\nVous y trouverez peut-être votre réponse !"

/**
 * Builds the RAG prompt: question + retrieved documents as context.
 *
 * @param {string} question
 * @param {{name: string, content: string}[]} documents
 * @returns {string}
 */
function buildPrompt(question, documents) {
  const context = documents
    .map((doc) => `--- Document : ${doc.name} ---\n${doc.content}`)
    .join('\n\n')

  return `Tu es un assistant qui répond à des questions en t'appuyant exclusivement sur les documents fournis ci-dessous.

=== DOCUMENTS DE RÉFÉRENCE ===
${context}
=== FIN DES DOCUMENTS ===

QUESTION : ${question}

RÈGLES :
1. Base ta réponse uniquement sur le contenu des documents ci-dessus. N'utilise aucune connaissance externe.
2. Si l'information n'est pas présente, réponds exactement : "L'information n'est pas présente dans les documents fournis." Ne devine pas, n'extrapole pas.
3. Sois exhaustif : reprends tous les éléments pertinents des documents qui répondent à la question, sans en omettre.
4. Sois fidèle : ne reformule pas au point de modifier le sens. Cite les passages-clés tels quels entre guillemets si utile.
5. Sois très précis, exhaustif et surtout n'invente rien !

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
 * client and the live page working). The prompt is still built by the unchanged
 * `buildPrompt()`, from the md rows' content only.
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

  const mdDocuments = loaded.filter((doc) => doc.type === 'md')
  const prompt = buildPrompt(question, mdDocuments)
  const answer = await generateAnswer(prompt)
  const sources = loaded.map(({ name, type, url, path, score }) => ({ name, type, url, path, score }))

  return { answer, sources }
}

module.exports = { getAnswer }

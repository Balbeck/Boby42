'use strict'

const { generateAnswer } = require('./ollama.service')
const { retrieve } = require('./retriever.service')

const NO_DOCUMENTS_ANSWER = "🤔 Je n'ai malheuresement aucune information à ce sujet dans mes datas.\nJe vous conseille la https://meta.intra.42.fr/articles/read-the-french-manual-of-42paris.\nVous y trouverez peut-être votre réponse !"

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
 * Orchestrates the RAG + LLM flow for a given question.
 *
 * @param {string} question
 * @returns {Promise<{answer: string, sources: {name: string, path: string, score: number}[]}>}
 */
async function getAnswer(question) {
  const documents = await retrieve(question)

  if (documents.length === 0) {
    return { answer: NO_DOCUMENTS_ANSWER, sources: [] }
  }

  const prompt = buildPrompt(question, documents)
  const answer = await generateAnswer(prompt)
  const sources = documents.map(({ name, path, score }) => ({ name, path, score }))

  return { answer, sources }
}

module.exports = { getAnswer }

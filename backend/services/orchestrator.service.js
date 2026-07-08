'use strict'

const { generateAnswer } = require('./ollama.service')

/**
 * Orchestrates the RAG + LLM flow for a given question.
 * No document retrieval yet: the question is sent to Ollama as-is.
 *
 * @param {string} question
 * @returns {Promise<string>} the LLM answer
 */
async function getAnswer (question) {
  return generateAnswer(question)
}

module.exports = { getAnswer }

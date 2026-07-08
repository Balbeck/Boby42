'use strict'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL
const OLLAMA_GENERATION_MODEL = process.env.OLLAMA_GENERATION_MODEL

/**
 * Asks Ollama to generate an answer to the given prompt.
 *
 * @param {string} prompt
 * @returns {Promise<string>} the generated answer
 */
async function generateAnswer (prompt) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_GENERATION_MODEL,
      prompt,
      stream: false
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`)
  }

  const data = await response.json()
  return data.response
}

module.exports = { generateAnswer }

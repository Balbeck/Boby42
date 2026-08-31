'use strict'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL
const OLLAMA_GENERATION_MODEL = process.env.OLLAMA_GENERATION_MODEL
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL

// The model's Modelfile sets no num_ctx, so without this the window is
// whatever the host's Ollama defaults to (16 384 on Ollama 0.20.3 here,
// 2 048 on older versions) — and an overflowing prompt is truncated silently.
// temperature is low because this is document lookup, not creative writing;
// num_predict bounds the worst case (tested answers stayed under 200 tokens).
const GENERATION_OPTIONS = { num_ctx: 16384, temperature: 0.2, num_predict: 600 }

/**
 * Asks Ollama to generate an answer to the given prompt.
 *
 * @param {string} prompt
 * @param {object} [options]  merged over GENERATION_OPTIONS for this call
 * @returns {Promise<string>} the generated answer
 */
async function generateAnswer(prompt, options = {}) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_GENERATION_MODEL,
      prompt,
      stream: false,
      options: { ...GENERATION_OPTIONS, ...options }
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`)
  }

  const data = await response.json()
  return data.response
}

/**
 * Asks Ollama to turn a text into an embedding vector.
 *
 * @param {string} text
 * @returns {Promise<number[]>} the embedding vector
 */
async function generateEmbedding(text) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBEDDING_MODEL,
      prompt: text
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`)
  }

  const data = await response.json()
  return data.embedding
}

module.exports = { generateAnswer, generateEmbedding }

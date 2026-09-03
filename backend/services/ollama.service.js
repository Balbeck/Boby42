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
 * `fetch` wrapper that tells "Ollama is down" apart from "Ollama answered with
 * an error". undici raises `TypeError('fetch failed')` — with the real socket
 * error on `.cause` (ECONNREFUSED / ENOTFOUND / timeout…) — when nothing is
 * listening at OLLAMA_BASE_URL. We re-throw that as a tagged error so callers
 * (routes) can surface a precise message; a non-ok HTTP response is left alone
 * (Ollama is reachable, just unhappy). An AbortError is passed through untouched.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function ollamaFetch(url, init) {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (err && err.name === 'AbortError') throw err
    const wrapped = new Error(`Ollama is unreachable at ${OLLAMA_BASE_URL} (service down?)`)
    wrapped.code = 'OLLAMA_UNREACHABLE'
    wrapped.cause = err
    throw wrapped
  }
}

/**
 * Asks Ollama to generate an answer to the given prompt.
 *
 * Non-streaming by default. Pass `hooks.onToken` to stream: the request is then
 * made with `stream: true`, `onToken` is called with every incremental text
 * fragment as it arrives, and the fully assembled answer is still returned at
 * the end (so callers that also need the complete string — logging — are
 * unchanged). `hooks.signal` aborts the underlying fetch (used to stop
 * generation when the client disconnects).
 *
 * @param {string} prompt
 * @param {object} [options]  merged over GENERATION_OPTIONS for this call
 * @param {{ onToken?: (text: string) => void, signal?: AbortSignal }} [hooks]
 * @returns {Promise<string>} the generated answer (assembled, when streaming)
 */
async function generateAnswer(prompt, options = {}, { onToken, signal } = {}) {
  const streaming = typeof onToken === 'function'

  const response = await ollamaFetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_GENERATION_MODEL,
      prompt,
      stream: streaming,
      options: { ...GENERATION_OPTIONS, ...options }
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`)
  }

  if (!streaming) {
    const data = await response.json()
    return data.response
  }

  // NDJSON: one JSON object per line, the last with done: true + stats.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (obj.error) throw new Error(`Ollama stream error: ${obj.error}`)
      if (obj.response) {
        full += obj.response
        onToken(obj.response)
      }
    }
  }

  return full
}

/**
 * Asks Ollama to turn a text into an embedding vector.
 *
 * @param {string} text
 * @returns {Promise<number[]>} the embedding vector
 */
async function generateEmbedding(text) {
  const response = await ollamaFetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
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

import { apiUrl } from './http'
import { readNdjson } from './ndjson'

// Transport for the /lab 💬 console — talks straight to the backend's
// `ALL /ollama/*` reverse-proxy, nothing else. The shared key is not baked in
// here: the caller gets it from labApi.ollamaKey() (an authenticated /lab
// session) and passes it on every call as the `x-ollama-key` header.
//
// Two Ollama endpoints are used: GET /api/tags (installed models) and
// POST /api/generate (single-prompt completion). Non-OK upstream statuses are
// surfaced as thrown Errors — unlike labApi, here the caller wants the message,
// so this file keeps its own fetch + error handling (only the NDJSON loop is
// shared, via services/ndjson.js).

/**
 * @param {string} key
 * @returns {Promise<string[]>} installed model names, e.g. ["llama3:latest", …]
 */
export async function listModels(key) {
  const response = await fetch(apiUrl('/ollama/api/tags'), {
    headers: { 'x-ollama-key': key },
  })
  if (!response.ok) {
    throw new Error(`Model list failed (${response.status})`)
  }
  const body = await response.json().catch(() => ({}))
  return (body.models ?? []).map((/** @type {{ name: string }} */ m) => m.name).filter(Boolean)
}

/**
 * POST /ollama/api/generate. Handles both `stream: false` (one JSON object) and
 * `stream: true` (NDJSON) — in the streaming case `onToken` is called with each
 * incremental piece of text as it arrives. The NDJSON reader loop (and its
 * trailing-buffer guard) lives in `services/ndjson.js`, shared with
 * `chatApi.sendMessage`; only the per-object handling below is Ollama-specific.
 *
 * @param {string} key
 * @param {{ model?: string, prompt?: string, stream?: boolean, [key: string]: unknown }} body
 *   the raw Ollama request body ({ model, prompt, options, … })
 * @param {{ signal?: AbortSignal, onToken?: (text: string) => void }} [opts]
 * @returns {Promise<object>} the final Ollama object (last NDJSON line when
 *   streaming) — carries `response` and the timing/eval stats.
 */
export async function generate(key, body, { signal, onToken } = {}) {
  const response = await fetch(apiUrl('/ollama/api/generate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ollama-key': key },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Generation failed (${response.status})`)
  }

  if (!body.stream) {
    return response.json()
  }

  // NDJSON: one JSON object per line, the last with done: true + stats.
  let last = /** @type {any} */ ({})
  let fullText = ''
  await readNdjson(response, (obj) => {
    last = obj
    if (obj.response) {
      fullText += obj.response
      onToken?.(obj.response)
    }
  })

  return { ...last, response: fullText }
}

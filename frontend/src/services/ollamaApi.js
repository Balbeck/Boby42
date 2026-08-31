const API_URL = import.meta.env.VITE_API_URL || ''

// Transport for the /lab 💬 console — talks straight to the backend's
// `ALL /ollama/*` reverse-proxy, nothing else. The shared key is not baked in
// here: the caller gets it from labApi.ollamaKey() (an authenticated /lab
// session) and passes it on every call as the `x-ollama-key` header.
//
// Two Ollama endpoints are used: GET /api/tags (installed models) and
// POST /api/generate (single-prompt completion). Non-OK upstream statuses are
// surfaced as thrown Errors — unlike labApi, here the caller wants the message.

/**
 * @param {string} key
 * @returns {Promise<string[]>} installed model names, e.g. ["llama3:latest", …]
 */
export async function listModels(key) {
  const response = await fetch(`${API_URL}/ollama/api/tags`, {
    headers: { 'x-ollama-key': key },
  })
  if (!response.ok) {
    throw new Error(`Model list failed (${response.status})`)
  }
  const body = await response.json().catch(() => ({}))
  return (body.models ?? []).map((m) => m.name).filter(Boolean)
}

/**
 * POST /ollama/api/generate. Handles both `stream: false` (one JSON object) and
 * `stream: true` (NDJSON) — in the streaming case `onToken` is called with each
 * incremental piece of text as it arrives.
 *
 * @param {string} key
 * @param {object} body  the raw Ollama request body ({ model, prompt, options, … })
 * @param {{ signal?: AbortSignal, onToken?: (text: string) => void }} [opts]
 * @returns {Promise<object>} the final Ollama object (last NDJSON line when
 *   streaming) — carries `response` and the timing/eval stats.
 */
export async function generate(key, body, { signal, onToken } = {}) {
  const response = await fetch(`${API_URL}/ollama/api/generate`, {
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
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let last = {}
  let fullText = ''

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
      last = obj
      if (obj.response) {
        fullText += obj.response
        onToken?.(obj.response)
      }
    }
  }

  return { ...last, response: fullText }
}

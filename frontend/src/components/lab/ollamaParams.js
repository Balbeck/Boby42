// The full set of knobs Ollama's POST /api/generate accepts alongside `prompt`,
// as a flat catalogue the config panel renders from. Nothing here is sent
// unless the user gives it a value — an empty field is omitted so Ollama keeps
// its own default (shown as the placeholder).
//
// `scope` decides where the value lands in the request body:
//   'root'    → body.<name>        (system, template, format, raw, keep_alive, stream)
//   'options' → body.options.<name> (the Modelfile parameters)
//
// `type` drives the input + how the string is coerced before sending:
//   'int' | 'float' → Number(...)      (skipped if NaN)
//   'bool'          → checkbox → true/false
//   'text'          → string as-is
//   'textarea'      → string as-is, multiline
//   'list'          → newline/comma-split → string[]   (stop sequences)
//   'select'        → one of `options` (value coerced by `coerce`)

/** @typedef {{ name: string, label: string, scope: 'root'|'options', type: string, placeholder?: string, help?: string, options?: {value: string, label: string}[], coerce?: 'int' }} OllamaParam */

/** @type {{ id: string, label: string, params: OllamaParam[] }[]} */
export const PARAM_GROUPS = [
  {
    id: 'request',
    label: 'Request',
    params: [
      { name: 'system', label: 'system', scope: 'root', type: 'textarea', placeholder: "override the model's system prompt" },
      { name: 'template', label: 'template', scope: 'root', type: 'textarea', placeholder: "override the model's prompt template" },
      { name: 'format', label: 'format', scope: 'root', type: 'text', placeholder: '"json" or a JSON schema' },
      { name: 'keep_alive', label: 'keep_alive', scope: 'root', type: 'text', placeholder: '5m' },
      { name: 'raw', label: 'raw', scope: 'root', type: 'bool', help: 'no templating — prompt sent as-is' },
      { name: 'stream', label: 'stream', scope: 'root', type: 'bool', help: 'render tokens as they arrive (NDJSON)' },
    ],
  },
  {
    id: 'sampling',
    label: 'Sampling',
    params: [
      { name: 'temperature', label: 'temperature', scope: 'options', type: 'float', placeholder: '0.8' },
      { name: 'top_k', label: 'top_k', scope: 'options', type: 'int', placeholder: '40' },
      { name: 'top_p', label: 'top_p', scope: 'options', type: 'float', placeholder: '0.9' },
      { name: 'min_p', label: 'min_p', scope: 'options', type: 'float', placeholder: '0.0' },
      { name: 'typical_p', label: 'typical_p', scope: 'options', type: 'float', placeholder: '1.0' },
      { name: 'repeat_penalty', label: 'repeat_penalty', scope: 'options', type: 'float', placeholder: '1.1' },
      { name: 'repeat_last_n', label: 'repeat_last_n', scope: 'options', type: 'int', placeholder: '64' },
      { name: 'presence_penalty', label: 'presence_penalty', scope: 'options', type: 'float', placeholder: '0.0' },
      { name: 'frequency_penalty', label: 'frequency_penalty', scope: 'options', type: 'float', placeholder: '0.0' },
      { name: 'penalize_newline', label: 'penalize_newline', scope: 'options', type: 'bool' },
      { name: 'seed', label: 'seed', scope: 'options', type: 'int', placeholder: '0' },
      { name: 'num_predict', label: 'num_predict', scope: 'options', type: 'int', placeholder: '-1 (infinite)' },
      { name: 'stop', label: 'stop', scope: 'options', type: 'list', placeholder: 'one sequence per line' },
    ],
  },
  {
    id: 'mirostat',
    label: 'Mirostat',
    params: [
      {
        name: 'mirostat',
        label: 'mirostat',
        scope: 'options',
        type: 'select',
        coerce: 'int',
        options: [
          { value: '', label: 'default (0 — off)' },
          { value: '0', label: '0 — disabled' },
          { value: '1', label: '1 — Mirostat' },
          { value: '2', label: '2 — Mirostat 2.0' },
        ],
      },
      { name: 'mirostat_tau', label: 'mirostat_tau', scope: 'options', type: 'float', placeholder: '5.0' },
      { name: 'mirostat_eta', label: 'mirostat_eta', scope: 'options', type: 'float', placeholder: '0.1' },
    ],
  },
  {
    id: 'runtime',
    label: 'Context & hardware',
    params: [
      { name: 'num_ctx', label: 'num_ctx', scope: 'options', type: 'int', placeholder: '2048' },
      { name: 'num_batch', label: 'num_batch', scope: 'options', type: 'int', placeholder: '512' },
      { name: 'num_keep', label: 'num_keep', scope: 'options', type: 'int', placeholder: '0' },
      { name: 'num_gpu', label: 'num_gpu', scope: 'options', type: 'int', placeholder: 'layers on GPU' },
      { name: 'main_gpu', label: 'main_gpu', scope: 'options', type: 'int', placeholder: '0' },
      { name: 'num_thread', label: 'num_thread', scope: 'options', type: 'int', placeholder: 'physical cores' },
      { name: 'low_vram', label: 'low_vram', scope: 'options', type: 'bool' },
      { name: 'numa', label: 'numa', scope: 'options', type: 'bool' },
      { name: 'use_mmap', label: 'use_mmap', scope: 'options', type: 'bool' },
      { name: 'use_mlock', label: 'use_mlock', scope: 'options', type: 'bool' },
      { name: 'vocab_only', label: 'vocab_only', scope: 'options', type: 'bool' },
    ],
  },
]

/** Flat list of every param, for lookups. */
export const ALL_PARAMS = PARAM_GROUPS.flatMap((g) => g.params)

/**
 * Fold the raw `{ name: rawValue }` form state into an Ollama request body.
 * Empty / unset fields are dropped so Ollama applies its own defaults.
 *
 * @param {string} model
 * @param {string} prompt
 * @param {Record<string, string | boolean>} values
 * @returns {object}
 */
export function buildRequestBody(model, prompt, values) {
  /** @type {Record<string, unknown>} */
  const body = { model, prompt }
  /** @type {Record<string, unknown>} */
  const options = {}

  for (const param of ALL_PARAMS) {
    const raw = values[param.name]
    const value = coerce(param, raw)
    if (value === undefined) continue
    if (param.scope === 'root') body[param.name] = value
    else options[param.name] = value
  }

  if (Object.keys(options).length > 0) body.options = options
  // stream defaults to false when the user hasn't touched it — we want the
  // simple one-shot response unless it was explicitly turned on.
  if (body.stream === undefined) body.stream = false
  return body
}

/** @param {OllamaParam} param @param {string | boolean | undefined} raw */
function coerce(param, raw) {
  if (param.type === 'bool') return raw === true ? true : undefined // send only when checked
  if (raw === undefined || raw === null || raw === '') return undefined
  switch (param.type) {
    case 'int':
    case 'float': {
      const n = Number(raw)
      return Number.isNaN(n) ? undefined : n
    }
    case 'list': {
      const items = String(raw)
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
      return items.length ? items : undefined
    }
    case 'select':
      return param.coerce === 'int' ? Number(raw) : raw
    default:
      return String(raw)
  }
}

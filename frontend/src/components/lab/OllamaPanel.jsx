// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useCallback, useEffect, useRef, useState } from 'react'
import { generate, listModels } from '../../services/ollamaApi'
import { PARAM_GROUPS, buildRequestBody } from './ollamaParams'

/**
 * The 💬 tab — a bare console straight onto the backend's `ALL /ollama/*`
 * reverse-proxy. Nothing RAG, nothing logged: prompt in, one POST
 * /ollama/api/generate, response out.
 *
 * Like /chat and /archiviste, finished exchanges stack up (question + answer +
 * model/timing line) and the composer below starts a fresh one. The config
 * panel — model dropdown first, then every knob /api/generate takes alongside
 * the prompt — persists across exchanges; empty fields are omitted so Ollama
 * keeps its defaults.
 *
 * `apiKey` is the shared proxy key, handed to this authenticated /lab session by
 * labApi.ollamaKey(); null when the proxy is off or the session lapsed.
 * English-only, like the rest of /lab.
 *
 * @param {{ apiKey: string | null }} props
 */

const INPUT =
  'w-full rounded-md border border-chat-border bg-chat-surface-2 px-2.5 py-1.5 text-sm text-chat-text outline-none placeholder:text-chat-text-muted/50 focus:border-chat-green/60 focus:ring-1 focus:ring-chat-green/30 transition-colors'
const HEADING = 'text-[0.7rem] font-medium uppercase tracking-wider text-chat-text-muted'
const ERR = 'text-[#cf9186]'

export default function OllamaPanel({ apiKey }) {
  const [models, setModels] = useState(null) // null loading | 'error' | string[]
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [values, setValues] = useState(/** @type {Record<string, string | boolean>} */ ({}))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Finished (and the one in-flight) exchanges, oldest first.
  // { id, prompt, model, text, stats, error, done, aborted }
  const [exchanges, setExchanges] = useState(/** @type {any[]} */ ([]))

  const abortRef = useRef(/** @type {AbortController | null} */ (null))
  const promptRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null))

  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    listModels(apiKey)
      .then((names) => {
        if (cancelled) return
        setModels(names)
        setModel((m) => m || names[0] || '')
      })
      .catch(() => !cancelled && setModels('error'))
    return () => {
      cancelled = true
    }
  }, [apiKey])

  // Auto-grow the prompt box (and shrink it back once it clears).
  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [prompt])

  const setValue = useCallback((name, v) => {
    setValues((prev) => ({ ...prev, [name]: v }))
  }, [])

  const canSend = Boolean(apiKey) && !busy && prompt.trim() && model

  const patch = (id, fields) =>
    setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, ...fields } : e)))

  async function submit() {
    if (!canSend) return

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now())
    const body = buildRequestBody(model, prompt, values)

    setExchanges((prev) => [
      ...prev,
      {
        id,
        prompt: prompt.trim(),
        model,
        request: body, // the exact body sent — shown in the per-exchange params drawer
        text: '',
        stats: null,
        error: null,
        done: false,
        aborted: false,
      },
    ])
    setPrompt('')
    setOpen(false) // fold the config panel away on send — cleaner
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const final = await generate(apiKey, body, {
        signal: controller.signal,
        // Streamed tokens accumulate onto whatever text is already there.
        onToken: (t) =>
          setExchanges((prev) =>
            prev.map((e) => (e.id === id ? { ...e, text: e.text + t } : e)),
          ),
      })
      // stream:true already filled `text` via onToken — leave it alone then.
      patch(id, {
        stats: final,
        done: true,
        ...(body.stream ? {} : { text: final.response ?? '' }),
      })
    } catch (err) {
      if (err.name === 'AbortError') patch(id, { done: true, aborted: true })
      else patch(id, { error: err.message || String(err), done: true })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function onPromptKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  if (!apiKey) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className={`text-sm ${ERR}`}>
          Ollama proxy unavailable — <code>OLLAMA_PROXY_KEY</code> is unset on the backend, or
          this session has expired.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <span className={HEADING}>Ollama console</span>
        <span className="text-[0.7rem] text-chat-text-muted/70">
          direct · POST /ollama/api/generate
        </span>
      </div>

      {/* Finished + in-flight exchanges */}
      {exchanges.length > 0 && (
        <div className="flex flex-col gap-4">
          {exchanges.map((ex) => (
            <Exchange key={ex.id} ex={ex} />
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="rounded-2xl border border-chat-border bg-chat-surface p-3 shadow-sm shadow-black/20">
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKeyDown}
          rows={2}
          placeholder="Write your prompt…  (Enter to send, Shift+Enter for a newline)"
          className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-chat-text outline-none placeholder:text-chat-text-muted/50"
        />

        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Toggle request parameters"
            className={`flex h-8 min-w-0 items-center gap-2 rounded-full border border-chat-border pr-2 pl-3 text-xs text-chat-text-muted transition-colors hover:bg-chat-surface-2 hover:text-chat-text ${
              open ? 'bg-chat-surface-2 text-chat-text' : ''
            }`}
          >
            <span className="shrink-0">model</span>
            <span className="truncate font-mono text-chat-text">
              {model || (models === 'error' ? 'set one below' : '…')}
            </span>
            <svg
              viewBox="0 0 20 20"
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </button>

          <div className="flex items-center gap-1.5">
            {busy ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-chat-surface-2 text-chat-text transition-colors hover:bg-chat-border"
              >
                <span className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-chat-green text-chat-bg transition-opacity disabled:opacity-30"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 16V4M5 9l5-5 5 5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Config panel */}
      {open && (
        <div className="card-in flex flex-col gap-5 rounded-2xl border border-chat-border bg-chat-surface p-4">
          <label className="flex flex-col gap-1.5">
            <span className={HEADING}>Model</span>
            {models === 'error' ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3:latest — couldn't reach /api/tags, type a name"
                className={INPUT}
              />
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={models === null}
                className={INPUT}
              >
                {models === null && <option value="">loading…</option>}
                {Array.isArray(models) && models.length === 0 && (
                  <option value="">no models installed</option>
                )}
                {Array.isArray(models) &&
                  models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            )}
          </label>

          {PARAM_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-2.5">
              <span className={HEADING}>{group.label}</span>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                {group.params.map((param) => (
                  <Field
                    key={param.name}
                    param={param}
                    value={values[param.name]}
                    onChange={(v) => setValue(param.name, v)}
                  />
                ))}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setValues({})}
            className="self-start text-xs text-chat-text-muted underline underline-offset-2 hover:text-chat-text"
          >
            Reset parameters
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * One finished (or streaming) exchange: the prompt, then the answer, then a
 * quiet model · timing line. The chevron at the end of that line unfolds — in
 * this same card, on a slightly lighter ground — the request/response params
 * this exchange used.
 *
 * @param {{ ex: any }} props
 */
function Exchange({ ex }) {
  const [showParams, setShowParams] = useState(false)

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-chat-border bg-chat-surface p-4">
      <p className="text-sm whitespace-pre-wrap text-chat-text-muted">
        <span className="mr-1 text-chat-text-muted/50">›</span>
        {ex.prompt}
      </p>
      <div className="border-t border-chat-border pt-2">
        {ex.error ? (
          <p className={`text-sm ${ERR}`}>{ex.error}</p>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-chat-text">
            {ex.text || (
              <span className="text-chat-text-muted">{ex.done ? '(empty response)' : 'generating…'}</span>
            )}
            {ex.aborted && <span className="text-chat-text-muted"> ⏹ stopped</span>}
          </p>
        )}

        <div className="mt-2 flex items-center gap-2 text-xs text-chat-text-muted tabular-nums">
          <span className="min-w-0 truncate">
            <span className="font-mono">{ex.model}</span>
            {fmtStats(ex.stats) && `  ·  ${fmtStats(ex.stats)}`}
          </span>
          <button
            type="button"
            onClick={() => setShowParams((s) => !s)}
            aria-expanded={showParams}
            aria-label="Show request parameters"
            className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-chat-border transition-colors hover:bg-chat-surface-2 hover:text-chat-text ${
              showParams ? 'bg-chat-surface-2 text-chat-text' : ''
            }`}
          >
            <svg
              viewBox="0 0 20 20"
              className={`h-3.5 w-3.5 transition-transform duration-200 ${showParams ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </button>
        </div>

        {showParams && (
          <div className="mt-2 rounded-lg bg-chat-surface-2 p-3">
            <ParamsView request={ex.request} stats={ex.stats} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The request body that was sent (prompt trimmed off — it's shown above) and
 * the response's timing/meta fields (the token stream and the giant `context`
 * array dropped). Two labelled JSON blocks.
 *
 * @param {{ request: any, stats: any }} props
 */
function ParamsView({ request, stats }) {
  const req = { ...(request || {}) }
  delete req.prompt

  const label = 'mb-1 text-[0.65rem] font-medium uppercase tracking-wide text-chat-text-muted'
  const pre =
    'overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-chat-text'

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={label}>request</div>
        <pre className={pre}>{JSON.stringify(req, null, 2)}</pre>
      </div>
      {stats && (
        <div>
          <div className={label}>response</div>
          <pre className={pre}>{JSON.stringify(pickMeta(stats), null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/** Drop the answer text and the multi-thousand-int `context` array. */
function pickMeta(stats) {
  // eslint-disable-next-line no-unused-vars
  const { response, context, ...rest } = stats
  return rest
}

/**
 * One config field. `bool` renders a checkbox row; everything else a labelled
 * input. `textarea` / `list` span both grid columns.
 *
 * @param {{ param: import('./ollamaParams').OllamaParam, value: string | boolean | undefined, onChange: (v: string | boolean) => void }} props
 */
function Field({ param, value, onChange }) {
  if (param.type === 'bool') {
    return (
      <label className="flex items-center gap-2 py-1 text-sm text-chat-text">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-chat-green"
        />
        <span className="font-mono text-xs">{param.label}</span>
        {param.help && <span className="text-[0.7rem] text-chat-text-muted">— {param.help}</span>}
      </label>
    )
  }

  const wide = param.type === 'textarea' || param.type === 'list'

  return (
    <label className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-mono text-xs text-chat-text-muted">{param.label}</span>
      {param.type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={INPUT}>
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : param.type === 'textarea' || param.type === 'list' ? (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={param.placeholder}
          className={`${INPUT} resize-y`}
        />
      ) : (
        <input
          type={param.type === 'int' || param.type === 'float' ? 'number' : 'text'}
          step={param.type === 'float' ? 'any' : undefined}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.placeholder}
          className={INPUT}
        />
      )}
      {param.help && param.type !== 'select' && (
        <span className="text-[0.7rem] text-chat-text-muted">{param.help}</span>
      )}
    </label>
  )
}

/** total_duration / eval_* are nanoseconds. */
function fmtStats(s) {
  if (!s) return null
  const parts = []
  if (s.eval_count && s.eval_duration) {
    parts.push(`${(s.eval_count / (s.eval_duration / 1e9)).toFixed(1)} tok/s`)
    parts.push(`${s.eval_count} tokens`)
  }
  if (s.prompt_eval_count) parts.push(`${s.prompt_eval_count} prompt tokens`)
  if (s.total_duration) parts.push(`${(s.total_duration / 1e9).toFixed(2)} s`)
  return parts.join('  ·  ') || null
}

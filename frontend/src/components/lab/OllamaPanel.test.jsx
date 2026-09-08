import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import OllamaPanel from './OllamaPanel'
import * as ollamaApi from '../../services/ollamaApi'

// The 💬 console. It talks straight to the backend's `/ollama/*` proxy — no RAG,
// no logging — so what matters here is the REQUEST it assembles and the states
// it shows while assembling it:
//
//  - it must not send at all without a key, a model or a prompt (the proxy is
//    the only thing standing between a public tunnel and a shared GPU host);
//  - an unreachable /api/tags must leave the model settable by hand rather than
//    locking the console out;
//  - a stopped generation is a distinct outcome from a failed one.

const MODELS = ['mistral:latest', 'llama3:latest']

/** @type {any} */
let generate
/** @type {any} */
let listModels

beforeEach(() => {
  listModels = vi.spyOn(ollamaApi, 'listModels').mockResolvedValue(MODELS)
  generate = vi.spyOn(ollamaApi, 'generate').mockResolvedValue({ response: 'au 2e étage' })
})
afterEach(() => vi.restoreAllMocks())

/** Renders the panel with a key and waits for the model list. */
async function renderPanel(/** @type {string | null} */ apiKey = 'the-key') {
  const view = render(<OllamaPanel apiKey={apiKey} />)
  if (apiKey) await waitFor(() => expect(listModels).toHaveBeenCalled())
  return view
}

const promptBox = () => screen.getByPlaceholderText(/Write your prompt/)
const sendButton = () => screen.getByRole('button', { name: 'Send' })

/** Types a prompt and sends it. */
async function ask(/** @type {string} */ text = 'où est le wifi') {
  await userEvent.type(promptBox(), text)
  await userEvent.click(sendButton())
}

describe('OllamaPanel — without a key', () => {
  it('says the proxy is unavailable instead of rendering a dead console', async () => {
    // Two causes, one message on purpose: OLLAMA_PROXY_KEY unset on the backend,
    // or the /lab session lapsed. The operator checks both.
    render(<OllamaPanel apiKey={null} />)

    expect(screen.getByText(/Ollama proxy unavailable/)).toBeDefined()
    expect(screen.queryByPlaceholderText(/Write your prompt/)).toBeNull()
  })

  it('asks for no model list at all', () => {
    render(<OllamaPanel apiKey={null} />)
    expect(listModels).not.toHaveBeenCalled()
  })
})

describe('OllamaPanel — the model list', () => {
  it('loads the installed models and preselects the first', async () => {
    await renderPanel()

    expect(listModels).toHaveBeenCalledWith('the-key')
    expect(await screen.findByText('mistral:latest')).toBeDefined()
  })

  it('shows a loading placeholder in the dropdown until they arrive', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    listModels.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<OllamaPanel apiKey="the-key" />)

    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    expect(screen.getByRole('option', { name: 'loading…' })).toBeDefined()
    expect(/** @type {HTMLSelectElement} */ (screen.getAllByRole('combobox')[0]).disabled).toBe(true)

    resolve(MODELS)
    await screen.findByRole('option', { name: 'mistral:latest' })
  })

  it('says so when Ollama has no models installed', async () => {
    listModels.mockResolvedValue([])
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    expect(screen.getByRole('option', { name: 'no models installed' })).toBeDefined()
  })

  it('falls back to a free-text field when /api/tags cannot be reached', async () => {
    // Locking the console behind an empty dropdown would make a broken tags
    // endpoint look like a broken console.
    listModels.mockRejectedValue(new Error('Model list failed (404)'))
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    const field = screen.getByPlaceholderText(/couldn't reach \/api\/tags/)
    expect(field).toBeDefined()
    expect(screen.getByText('set one below')).toBeDefined()

    await userEvent.type(field, 'mistral:latest')
    await userEvent.type(promptBox(), 'q')
    expect(sendButton().hasAttribute('disabled')).toBe(false)
  })

  it('reloads the list when the key arrives late', async () => {
    const { rerender } = render(<OllamaPanel apiKey={null} />)
    expect(listModels).not.toHaveBeenCalled()

    rerender(<OllamaPanel apiKey="the-key" />)
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('the-key'))
  })

  it('ignores a model list that settles after unmount', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    listModels.mockReturnValue(new Promise((r) => { resolve = r }))
    const { unmount } = render(<OllamaPanel apiKey="the-key" />)

    unmount()
    resolve(MODELS)
  })
})

describe('OllamaPanel — sending', () => {
  it('refuses to send an empty prompt', async () => {
    await renderPanel()

    expect(sendButton().hasAttribute('disabled')).toBe(true)
    await userEvent.click(sendButton())
    expect(generate).not.toHaveBeenCalled()
  })

  it('refuses a whitespace-only prompt', async () => {
    await renderPanel()

    await userEvent.type(promptBox(), '   ')
    expect(sendButton().hasAttribute('disabled')).toBe(true)
  })

  it('sends the key, the model and the assembled body', async () => {
    await renderPanel()
    await ask()

    expect(generate).toHaveBeenCalledTimes(1)
    const [key, body] = generate.mock.calls[0]
    expect(key).toBe('the-key')
    expect(body).toMatchObject({ model: 'mistral:latest', prompt: 'où est le wifi', stream: false })
  })

  it('folds the config panel away and clears the prompt on send', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    expect(screen.getByRole('button', { name: 'Toggle request parameters' }).getAttribute('aria-expanded')).toBe('true')

    await ask()

    expect(screen.getByRole('button', { name: 'Toggle request parameters' }).getAttribute('aria-expanded')).toBe('false')
    expect(/** @type {HTMLTextAreaElement} */ (promptBox()).value).toBe('')
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    await renderPanel()

    await userEvent.type(promptBox(), 'une question{Enter}')
    expect(generate).toHaveBeenCalledTimes(1)

    await userEvent.type(promptBox(), 'autre{Shift>}{Enter}{/Shift}')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('carries the config values into the request body', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    await userEvent.type(screen.getByRole('spinbutton', { name: 'temperature' }), '0.2')
    await userEvent.click(screen.getByRole('checkbox', { name: /raw/ }))

    await ask()

    const [, body] = generate.mock.calls[0]
    expect(body.options).toMatchObject({ temperature: 0.2 })
    expect(body.raw).toBe(true)
  })

  it('resets every parameter on demand', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    const temperature = screen.getByRole('spinbutton', { name: 'temperature' })
    await userEvent.type(temperature, '0.2')
    expect(/** @type {HTMLInputElement} */ (temperature).value).toBe('0.2')

    await userEvent.click(screen.getByRole('button', { name: 'Reset parameters' }))
    expect(/** @type {HTMLInputElement} */ (temperature).value).toBe('')
  })

  it('lets the model be changed from the dropdown', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'llama3:latest')
    await ask()

    expect(generate.mock.calls[0][1].model).toBe('llama3:latest')
  })
})

describe('OllamaPanel — the exchanges', () => {
  it('stacks the prompt and the answer, with the model line under it', async () => {
    generate.mockResolvedValue({
      response: 'au 2e étage',
      eval_count: 120,
      eval_duration: 2e9,
      prompt_eval_count: 40,
      total_duration: 3.5e9,
    })
    await renderPanel()
    await ask()

    expect(await screen.findByText('au 2e étage')).toBeDefined()
    expect(screen.getByText(/où est le wifi/)).toBeDefined()
    // Nanoseconds → tok/s and seconds.
    expect(screen.getByText(/60\.0 tok\/s/)).toBeDefined()
    expect(screen.getByText(/120 tokens/)).toBeDefined()
    expect(screen.getByText(/40 prompt tokens/)).toBeDefined()
    expect(screen.getByText(/3\.50 s/)).toBeDefined()
  })

  it('shows only the model when the response carries no timings', async () => {
    await renderPanel()
    await ask()
    await screen.findByText('au 2e étage')

    // Twice on screen: the exchange's model line, and the composer's chip.
    expect(screen.getAllByText('mistral:latest')).toHaveLength(2)
    expect(screen.queryByText(/tok\/s/)).toBeNull()
  })

  it('says "generating…" until the answer lands', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    generate.mockReturnValue(new Promise((r) => { resolve = r }))
    await renderPanel()
    await ask()

    expect(screen.getByText('generating…')).toBeDefined()

    resolve({ response: 'au 2e' })
    expect(await screen.findByText('au 2e')).toBeDefined()
  })

  it('says "(empty response)" rather than showing a blank card', async () => {
    generate.mockResolvedValue({ response: '' })
    await renderPanel()
    await ask()

    expect(await screen.findByText('(empty response)')).toBeDefined()
  })

  it('accumulates streamed tokens and leaves the final text alone', async () => {
    // With `stream: true` the text is already assembled by onToken; overwriting
    // it from `final.response` would double it or blank it.
    generate.mockImplementation(async (
      /** @type {string} */ key,
      /** @type {any} */ body,
      /** @type {any} */ { onToken },
    ) => {
      onToken('au ')
      onToken('2e ')
      onToken('étage')
      return { response: '', done: true, eval_count: 3, eval_duration: 1e9 }
    })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /stream/ }))
    await ask()

    expect(await screen.findByText('au 2e étage')).toBeDefined()
  })

  it('keeps each exchange, oldest first', async () => {
    await renderPanel()
    generate.mockResolvedValue({ response: 'première réponse' })
    await ask('première question')
    await screen.findByText('première réponse')

    generate.mockResolvedValue({ response: 'deuxième réponse' })
    await ask('deuxième question')

    expect(await screen.findByText('deuxième réponse')).toBeDefined()
    expect(screen.getByText('première réponse')).toBeDefined()

    const answers = screen.getAllByText(/réponse$/).map((n) => n.textContent)
    expect(answers).toEqual(['première réponse', 'deuxième réponse'])
  })

  it('shows the upstream error text — that is what makes a model error readable', async () => {
    generate.mockRejectedValue(new Error('model "nope" not found'))
    await renderPanel()
    await ask()

    expect(await screen.findByText('model "nope" not found')).toBeDefined()
  })

  it('falls back to the stringified error when it has no message', async () => {
    generate.mockRejectedValue(new Error(''))
    await renderPanel()
    await ask()

    expect(await screen.findByText(/Error/)).toBeDefined()
  })

  it('marks a stopped generation as stopped, not as failed', async () => {
    /** @type {(r: any) => void} */
    let reject = () => {}
    generate.mockReturnValue(new Promise((_, r) => { reject = r }))
    await renderPanel()
    await ask()

    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    const abort = new Error('aborted')
    abort.name = 'AbortError'
    reject(abort)

    expect(await screen.findByText('⏹ stopped')).toBeDefined()
    expect(screen.queryByText(/aborted/)).toBeNull()
  })

  it('aborts the in-flight request when stopped', async () => {
    /** @type {AbortSignal | undefined} */
    let signal
    /** @type {(v: any) => void} */
    let resolve = () => {}
    generate.mockImplementation(async (
      /** @type {string} */ key,
      /** @type {any} */ body,
      /** @type {any} */ options,
    ) => {
      signal = options.signal
      return new Promise((r) => { resolve = r })
    })
    await renderPanel()
    await ask()
    await waitFor(() => expect(signal).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(signal?.aborted).toBe(true)

    // Awaited: the settle re-renders the exchange, and that update has to land
    // inside act() or the console guard fails the test.
    resolve({ response: 'x' })
    expect(await screen.findByText('x')).toBeDefined()
  })

  it('swaps the send button for stop while busy, and back after', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    generate.mockReturnValue(new Promise((r) => { resolve = r }))
    await renderPanel()
    await ask()

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()

    resolve({ response: 'x' })
    expect(await screen.findByRole('button', { name: 'Send' })).toBeDefined()
  })
})

describe('OllamaPanel — the per-exchange params drawer', () => {
  it('is folded by default and unfolds the request that was sent', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))
    await userEvent.type(screen.getByRole('spinbutton', { name: 'num_ctx' }), '8192')
    await ask()
    await screen.findByText('au 2e étage')

    const toggle = screen.getByRole('button', { name: 'Show request parameters' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(toggle)
    expect(screen.getByText('request')).toBeDefined()
    expect(screen.getByText(/"num_ctx": 8192/)).toBeDefined()
  })

  it('leaves the prompt out of the request block — it is already shown above', async () => {
    await renderPanel()
    await ask('une question bien précise')
    await screen.findByText('au 2e étage')

    await userEvent.click(screen.getByRole('button', { name: 'Show request parameters' }))
    const block = screen.getByText('request').parentElement
    expect(within(/** @type {HTMLElement} */ (block)).queryByText(/une question bien précise/)).toBeNull()
  })

  it('drops the answer text and the giant context array from the response block', async () => {
    // `context` is thousands of ints — printing it would bury the timings that
    // are the whole point of the drawer.
    generate.mockResolvedValue({
      response: 'au 2e étage',
      context: Array.from({ length: 500 }, (_, i) => i),
      eval_count: 12,
      total_duration: 1e9,
    })
    await renderPanel()
    await ask()
    await screen.findByText('au 2e étage')

    await userEvent.click(screen.getByRole('button', { name: 'Show request parameters' }))
    const block = /** @type {HTMLElement} */ (screen.getByText('response').parentElement)

    expect(within(block).getByText(/"eval_count": 12/)).toBeDefined()
    expect(block.textContent).not.toContain('context')
    expect(block.textContent).not.toContain('au 2e étage')
  })

  it('omits the response block entirely when the exchange failed', async () => {
    generate.mockRejectedValue(new Error('boom'))
    await renderPanel()
    await ask()
    await screen.findByText('boom')

    await userEvent.click(screen.getByRole('button', { name: 'Show request parameters' }))
    expect(screen.getByText('request')).toBeDefined()
    expect(screen.queryByText('response')).toBeNull()
  })
})

describe('OllamaPanel — the config fields', () => {
  it('renders every catalogue group', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    for (const label of ['Request', 'Sampling', 'Mirostat', 'Context & hardware']) {
      expect(screen.getByText(label)).toBeDefined()
    }
  })

  it('renders each type with the right control', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    // int / float → a number input; text → a text box; bool → a checkbox;
    // textarea and select get their own controls.
    expect(screen.getByRole('spinbutton', { name: 'num_ctx' }).getAttribute('type')).toBe('number')
    expect(screen.getByRole('spinbutton', { name: 'temperature' }).getAttribute('step')).toBe('any')
    expect(screen.getByRole('textbox', { name: 'keep_alive' }).getAttribute('type')).toBe('text')
    expect(screen.getByRole('checkbox', { name: /low_vram/ })).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'system' }).tagName).toBe('TEXTAREA')
    expect(screen.getByRole('combobox', { name: 'mirostat' })).toBeDefined()
  })

  it('shows the help text next to the field it belongs to', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    expect(screen.getByText(/no templating/)).toBeDefined()
    expect(screen.getByText(/render tokens as they arrive/)).toBeDefined()
  })

  it('offers every mirostat option, defaulting to none', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    const select = screen.getByRole('combobox', { name: 'mirostat' })
    expect(/** @type {HTMLSelectElement} */ (select).value).toBe('')

    await userEvent.selectOptions(select, '2')
    await ask()
    expect(generate.mock.calls[0][1].options.mirostat).toBe(2)
  })

  it('splits a stop list into an array', async () => {
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle request parameters' }))

    await userEvent.type(screen.getByRole('textbox', { name: 'stop' }), '###{Enter}END')
    await ask()

    expect(generate.mock.calls[0][1].options.stop).toEqual(['###', 'END'])
  })
})

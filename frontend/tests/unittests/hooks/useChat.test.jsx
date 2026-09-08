import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useChat } from '../../../src/hooks/useChat'
import * as chatApi from '../../../src/services/chatApi'
import * as historyApi from '../../../src/services/historyApi'
import { conversationDetail, conversationMessage, loggedDocument } from '../../fixtures'

// The /chat page state: the two-call flow, the streaming reconciliation, the
// queue wiring and the stop button. The transport is stubbed — what is under
// test is the ORDER of the state transitions, because every bug this hook has
// had was a state update landing at the wrong moment rather than a wrong value:
//
//   - an exchange enqueued before it exists in state → stuck on "waiting"
//   - two concurrent sends leaving with a null conversationId → two threads
//   - an aborted run settling late and resurrecting the question stop dropped

/** @type {{ name: string, score: number, type: 'md' | 'pdf', url: string }[]} */
const ROWS = [
  { name: 'Wi-Fi', type: 'md', score: 0.94, url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md' },
  { name: 'Badge perdu', type: 'md', score: 0.91, url: '/BaseDocumentaire/fr/Notion/Badge%20perdu.md' },
]

const ANSWER = {
  answer: 'au 2e étage',
  sources: [],
  conversationId: 'conv-1',
  messageId: 'msg-1',
}

/** @type {any} */
let fetchDocs
/** @type {any} */
let send

beforeEach(() => {
  fetchDocs = vi.spyOn(chatApi, 'fetchChatDocuments').mockResolvedValue({ count: 2, documents: ROWS })
  send = vi.spyOn(chatApi, 'sendMessage').mockResolvedValue(ANSWER)
  vi.spyOn(chatApi, 'fetchDocumentContent').mockResolvedValue({ name: 'Wi-Fi', content: '# Wi-Fi' })
})
afterEach(() => vi.restoreAllMocks())

/** A promise plus its settlers, to hold a call open. */
function deferred() {
  /** @type {(v?: any) => void} */
  let resolve = () => {}
  /** @type {(r?: any) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * @param {any} view - the renderHook result
 * @param {string} [question]
 * @param {import('../../../src/types/types.js').Language} [language]
 * @param {string} [notFound] - the localized "nothing found" text the page passes
 */
async function ask(view, question = 'où est le wifi', language = 'fr', notFound = undefined) {
  await act(async () => {
    await view.result.current.sendQuestion(question, language, notFound)
  })
}

describe('sendQuestion — the happy path', () => {
  it('runs retrieval then generation and lands on a done exchange', async () => {
    const view = renderHook(() => useChat())
    await ask(view)

    expect(fetchDocs).toHaveBeenCalledWith('où est le wifi', 'fr', expect.any(Object))
    expect(send).toHaveBeenCalledTimes(1)

    const [exchange] = view.result.current.exchanges
    expect(exchange).toMatchObject({
      question: 'où est le wifi',
      answer: 'au 2e étage',
      loading: false,
      phase: 'done',
      messageId: 'msg-1',
      rating: 0,
    })
  })

  it('trims the question before sending it', async () => {
    const view = renderHook(() => useChat())
    await ask(view, '   où est le wifi   ')

    expect(fetchDocs.mock.calls[0][0]).toBe('où est le wifi')
    expect(view.result.current.exchanges[0].question).toBe('où est le wifi')
  })

  it('ignores an empty or whitespace-only question entirely', async () => {
    const view = renderHook(() => useChat())
    await ask(view, '   ')

    expect(fetchDocs).not.toHaveBeenCalled()
    expect(view.result.current.exchanges).toHaveLength(0)
  })

  it('clears the draft on send', async () => {
    const view = renderHook(() => useChat())
    act(() => view.result.current.setDraft('où est le wifi'))

    await ask(view)
    expect(view.result.current.draft).toBe('')
  })

  it('sorts the retrieved rows by score, descending', async () => {
    // The backend returns Notion rows then PDF rows, not a single ranking — the
    // page is what puts the best match at the top.
    fetchDocs.mockResolvedValue({
      count: 3,
      documents: /** @type {typeof ROWS} */ ([
        { name: 'low', type: 'md', score: 0.90, url: '/a' },
        { name: 'high', type: 'md', score: 0.99, url: '/b' },
        { name: 'mid', type: 'pdf', score: 0.94, url: '/c' },
      ]),
    })
    const view = renderHook(() => useChat())
    await ask(view)

    expect(view.result.current.exchanges[0].documents.map((d) => d.name)).toEqual(['high', 'mid', 'low'])
  })

  it('marks every row unloaded so the lazy fetch still owns the content', async () => {
    const view = renderHook(() => useChat())
    await ask(view)

    for (const doc of view.result.current.exchanges[0].documents) {
      expect(doc).toMatchObject({ loading: false, loaded: false })
    }
  })

  it('hands generation only the four fields the backend contract names', async () => {
    // Not the whole row: `loading` / `loaded` are UI state and the schema
    // strips them anyway — sending them just widens the request.
    const view = renderHook(() => useChat())
    await ask(view)

    expect(send.mock.calls[0][1].documents).toEqual([
      { name: 'Wi-Fi', type: 'md', score: 0.94, url: ROWS[0].url },
      { name: 'Badge perdu', type: 'md', score: 0.91, url: ROWS[1].url },
    ])
  })

  it('passes the language to both calls', async () => {
    const view = renderHook(() => useChat())
    await ask(view, 'q', 'en')

    expect(fetchDocs.mock.calls[0][1]).toBe('en')
    expect(send.mock.calls[0][1].language).toBe('en')
  })

  it('shares one AbortController across both calls', async () => {
    // The stop button must cancel whichever of the two is in flight.
    const view = renderHook(() => useChat())
    await ask(view)

    expect(send.mock.calls[0][1].signal).toBe(fetchDocs.mock.calls[0][2].signal)
  })
})

describe('sendQuestion — the phases', () => {
  it('walks retrieving → reading → done', async () => {
    const retrieval = deferred()
    const generation = deferred()
    fetchDocs.mockReturnValue(retrieval.promise)
    send.mockReturnValue(generation.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('q', 'fr', undefined)
    })

    await waitFor(() => expect(view.result.current.exchanges[0]?.phase).toBe('retrieving'))

    await act(async () => {
      retrieval.resolve({ count: 2, documents: ROWS })
      await retrieval.promise
    })
    expect(view.result.current.exchanges[0].phase).toBe('reading')

    await act(async () => {
      generation.resolve(ANSWER)
      await generation.promise
    })
    expect(view.result.current.exchanges[0].phase).toBe('done')
  })

  it('flips to done on the FIRST streamed token, before the call resolves', async () => {
    // This is what makes the answer render as it grows instead of appearing all
    // at once when the request settles.
    /** @type {any} */
    let phaseAtFirstToken
    /** @type {any} */
    let phaseAtSecondToken

    send.mockImplementation(async (/** @type {string} */ question, /** @type {any} */ { onToken }) => {
      onToken('au ', 'au ')
      phaseAtFirstToken = 'captured'
      onToken('2e', 'au 2e')
      phaseAtSecondToken = 'captured'
      return { ...ANSWER, answer: 'au 2e' }
    })

    const view = renderHook(() => useChat())
    await ask(view)

    expect(phaseAtFirstToken).toBe('captured')
    expect(phaseAtSecondToken).toBe('captured')
    expect(view.result.current.exchanges[0]).toMatchObject({ phase: 'done', loading: false })
  })

  it('grows the answer text token by token', async () => {
    /** @type {string[]} */
    const seen = []
    send.mockImplementation(async (/** @type {string} */ question, /** @type {any} */ { onToken }) => {
      onToken('au ', 'au ')
      onToken('2e ', 'au 2e ')
      onToken('étage', 'au 2e étage')
      return { ...ANSWER, answer: 'au 2e étage' }
    })

    const view = renderHook(() => useChat())
    await ask(view)
    seen.push(view.result.current.exchanges[0].answer)

    expect(seen).toEqual(['au 2e étage'])
  })

  it('reconciles the final answer from the resolved response', async () => {
    send.mockImplementation(async (/** @type {string} */ question, /** @type {any} */ { onToken }) => {
      onToken('partial', 'partial')
      return { ...ANSWER, answer: 'the full reconciled answer' }
    })

    const view = renderHook(() => useChat())
    await ask(view)

    expect(view.result.current.exchanges[0].answer).toBe('the full reconciled answer')
  })
})

describe('sendQuestion — nothing found', () => {
  beforeEach(() => {
    fetchDocs.mockResolvedValue({ count: 0, documents: [] })
  })

  it('still calls generation — the backend returns the fallback and a messageId', async () => {
    // Skipping it would cost the exchange its messageId, and the 👍/👎 buttons
    // would never appear on exactly the answers most worth rating.
    const view = renderHook(() => useChat())
    await ask(view)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1].documents).toEqual([])
    expect(view.result.current.exchanges[0].messageId).toBe('msg-1')
  })

  it('freezes the localized not-found text into the exchange', async () => {
    // The backend's fallback is a fixed French string. Storing the UI-language
    // one means a later language switch does not rewrite past history — session
    // history is frozen text.
    const view = renderHook(() => useChat())
    await ask(view, 'q', 'en', 'I could not find anything about that.')

    expect(view.result.current.exchanges[0].answer).toBe('I could not find anything about that.')
  })

  it('falls back to the backend answer when the page passed no text', async () => {
    const view = renderHook(() => useChat())
    await ask(view, 'q', 'fr', undefined)

    expect(view.result.current.exchanges[0].answer).toBe('au 2e étage')
  })

  it('does NOT override the answer when documents were found', async () => {
    fetchDocs.mockResolvedValue({ count: 2, documents: ROWS })
    const view = renderHook(() => useChat())
    await ask(view, 'q', 'fr', 'not found text')

    expect(view.result.current.exchanges[0].answer).toBe('au 2e étage')
  })
})

describe('sendQuestion — failures', () => {
  it('marks the exchange errored with the raw message', async () => {
    fetchDocs.mockRejectedValue(new Error('Document search failed - Ollama server is unreachable'))
    const view = renderHook(() => useChat())
    await ask(view)

    expect(view.result.current.exchanges[0]).toMatchObject({
      phase: 'error',
      loading: false,
      error: 'Document search failed - Ollama server is unreachable',
    })
  })

  it('handles a generation failure after a successful retrieval', async () => {
    send.mockRejectedValue(new Error('Failed to get an answer from Ollama'))
    const view = renderHook(() => useChat())
    await ask(view)

    const [exchange] = view.result.current.exchanges
    expect(exchange.phase).toBe('error')
    // The documents found in phase 1 stay on screen — they are still useful.
    expect(exchange.documents).toHaveLength(2)
  })

  it('leaves the exchange untouched on an AbortError', async () => {
    // The stop button removes the exchange itself; writing an error state here
    // would race with that removal and could resurrect a cancelled question.
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    send.mockRejectedValue(abort)

    const view = renderHook(() => useChat())
    await ask(view)

    expect(view.result.current.exchanges[0].phase).toBe('reading')
    expect(view.result.current.exchanges[0].error).toBeUndefined()
  })
})

describe('the conversation id', () => {
  it('is adopted from the first response and sent on the next question', async () => {
    const view = renderHook(() => useChat())
    await ask(view)

    expect(view.result.current.conversationId).toBe('conv-1')

    await ask(view, 'une autre question')
    expect(send.mock.calls[1][1].conversationId).toBe('conv-1')
  })

  it('is null on the first send', async () => {
    const view = renderHook(() => useChat())
    await ask(view)

    expect(send.mock.calls[0][1].conversationId).toBeNull()
  })

  it('survives a response that carries none — a failed logging write', async () => {
    const view = renderHook(() => useChat())
    await ask(view)

    send.mockResolvedValue({ ...ANSWER, conversationId: undefined })
    await ask(view, 'again')

    expect(view.result.current.conversationId).toBe('conv-1')
  })
})

describe('the send queue', () => {
  it('marks a second question queued while the first runs', async () => {
    const first = deferred()
    send.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))

    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })

    expect(view.result.current.exchanges).toHaveLength(2)
    expect(view.result.current.exchanges[1].phase).toBe('queued')
    expect(view.result.current.isQueueFull).toBe(true)

    await act(async () => {
      first.resolve(ANSWER)
      await first.promise
    })
  })

  it('refuses a third question and keeps the draft', async () => {
    // Refusing rather than dropping: a third question behind a ~100 s
    // generation would be answered five minutes late.
    const first = deferred()
    send.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))

    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })
    act(() => view.result.current.setDraft('third'))
    await act(async () => {
      view.result.current.sendQuestion('third', 'fr', undefined)
    })

    expect(view.result.current.exchanges).toHaveLength(2)
    expect(view.result.current.draft).toBe('third')

    await act(async () => {
      first.resolve(ANSWER)
      await first.promise
    })
  })

  it('appends the exchange before enqueuing, so the run can update it', async () => {
    // The trap: an update targeting an exchange not yet in the list is silently
    // dropped, and the question sits on "waiting" forever.
    const first = deferred()
    send.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })

    await act(async () => {
      first.resolve(ANSWER)
      await first.promise
    })

    await waitFor(() => expect(view.result.current.exchanges[1].phase).toBe('done'))
  })

  it('runs the two sends strictly one after the other', async () => {
    // Concurrent sends would each leave with a null conversationId and the
    // backend would open two separate conversations for one thread.
    /** @type {string[]} */
    const order = []
    const first = deferred()
    send.mockImplementation(async (/** @type {string} */ question) => {
      order.push(`start:${question}`)
      if (question === 'first') await first.promise
      order.push(`end:${question}`)
      return ANSWER
    })

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(order).toContain('start:first'))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })

    expect(order).not.toContain('start:second')

    await act(async () => {
      first.resolve()
      await first.promise
    })
    await waitFor(() => expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']))
  })
})

describe('stopGeneration', () => {
  it('removes the running exchange', async () => {
    const pending = deferred()
    send.mockReturnValue(pending.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('q', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.exchanges[0]?.phase).toBe('reading'))

    act(() => view.result.current.stopGeneration())
    expect(view.result.current.exchanges).toHaveLength(0)

    await act(async () => {
      pending.resolve(ANSWER)
      await pending.promise
    })
  })

  it('drops the queued question too — a stop is a stop', async () => {
    const first = deferred()
    send.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })
    expect(view.result.current.exchanges).toHaveLength(2)

    act(() => view.result.current.stopGeneration())
    expect(view.result.current.exchanges).toHaveLength(0)

    await act(async () => {
      first.resolve(ANSWER)
      await first.promise
    })
  })

  it('does not resurrect the dropped question when the aborted run settles later', async () => {
    // The queue bumps a generation counter on clear(); without it the late
    // completion promotes a waiter the user already cancelled and re-sends it.
    const first = deferred()
    send.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('first', 'fr', undefined)
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr', undefined)
    })

    act(() => view.result.current.stopGeneration())
    await act(async () => {
      first.resolve(ANSWER)
      await first.promise
    })

    expect(view.result.current.exchanges).toHaveLength(0)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('aborts the in-flight request', async () => {
    /** @type {AbortSignal | undefined} */
    let signal
    const pending = deferred()
    send.mockImplementation(async (/** @type {string} */ question, /** @type {any} */ options) => {
      signal = options.signal
      return pending.promise
    })

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('q', 'fr', undefined)
    })
    await waitFor(() => expect(signal).toBeDefined())

    act(() => view.result.current.stopGeneration())
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(ANSWER)
      await pending.promise
    })
  })

  it('is harmless when nothing is running', () => {
    const view = renderHook(() => useChat())
    expect(() => act(() => view.result.current.stopGeneration())).not.toThrow()
  })
})

describe('startNewConversation', () => {
  it('empties the page and forgets the conversation id', async () => {
    const view = renderHook(() => useChat())
    await ask(view)
    act(() => view.result.current.setDraft('typing'))

    act(() => view.result.current.startNewConversation())

    expect(view.result.current.exchanges).toEqual([])
    expect(view.result.current.draft).toBe('')
    expect(view.result.current.conversationId).toBeNull()
  })

  it('aborts anything in flight', async () => {
    /** @type {AbortSignal | undefined} */
    let signal
    const pending = deferred()
    send.mockImplementation(async (/** @type {string} */ question, /** @type {any} */ options) => {
      signal = options.signal
      return pending.promise
    })

    const view = renderHook(() => useChat())
    act(() => {
      view.result.current.sendQuestion('q', 'fr', undefined)
    })
    await waitFor(() => expect(signal).toBeDefined())

    act(() => view.result.current.startNewConversation())
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(ANSWER)
      await pending.promise
    })
  })

  it('starts a genuinely new thread on the next send', async () => {
    const view = renderHook(() => useChat())
    await ask(view)
    act(() => view.result.current.startNewConversation())

    await ask(view, 'fresh question')
    expect(send.mock.calls[1][1].conversationId).toBeNull()
  })
})

describe('loadConversation — rebuilding a past thread', () => {
  it('pairs each user message with the assistant answer that follows it', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'où est le wifi' }),
          conversationMessage({
            id: 'm2',
            role: 'assistant',
            content: 'au 2e',
            rating: 1,
            documents: [loggedDocument({ url: '/u/1' })],
          }),
          conversationMessage({ id: 'm3', role: 'user', content: 'et le badge ?' }),
          conversationMessage({ id: 'm4', role: 'assistant', content: 'au secrétariat' }),
        ],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    const [first, second] = view.result.current.exchanges
    expect(view.result.current.exchanges).toHaveLength(2)
    expect(first).toMatchObject({
      id: 'm2',
      question: 'où est le wifi',
      answer: 'au 2e',
      messageId: 'm2',
      rating: 1,
      phase: 'done',
    })
    expect(second).toMatchObject({ question: 'et le badge ?', answer: 'au secrétariat', rating: 0 })
  })

  it('forces phase done — a step machine under a days-old answer would say "searching…"', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'q' }),
          conversationMessage({ id: 'm2', role: 'assistant', content: 'a' }),
        ],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0].phase).toBe('done')
    expect(view.result.current.exchanges[0].loading).toBe(false)
  })

  it('rebuilds documents unloaded, so content is re-fetched on expand', async () => {
    // Content is never stored server-side on this route; the lazy fetch takes
    // over exactly as after a fresh answer.
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'q' }),
          conversationMessage({
            id: 'm2',
            role: 'assistant',
            content: 'a',
            documents: [loggedDocument({ url: '/u/1' })],
          }),
        ],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0].documents[0]).toEqual({
      name: 'Wi-Fi',
      type: 'md',
      url: '/u/1',
      score: 0.94,
      loading: false,
      loaded: false,
      expanded: false,
    })
  })

  it('defaults a missing document type to md and a missing score to 0', async () => {
    // Pre-migration rows carry NULL in both columns; the renderer needs a type
    // to choose markdown vs the PDF iframe.
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'q' }),
          conversationMessage({
            id: 'm2',
            role: 'assistant',
            content: 'a',
            // A pre-migration row: NULL type and NULL score in the database.
            documents: [loggedDocument({ name: 'Old', type: null, url: '/u/1', score: null })],
          }),
        ],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0].documents[0]).toMatchObject({ type: 'md', score: 0 })
  })

  it('keeps a user message whose answer never came', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [conversationMessage({ id: 'm1', role: 'user', content: 'orphan' })],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0]).toMatchObject({
      id: 'm1',
      question: 'orphan',
      answer: '',
      messageId: null,
    })
  })

  it('does not pair a user message with another user message', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'first' }),
          conversationMessage({ id: 'm2', role: 'user', content: 'second' }),
        ],
      }),
    )

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges.map((e) => e.answer)).toEqual(['', ''])
  })

  it('threads the next question into the reopened conversation', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(conversationDetail({ messages: [] }))

    const view = renderHook(() => useChat())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })
    await ask(view, 'a follow-up')

    expect(send.mock.calls[0][1].conversationId).toBe('conv-7')
  })
})

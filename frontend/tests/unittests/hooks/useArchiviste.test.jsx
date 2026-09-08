import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useArchiviste } from '../../../src/hooks/useArchiviste'
import * as archivisteApi from '../../../src/services/archivisteApi'
import * as historyApi from '../../../src/services/historyApi'
import { conversationDetail, conversationMessage, documentRow, loggedDocument } from '../../fixtures'

// The /archiviste page state. It mirrors useChat's structure but on a SINGLE
// call and with no `phase` — waiting is a plain `queued` boolean here. That
// divergence is deliberate (the two pages must be able to evolve their
// retrieval independently), so this suite deliberately re-tests the same
// behaviours rather than sharing a parameterised one with useChat: a shared
// suite would quietly push the two hooks back together.

const ROWS = [
  documentRow(),
  documentRow({ name: 'libft', type: 'pdf', score: 0.91, url: '/subjectspdf/libft.pdf' }),
]

const RESPONSE = { count: 2, documents: ROWS, conversationId: 'conv-1', messageId: 'msg-1' }

/** @type {any} */
let search

beforeEach(() => {
  search = vi.spyOn(archivisteApi, 'search').mockResolvedValue(RESPONSE)
  vi.spyOn(archivisteApi, 'fetchDocument').mockResolvedValue({ name: 'Wi-Fi', content: '# Wi-Fi' })
})
afterEach(() => vi.restoreAllMocks())

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

/** @param {any} view */
async function ask(view, question = 'où est le wifi', language = 'fr') {
  await act(async () => {
    await view.result.current.sendQuestion(question, language)
  })
}

describe('sendQuestion', () => {
  it('searches and lands on a finished exchange', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect(search).toHaveBeenCalledWith('où est le wifi', 'fr', {
      signal: expect.any(AbortSignal),
      conversationId: null,
    })

    expect(view.result.current.exchanges[0]).toMatchObject({
      question: 'où est le wifi',
      loading: false,
      messageId: 'msg-1',
      rating: 0,
    })
  })

  it('carries no `phase` — this page has none', async () => {
    // /chat drives a guided step machine off `phase`; /archiviste shows a list.
    // Adding one here would be the first step back to a single merged hook.
    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect('phase' in view.result.current.exchanges[0]).toBe(false)
  })

  it('trims the question and ignores an empty one', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view, '  des documents  ')
    expect(search.mock.calls[0][0]).toBe('des documents')

    await ask(view, '   ')
    expect(search).toHaveBeenCalledTimes(1)
    expect(view.result.current.exchanges).toHaveLength(1)
  })

  it('clears the draft on send', async () => {
    const view = renderHook(() => useArchiviste())
    act(() => view.result.current.setDraft('typing'))

    await ask(view)
    expect(view.result.current.draft).toBe('')
  })

  it('sorts the merged Notion and PDF rows by score', async () => {
    search.mockResolvedValue({
      ...RESPONSE,
      documents: [
        documentRow({ name: 'low', score: 0.90, url: '/a' }),
        documentRow({ name: 'high', type: 'pdf', score: 0.99, url: '/b' }),
        documentRow({ name: 'mid', score: 0.94, url: '/c' }),
      ],
    })
    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect(view.result.current.exchanges[0].documents.map((d) => d.name)).toEqual(['high', 'mid', 'low'])
  })

  it('marks every row unloaded for the lazy fetch', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view)

    for (const doc of view.result.current.exchanges[0].documents) {
      expect(doc).toMatchObject({ loading: false, loaded: false })
    }
  })

  it('passes the language through — it builds the document urls', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view, 'q', 'en')

    expect(search.mock.calls[0][1]).toBe('en')
  })

  it('handles an empty result without an error', async () => {
    search.mockResolvedValue({ count: 0, documents: [], conversationId: 'conv-1', messageId: 'msg-1' })
    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect(view.result.current.exchanges[0]).toMatchObject({ documents: [], loading: false })
    expect(view.result.current.exchanges[0].error).toBeUndefined()
  })

  it('stores the raw error message on a failure', async () => {
    search.mockRejectedValue(new Error('Document search failed - Ollama server is unreachable'))
    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect(view.result.current.exchanges[0]).toMatchObject({
      loading: false,
      error: 'Document search failed - Ollama server is unreachable',
    })
  })

  it('leaves the exchange alone on an AbortError', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    search.mockRejectedValue(abort)

    const view = renderHook(() => useArchiviste())
    await ask(view)

    expect(view.result.current.exchanges[0].error).toBeUndefined()
    expect(view.result.current.exchanges[0].loading).toBe(true)
  })
})

describe('the conversation id', () => {
  it('is adopted from the response and threaded into the next search', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view)
    expect(view.result.current.conversationId).toBe('conv-1')

    await ask(view, 'autre chose')
    expect(search.mock.calls[1][2].conversationId).toBe('conv-1')
  })

  it('survives a response that carries none', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view)

    search.mockResolvedValue({ ...RESPONSE, conversationId: undefined })
    await ask(view, 'again')

    expect(view.result.current.conversationId).toBe('conv-1')
  })
})

describe('the send queue', () => {
  it('marks the second search queued, then clears the flag when it runs', async () => {
    const first = deferred()
    search.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('first', 'fr')
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))

    await act(async () => {
      view.result.current.sendQuestion('second', 'fr')
    })
    expect(view.result.current.exchanges[1].queued).toBe(true)
    expect(view.result.current.isQueueFull).toBe(true)

    await act(async () => {
      first.resolve(RESPONSE)
      await first.promise
    })
    await waitFor(() => expect(view.result.current.exchanges[1].queued).toBe(false))
  })

  it('does not set `queued` at all on a search that starts immediately', async () => {
    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('q', 'fr')
    })

    await waitFor(() => expect(view.result.current.exchanges).toHaveLength(1))
    // The field is added only when the exchange has to wait; the run then sets
    // it to false. Either way it is never `true` for an immediate run.
    expect(view.result.current.exchanges[0].queued).not.toBe(true)
  })

  it('refuses a third search and keeps the draft', async () => {
    const first = deferred()
    search.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('first', 'fr')
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr')
    })
    act(() => view.result.current.setDraft('third'))
    await act(async () => {
      view.result.current.sendQuestion('third', 'fr')
    })

    expect(view.result.current.exchanges).toHaveLength(2)
    expect(view.result.current.draft).toBe('third')

    await act(async () => {
      first.resolve(RESPONSE)
      await first.promise
    })
  })

  it('runs the two searches strictly one after the other', async () => {
    /** @type {string[]} */
    const order = []
    const first = deferred()
    search.mockImplementation(async (/** @type {string} */ question) => {
      order.push(`start:${question}`)
      if (question === 'first') await first.promise
      order.push(`end:${question}`)
      return RESPONSE
    })

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('first', 'fr')
    })
    await waitFor(() => expect(order).toContain('start:first'))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr')
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
  it('removes the running search and the queued one', async () => {
    const first = deferred()
    search.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('first', 'fr')
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr')
    })

    act(() => view.result.current.stopGeneration())
    expect(view.result.current.exchanges).toHaveLength(0)

    await act(async () => {
      first.resolve(RESPONSE)
      await first.promise
    })
  })

  it('does not resurrect the dropped search when the aborted run settles later', async () => {
    const first = deferred()
    search.mockReturnValueOnce(first.promise)

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('first', 'fr')
    })
    await waitFor(() => expect(view.result.current.isSending).toBe(true))
    await act(async () => {
      view.result.current.sendQuestion('second', 'fr')
    })

    act(() => view.result.current.stopGeneration())
    await act(async () => {
      first.resolve(RESPONSE)
      await first.promise
    })

    expect(view.result.current.exchanges).toHaveLength(0)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('aborts the in-flight request', async () => {
    /** @type {AbortSignal | undefined} */
    let signal
    const pending = deferred()
    search.mockImplementation(async (
      /** @type {string} */ question,
      /** @type {any} */ language,
      /** @type {any} */ options,
    ) => {
      signal = options.signal
      return pending.promise
    })

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('q', 'fr')
    })
    await waitFor(() => expect(signal).toBeDefined())

    act(() => view.result.current.stopGeneration())
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(RESPONSE)
      await pending.promise
    })
  })

  it('is harmless when nothing is running', () => {
    const view = renderHook(() => useArchiviste())
    expect(() => act(() => view.result.current.stopGeneration())).not.toThrow()
  })
})

describe('startNewConversation', () => {
  it('empties the page and forgets the conversation id', async () => {
    const view = renderHook(() => useArchiviste())
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
    search.mockImplementation(async (
      /** @type {string} */ question,
      /** @type {any} */ language,
      /** @type {any} */ options,
    ) => {
      signal = options.signal
      return pending.promise
    })

    const view = renderHook(() => useArchiviste())
    act(() => {
      view.result.current.sendQuestion('q', 'fr')
    })
    await waitFor(() => expect(signal).toBeDefined())

    act(() => view.result.current.startNewConversation())
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(RESPONSE)
      await pending.promise
    })
  })
})

describe('loadConversation', () => {
  it('rebuilds exchanges with documents but no answer', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        page: 'archiviste',
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'où est le wifi' }),
          conversationMessage({
            id: 'm2',
            role: 'assistant',
            content: '',
            rating: -1,
            documents: [loggedDocument({ url: '/u/1' })],
          }),
        ],
      }),
    )

    const view = renderHook(() => useArchiviste())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    const [exchange] = view.result.current.exchanges
    expect(exchange).toMatchObject({
      id: 'm2',
      question: 'où est le wifi',
      messageId: 'm2',
      rating: -1,
      loading: false,
    })
    expect('answer' in exchange).toBe(false)
    expect(exchange.documents[0]).toEqual({
      name: 'Wi-Fi',
      type: 'md',
      url: '/u/1',
      score: 0.94,
      loading: false,
      loaded: false,
      expanded: false,
    })
  })

  it('defaults a missing type to md and a missing score to 0', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [
          conversationMessage({ id: 'm1', role: 'user', content: 'q' }),
          conversationMessage({
            id: 'm2',
            role: 'assistant',
            content: '',
            // A pre-migration row: NULL type and NULL score in the database.
            documents: [loggedDocument({ name: 'Old', type: null, url: '/u/1', score: null })],
          }),
        ],
      }),
    )

    const view = renderHook(() => useArchiviste())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0].documents[0]).toMatchObject({ type: 'md', score: 0 })
  })

  it('keeps an unanswered user message', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(
      conversationDetail({
        messages: [conversationMessage({ id: 'm1', role: 'user', content: 'orphan' })],
      }),
    )

    const view = renderHook(() => useArchiviste())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })

    expect(view.result.current.exchanges[0]).toMatchObject({
      id: 'm1',
      question: 'orphan',
      documents: [],
      messageId: null,
    })
  })

  it('threads the next search into the reopened conversation', async () => {
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(conversationDetail({ messages: [] }))

    const view = renderHook(() => useArchiviste())
    await act(async () => {
      await view.result.current.loadConversation('conv-7')
    })
    await ask(view, 'a follow-up')

    expect(search.mock.calls[0][2].conversationId).toBe('conv-7')
  })
})

describe('the lazy document load', () => {
  it('fetches a markdown row but never a PDF one', async () => {
    const view = renderHook(() => useArchiviste())
    await ask(view)

    const [md, pdf] = view.result.current.exchanges[0].documents
    const id = view.result.current.exchanges[0].id

    await act(async () => {
      view.result.current.toggleDocument(id, md)
    })
    await act(async () => {
      view.result.current.toggleDocument(id, pdf)
    })

    expect(archivisteApi.fetchDocument).toHaveBeenCalledTimes(1)
    expect(archivisteApi.fetchDocument).toHaveBeenCalledWith(md.url)

    const [afterMd, afterPdf] = view.result.current.exchanges[0].documents
    expect(afterMd).toMatchObject({ expanded: true, loaded: true, content: '# Wi-Fi' })
    expect(afterPdf).toMatchObject({ expanded: true, loaded: true })
  })
})

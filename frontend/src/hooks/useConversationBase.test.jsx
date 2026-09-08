import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useConversationBase } from './useConversationBase'
import * as feedbackApi from '../services/feedbackApi'
import * as historyApi from '../services/historyApi'
import { archivisteDocument, conversationDetail, conversationMessage } from '../test/fixtures'

// The seam shared by /chat and /archiviste. Three behaviours here are load-bearing
// and none of them is visible on screen when it breaks:
//
//  - `patchDocument` matches on type AND name. A retrieval merges two stores, so
//    an `md` and a `pdf` of the same basename can sit side by side; matching on
//    the name alone expands both rows at once and writes the markdown into both.
//  - a PDF row is marked loaded WITHOUT a fetch (the <iframe> loads it itself).
//    Fetching it would download the PDF as JSON and fail.
//  - feedback is optimistic with a SILENT rollback. A failed rating must leave
//    no dialog and no wrong thumb.

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * @param {Partial<import('../types/types.js').ArchivisteDocument>} [overrides]
 * @returns {import('../types/types.js').ArchivisteDocument}
 */
const doc = (overrides = {}) => archivisteDocument({ score: 0.94, ...overrides })

/**
 * The minimal exchange this hook works on — both pages' shapes satisfy it.
 *
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function exchange(overrides = {}) {
  return {
    id: 'ex-1',
    question: 'où est le wifi',
    documents: [doc()],
    loading: false,
    messageId: 'msg-1',
    ...overrides,
  }
}

/**
 * Mounts the hook with stub deps and seeds it with exchanges.
 * @param {{ fetchDocumentContent?: any, toExchanges?: any, seed?: any[] }} [opts]
 */
function mount({ fetchDocumentContent, toExchanges, seed } = {}) {
  const deps = {
    fetchDocumentContent: fetchDocumentContent ?? vi.fn(async () => ({ name: 'Wi-Fi', content: '# Wi-Fi' })),
    toExchanges: toExchanges ?? vi.fn((conversation) => conversation.messages ?? []),
  }
  const view = renderHook(() => useConversationBase(deps))
  if (seed) act(() => view.result.current.setExchanges(seed))
  return { ...view, deps }
}

describe('the draft', () => {
  it('starts empty and holds what the page puts in it', () => {
    const { result } = mount()
    expect(result.current.draft).toBe('')

    act(() => result.current.setDraft('half a question'))
    expect(result.current.draft).toBe('half a question')
  })
})

describe('adoptConversationId', () => {
  it('sets the ref synchronously and the state for the drawer', () => {
    const { result } = mount()
    act(() => result.current.adoptConversationId('conv-1'))

    expect(result.current.conversationId).toBe('conv-1')
    expect(result.current.conversationIdRef.current).toBe('conv-1')
  })

  it('ignores null and undefined — a failed logging write must not clear the thread', () => {
    const { result } = mount()
    act(() => result.current.adoptConversationId('conv-1'))

    act(() => result.current.adoptConversationId(null))
    act(() => result.current.adoptConversationId(undefined))
    expect(result.current.conversationId).toBe('conv-1')
  })

  it('does not re-set state when the id is unchanged', () => {
    const { result } = mount()
    act(() => result.current.adoptConversationId('conv-1'))
    const before = result.current.conversationId

    act(() => result.current.adoptConversationId('conv-1'))
    expect(result.current.conversationId).toBe(before)
  })

  it('keeps a stable identity so a page sendQuestion stays referentially stable', () => {
    const { result, rerender } = mount()
    const first = result.current.adoptConversationId

    rerender()
    expect(result.current.adoptConversationId).toBe(first)
  })
})

describe('loadDocument', () => {
  it('fetches a markdown row and stores its content', async () => {
    const { result, deps } = mount({ seed: [exchange()] })

    await act(async () => {
      await result.current.loadDocument('ex-1', doc())
    })

    expect(deps.fetchDocumentContent).toHaveBeenCalledWith('/BaseDocumentaire/fr/Notion/Wi-Fi.md')
    expect(result.current.exchanges[0].documents[0]).toMatchObject({
      content: '# Wi-Fi',
      loading: false,
      loaded: true,
    })
  })

  it('marks a PDF loaded without fetching anything', async () => {
    // The <iframe> loads doc.url itself; a fetch here would pull the PDF as
    // JSON and fail on every subject row.
    const pdf = doc({ type: 'pdf', name: 'libft', url: '/subjectspdf/libft.pdf' })
    const { result, deps } = mount({ seed: [exchange({ documents: [pdf] })] })

    await act(async () => {
      await result.current.loadDocument('ex-1', pdf)
    })

    expect(deps.fetchDocumentContent).not.toHaveBeenCalled()
    expect(result.current.exchanges[0].documents[0].loaded).toBe(true)
  })

  it('is a no-op on an already loaded row', async () => {
    const loaded = doc({ loaded: true })
    const { result, deps } = mount({ seed: [exchange({ documents: [loaded] })] })

    await act(async () => {
      await result.current.loadDocument('ex-1', loaded)
    })
    expect(deps.fetchDocumentContent).not.toHaveBeenCalled()
  })

  it('is a no-op while a row is already loading — each doc is fetched once', async () => {
    const loading = doc({ loading: true })
    const { result, deps } = mount({ seed: [exchange({ documents: [loading] })] })

    await act(async () => {
      await result.current.loadDocument('ex-1', loading)
    })
    expect(deps.fetchDocumentContent).not.toHaveBeenCalled()
  })

  it('stores the raw error message and stops loading on a failure', async () => {
    // Raw, with no prefix: the component prepends the translated `errorPrefix`
    // at render time, so the message re-renders in the right language after a
    // locale switch.
    const { result } = mount({
      fetchDocumentContent: vi.fn(async () => { throw new Error('Document not found') }),
      seed: [exchange()],
    })

    await act(async () => {
      await result.current.loadDocument('ex-1', doc())
    })

    expect(result.current.exchanges[0].documents[0]).toMatchObject({
      loading: false,
      error: 'Document not found',
    })
    expect(result.current.exchanges[0].documents[0].loaded).toBe(false)
  })

  it('touches only the addressed exchange', async () => {
    const { result } = mount({ seed: [exchange(), exchange({ id: 'ex-2' })] })

    await act(async () => {
      await result.current.loadDocument('ex-2', doc())
    })

    expect(result.current.exchanges[0].documents[0].loaded).toBe(false)
    expect(result.current.exchanges[1].documents[0].loaded).toBe(true)
  })
})

describe('patchDocument — matching on type AND name', () => {
  it('leaves a same-named row of the other type alone', async () => {
    // The bug this prevents: expanding the Notion "libft" would also expand the
    // subject PDF "libft" and write the markdown into it.
    const md = doc({ name: 'libft', type: 'md', url: '/md/libft.md' })
    const pdf = doc({ name: 'libft', type: 'pdf', url: '/subjectspdf/libft.pdf' })
    const { result } = mount({ seed: [exchange({ documents: [md, pdf] })] })

    await act(async () => {
      await result.current.loadDocument('ex-1', md)
    })

    const [afterMd, afterPdf] = result.current.exchanges[0].documents
    expect(afterMd).toMatchObject({ loaded: true, content: '# Wi-Fi' })
    expect(afterPdf).toMatchObject({ loaded: false, content: '' })
  })
})

describe('toggleDocument', () => {
  it('expands and loads on the first unfold', async () => {
    const { result, deps } = mount({ seed: [exchange()] })

    await act(async () => {
      result.current.toggleDocument('ex-1', doc())
    })

    expect(result.current.exchanges[0].documents[0].expanded).toBe(true)
    expect(deps.fetchDocumentContent).toHaveBeenCalledTimes(1)
  })

  it('collapses without fetching again', async () => {
    const expanded = doc({ expanded: true, loaded: true, content: '# Wi-Fi' })
    const { result, deps } = mount({ seed: [exchange({ documents: [expanded] })] })

    await act(async () => {
      result.current.toggleDocument('ex-1', expanded)
    })

    expect(result.current.exchanges[0].documents[0].expanded).toBe(false)
    expect(deps.fetchDocumentContent).not.toHaveBeenCalled()
  })

  it('keeps the content when re-expanding — no second fetch', async () => {
    const collapsed = doc({ expanded: false, loaded: true, content: '# Wi-Fi' })
    const { result, deps } = mount({ seed: [exchange({ documents: [collapsed] })] })

    await act(async () => {
      result.current.toggleDocument('ex-1', collapsed)
    })

    expect(result.current.exchanges[0].documents[0]).toMatchObject({
      expanded: true,
      content: '# Wi-Fi',
    })
    expect(deps.fetchDocumentContent).not.toHaveBeenCalled()
  })
})

describe('submitFeedback', () => {
  it('flips the rating immediately, then sends it', async () => {
    const send = vi.spyOn(feedbackApi, 'sendFeedback').mockResolvedValue({ ok: true, rating: 1 })
    const { result } = mount({ seed: [exchange()] })

    await act(async () => {
      await result.current.submitFeedback('ex-1', 1, undefined)
    })

    expect(result.current.exchanges[0].rating).toBe(1)
    expect(send).toHaveBeenCalledWith('msg-1', 1, undefined)
  })

  it('passes a comment through on a thumbs-down', async () => {
    const send = vi.spyOn(feedbackApi, 'sendFeedback').mockResolvedValue({ ok: true, rating: -1 })
    const { result } = mount({ seed: [exchange()] })

    await act(async () => {
      await result.current.submitFeedback('ex-1', -1, 'hors sujet')
    })

    expect(send).toHaveBeenCalledWith('msg-1', -1, 'hors sujet')
  })

  it('rolls back silently when the request fails', async () => {
    // No dialog, no toast: feedback is a courtesy and an error popup over it
    // would be backwards.
    vi.spyOn(feedbackApi, 'sendFeedback').mockRejectedValue(new Error('Message not found'))
    const { result } = mount({ seed: [exchange({ rating: 1 })] })

    await act(async () => {
      await result.current.submitFeedback('ex-1', -1, undefined)
    })

    expect(result.current.exchanges[0].rating).toBe(1)
  })

  it('rolls back to 0 when there was no previous rating', async () => {
    vi.spyOn(feedbackApi, 'sendFeedback').mockRejectedValue(new Error('nope'))
    const { result } = mount({ seed: [exchange()] })

    await act(async () => {
      await result.current.submitFeedback('ex-1', 1, undefined)
    })

    expect(result.current.exchanges[0].rating).toBe(0)
  })

  it('does nothing for an unknown exchange', async () => {
    const send = vi.spyOn(feedbackApi, 'sendFeedback')
    const { result } = mount({ seed: [exchange()] })

    await act(async () => {
      await result.current.submitFeedback('nope', 1, undefined)
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('does nothing when the exchange has no messageId', async () => {
    // Which is the case whenever the backend's logging write failed — there is
    // nothing to rate, and sending would 404.
    const send = vi.spyOn(feedbackApi, 'sendFeedback')
    const { result } = mount({ seed: [exchange({ messageId: null })] })

    await act(async () => {
      await result.current.submitFeedback('ex-1', 1, undefined)
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('reads the current exchanges through the ref, not a stale closure', async () => {
    const send = vi.spyOn(feedbackApi, 'sendFeedback').mockResolvedValue({ ok: true, rating: 1 })
    const { result } = mount()

    const submit = result.current.submitFeedback
    act(() => result.current.setExchanges([exchange({ messageId: 'msg-later' })]))
    await waitFor(() => expect(result.current.exchangesRef.current).toHaveLength(1))

    // The captured callback still sees the exchange added after it was taken.
    await act(async () => {
      await submit('ex-1', 1, undefined)
    })
    expect(send).toHaveBeenCalledWith('msg-later', 1, undefined)
  })
})

describe('loadConversation', () => {
  it('rebuilds the exchanges through the injected toExchanges and adopts the id', async () => {
    const detail = conversationDetail({
      messages: [conversationMessage({ id: 'past-1', content: 'une question passée' })],
    })
    vi.spyOn(historyApi, 'getConversation').mockResolvedValue(detail)

    const toExchanges = vi.fn(() => [exchange({ id: 'rebuilt' })])
    const { result } = mount({ toExchanges })

    await act(async () => {
      await result.current.loadConversation('conv-7')
    })

    expect(toExchanges).toHaveBeenCalledWith(detail)
    expect(result.current.exchanges[0].id).toBe('rebuilt')
    expect(result.current.conversationId).toBe('conv-7')
    expect(result.current.conversationIdRef.current).toBe('conv-7')
  })

  it('propagates a failure — the drawer decides what to show', async () => {
    vi.spyOn(historyApi, 'getConversation').mockRejectedValue(new Error('Conversation not found'))
    const { result } = mount()

    await expect(result.current.loadConversation('conv-7')).rejects.toThrow('Conversation not found')
  })
})

describe('reset', () => {
  it('empties the exchanges, the draft and the conversation id', async () => {
    const { result } = mount({ seed: [exchange()] })
    act(() => {
      result.current.setDraft('typing')
      result.current.adoptConversationId('conv-1')
    })

    act(() => result.current.reset())

    expect(result.current.exchanges).toEqual([])
    expect(result.current.draft).toBe('')
    expect(result.current.conversationId).toBeNull()
    expect(result.current.conversationIdRef.current).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { sendMessage, fetchChatDocuments, fetchDocumentContent } from './chatApi'
import { stubFetch, jsonResponse, streamResponse, ndjsonResponse } from '../test/fetchStub'

// chatApi is the only transport in the app that reads a streamed body, and the
// stream is where the interesting failures live: a `done` frame that never
// arrives costs the answer its `messageId` (the 👍/👎 buttons never appear) and
// its `conversationId` (the next question opens a new thread). Every fallback
// in the return object exists for one of those, so each gets a test.

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('boby42.visitorId', 'visitor-1')
})
afterEach(() => vi.unstubAllGlobals())

const DONE = {
  type: 'done',
  answer: 'au 2e étage',
  sources: [{ name: 'Wi-Fi', type: 'md', url: '/u/1', score: 0.94 }],
  conversationId: 'conv-1',
  messageId: 'msg-1',
}

describe('sendMessage — the request', () => {
  it('always asks for a stream and attaches the visitor id', async () => {
    const { calls } = stubFetch([ndjsonResponse([DONE])])
    await sendMessage('où est le wifi')

    expect(calls[0].url).toBe('/chat')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toMatchObject({
      question: 'où est le wifi',
      stream: true,
      visitorId: 'visitor-1',
    })
  })

  it('sends an empty documents array rather than omitting the field', async () => {
    // Omitting it means "retrieve for yourself"; an empty array means "we looked
    // and found nothing", which the backend answers with its fallback and no LLM
    // call. The two are different requests and the frontend always means the
    // second one.
    const { calls } = stubFetch([ndjsonResponse([DONE])])
    await sendMessage('q')

    expect(calls[0].body.documents).toEqual([])
  })

  it('sends the phase-1 rows back untouched', async () => {
    /** @type {{ name: string, type: 'md' | 'pdf', score?: number, url?: string }[]} */
    const documents = [{ name: 'Wi-Fi', type: 'md', score: 0.94, url: '/u/1' }]
    const { calls } = stubFetch([ndjsonResponse([DONE])])
    await sendMessage('q', { documents })

    expect(calls[0].body.documents).toEqual(documents)
  })

  it('omits conversationId when there is none, and sends it when there is', async () => {
    const { calls } = stubFetch([ndjsonResponse([DONE]), ndjsonResponse([DONE])])

    await sendMessage('q')
    expect('conversationId' in calls[0].body).toBe(false)

    await sendMessage('q', { conversationId: 'conv-9' })
    expect(calls[1].body.conversationId).toBe('conv-9')
  })

  it('passes the language through', async () => {
    const { calls } = stubFetch([ndjsonResponse([DONE])])
    await sendMessage('q', { language: 'en' })

    expect(calls[0].body.language).toBe('en')
  })

  it('forwards the abort signal', async () => {
    const { calls } = stubFetch([ndjsonResponse([DONE])])
    const controller = new AbortController()
    await sendMessage('q', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('throws the backend message on a non-OK status, before reading any body', async () => {
    stubFetch([jsonResponse({ message: 'Failed to get an answer from Ollama' }, 502)])
    await expect(sendMessage('q')).rejects.toThrow('Failed to get an answer from Ollama')
  })
})

describe('sendMessage — reading the stream', () => {
  it('calls onToken with each fragment and the running text', async () => {
    stubFetch([ndjsonResponse([
      { type: 'token', value: 'au ' },
      { type: 'token', value: '2e ' },
      { type: 'token', value: 'étage' },
      DONE,
    ])])

    /** @type {[string, string][]} */
    const seen = []
    await sendMessage('q', { onToken: (fragment, full) => seen.push([fragment, full]) })

    expect(seen).toEqual([
      ['au ', 'au '],
      ['2e ', 'au 2e '],
      ['étage', 'au 2e étage'],
    ])
  })

  it('returns the done frame\'s fields', async () => {
    stubFetch([ndjsonResponse([{ type: 'token', value: 'au 2e étage' }, DONE])])

    await expect(sendMessage('q')).resolves.toEqual({
      answer: 'au 2e étage',
      sources: DONE.sources,
      conversationId: 'conv-1',
      messageId: 'msg-1',
    })
  })

  it('works with no onToken at all', async () => {
    stubFetch([ndjsonResponse([{ type: 'token', value: 'x' }, DONE])])
    await expect(sendMessage('q')).resolves.toMatchObject({ answer: 'au 2e étage' })
  })

  it('handles a done frame with no token lines — the no-documents fallback', async () => {
    stubFetch([ndjsonResponse([{ ...DONE, answer: 'je ne trouve pas', sources: [] }])])

    await expect(sendMessage('q')).resolves.toMatchObject({
      answer: 'je ne trouve pas',
      sources: [],
    })
  })

  it('throws on an error frame, aborting the read', async () => {
    stubFetch([ndjsonResponse([
      { type: 'token', value: 'au ' },
      { type: 'error', message: 'Failed to get an answer from Ollama' },
    ])])

    await expect(sendMessage('q')).rejects.toThrow('Failed to get an answer from Ollama')
  })

  it('throws a generic message on an error frame carrying none', async () => {
    stubFetch([ndjsonResponse([{ type: 'error' }])])
    await expect(sendMessage('q')).rejects.toThrow('Error contacting the server')
  })

  it('ignores a frame type it does not know', async () => {
    // Forward compatibility: a backend that starts emitting a new frame type
    // must not break an older client mid-answer.
    stubFetch([ndjsonResponse([{ type: 'heartbeat' }, { type: 'token', value: 'x' }, DONE])])

    await expect(sendMessage('q')).resolves.toMatchObject({ answer: 'au 2e étage' })
  })
})

describe('sendMessage — when the done frame never arrives', () => {
  it('falls back to the assembled tokens as the answer', async () => {
    stubFetch([ndjsonResponse([
      { type: 'token', value: 'au ' },
      { type: 'token', value: '2e' },
    ])])

    await expect(sendMessage('q')).resolves.toEqual({
      answer: 'au 2e',
      sources: [],
      conversationId: null,
      messageId: null,
    })
  })

  it('keeps the conversationId the caller already had, so the thread survives', async () => {
    // Without this a truncated stream would silently start a new conversation
    // on the next question.
    stubFetch([ndjsonResponse([{ type: 'token', value: 'x' }])])

    await expect(sendMessage('q', { conversationId: 'conv-9' })).resolves.toMatchObject({
      conversationId: 'conv-9',
    })
  })

  it('returns an empty answer on an entirely empty stream', async () => {
    stubFetch([streamResponse([])])

    await expect(sendMessage('q')).resolves.toEqual({
      answer: '',
      sources: [],
      conversationId: null,
      messageId: null,
    })
  })
})

describe('fetchChatDocuments — phase 1', () => {
  it('posts the question, language and visitor id', async () => {
    const { calls } = stubFetch([jsonResponse({ count: 0, documents: [] })])
    await fetchChatDocuments('où est le wifi', 'fr')

    expect(calls[0].url).toBe('/chat/documents')
    expect(calls[0].body).toEqual({
      question: 'où est le wifi',
      language: 'fr',
      visitorId: 'visitor-1',
    })
  })

  it('resolves to the rows', async () => {
    const payload = { count: 1, documents: [{ name: 'Wi-Fi', score: 0.94, type: 'md', url: '/u/1' }] }
    stubFetch([jsonResponse(payload)])

    await expect(fetchChatDocuments('q', 'fr')).resolves.toEqual(payload)
  })

  it('forwards the abort signal', async () => {
    const { calls } = stubFetch([jsonResponse({ count: 0, documents: [] })])
    const controller = new AbortController()
    await fetchChatDocuments('q', 'fr', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('throws the backend message on a retrieval failure', async () => {
    stubFetch([jsonResponse({ message: 'Document search failed - Ollama server is unreachable' }, 502)])
    await expect(fetchChatDocuments('q', 'fr')).rejects.toThrow(
      'Document search failed - Ollama server is unreachable',
    )
  })
})

describe('fetchDocumentContent', () => {
  it('GETs the url the row already carries, with no language of its own', async () => {
    // The language is baked into that path by phase 1 — re-deriving it here
    // would be a second source of truth.
    const { calls } = stubFetch([jsonResponse({ name: 'Wi-Fi', content: '# Wi-Fi' })])
    await fetchDocumentContent('/BaseDocumentaire/en/Notion/Wi-Fi.md')

    expect(calls[0].url).toBe('/BaseDocumentaire/en/Notion/Wi-Fi.md')
    expect(calls[0].method).toBe('GET')
  })

  it('resolves to the document', async () => {
    stubFetch([jsonResponse({ name: 'Wi-Fi', content: '# Wi-Fi' })])
    await expect(fetchDocumentContent('/u/1')).resolves.toEqual({ name: 'Wi-Fi', content: '# Wi-Fi' })
  })

  it('forwards the abort signal', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await fetchDocumentContent('/u/1', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('throws on a missing document', async () => {
    stubFetch([jsonResponse({ message: 'Document not found' }, 404)])
    await expect(fetchDocumentContent('/u/nope')).rejects.toThrow('Document not found')
  })
})

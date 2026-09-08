import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { search, fetchDocument } from '../../../src/services/archivisteApi'
import { sendFeedback } from '../../../src/services/feedbackApi'
import { listConversations, getConversation } from '../../../src/services/historyApi'
import * as labApi from '../../../src/services/labApi'
import { listModels, generate } from '../../../src/services/ollamaApi'
import { stubFetch, jsonResponse, ndjsonResponse } from '../../fetchStub'

// The four remaining transports. They are thin by design — the value in testing
// them is the small amount of URL and body ASSEMBLY each one does, because that
// is what silently breaks: an unencoded name in a path, a visitorId dropped from
// a query string, a `?` where a `&` belongs.

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('boby42.visitorId', 'visitor-1')
})
afterEach(() => vi.unstubAllGlobals())

describe('archivisteApi.search', () => {
  it('posts question, language and visitor id', async () => {
    const { calls } = stubFetch([jsonResponse({ count: 0, documents: [] })])
    await search('où est le wifi', 'fr')

    expect(calls[0].url).toBe('/archiviste')
    expect(calls[0].body).toEqual({ question: 'où est le wifi', language: 'fr', visitorId: 'visitor-1' })
  })

  it('adds conversationId only when there is one', async () => {
    const { calls } = stubFetch([jsonResponse({}), jsonResponse({})])

    await search('q', 'fr')
    expect('conversationId' in calls[0].body).toBe(false)

    await search('q', 'fr', { conversationId: 'conv-1' })
    expect(calls[1].body.conversationId).toBe('conv-1')
  })

  it('treats a null conversationId as absent', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await search('q', 'fr', { conversationId: null })

    expect('conversationId' in calls[0].body).toBe(false)
  })

  it('forwards the abort signal and throws the backend message', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await search('q', 'fr', { signal: controller.signal })
    expect(calls[0].signal).toBe(controller.signal)

    stubFetch([jsonResponse({ message: 'Failed to search the document base' }, 502)])
    await expect(search('q', 'fr')).rejects.toThrow('Failed to search the document base')
  })
})

describe('archivisteApi.fetchDocument', () => {
  it('GETs the url as-is — the language is already in its path', async () => {
    const { calls } = stubFetch([jsonResponse({ name: 'Wi-Fi', content: '#' })])
    await fetchDocument('/BaseDocumentaire/origin/Notion/Badge%20perdu.md')

    expect(calls[0].url).toBe('/BaseDocumentaire/origin/Notion/Badge%20perdu.md')
    expect(calls[0].method).toBe('GET')
  })

  it('forwards the abort signal', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await fetchDocument('/u/1', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })
})

describe('feedbackApi.sendFeedback', () => {
  it('posts the rating with the visitor id — the ownership check depends on it', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true, rating: 1 })])
    await sendFeedback('msg-1', 1)

    expect(calls[0].url).toBe('/feedback')
    expect(calls[0].body).toEqual({ messageId: 'msg-1', rating: 1, visitorId: 'visitor-1' })
  })

  it('omits the comment when there is none', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true, rating: -1 })])
    await sendFeedback('msg-1', -1)

    expect('comment' in calls[0].body).toBe(false)
  })

  it('sends a comment when given', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true, rating: -1 })])
    await sendFeedback('msg-1', -1, 'hors sujet')

    expect(calls[0].body.comment).toBe('hors sujet')
  })

  it('drops an empty comment rather than sending an empty string', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true, rating: -1 })])
    await sendFeedback('msg-1', -1, '')

    expect('comment' in calls[0].body).toBe(false)
  })

  it('sends rating 0 to withdraw', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true, rating: 0 })])
    await sendFeedback('msg-1', 0)

    expect(calls[0].body.rating).toBe(0)
  })

  it('throws on a 404 — the hooks turn that into a silent rollback', async () => {
    stubFetch([jsonResponse({ message: 'Message not found' }, 404)])
    await expect(sendFeedback('msg-1', 1)).rejects.toThrow('Message not found')
  })
})

describe('historyApi', () => {
  it('appends the visitor id as a query param on the list', async () => {
    const { calls } = stubFetch([jsonResponse([])])
    await listConversations()

    expect(calls[0].url).toBe('/conversations?visitorId=visitor-1')
  })

  it('url-encodes the visitor id', async () => {
    localStorage.setItem('boby42.visitorId', 'a b&c')
    const { calls } = stubFetch([jsonResponse([])])
    await listConversations()

    expect(calls[0].url).toBe('/conversations?visitorId=a%20b%26c')
  })

  it('url-encodes the conversation id in the detail path', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await getConversation('a/b')

    expect(calls[0].url).toBe('/conversations/a%2Fb?visitorId=visitor-1')
  })

  it('encodes a `?` inside the id instead of letting it open a query string', async () => {
    // The separator logic in `get()` picks `?` here because the encoded id
    // contains no literal `?` — which is the point: an id cannot smuggle in its
    // own query params and shadow the visitorId the backend requires.
    const { calls } = stubFetch([jsonResponse({})])
    await getConversation('id?visitorId=someone-else')

    expect(calls[0].url).toBe('/conversations/id%3FvisitorId%3Dsomeone-else?visitorId=visitor-1')
    expect(calls[0].url.match(/visitorId=visitor-1/g)).toHaveLength(1)
  })

  it('forwards the abort signal on both calls', async () => {
    const { calls } = stubFetch([jsonResponse([]), jsonResponse({})])
    const controller = new AbortController()

    await listConversations({ signal: controller.signal })
    await getConversation('id', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
    expect(calls[1].signal).toBe(controller.signal)
  })

  it('throws on a conversation that is not this visitor\'s', async () => {
    stubFetch([jsonResponse({ message: 'Conversation not found' }, 404)])
    await expect(getConversation('id')).rejects.toThrow('Conversation not found')
  })
})

describe('labApi — the gate', () => {
  it('login posts the credentials with the cookie and reports success', async () => {
    const { calls } = stubFetch([jsonResponse({ login: 'admin' })])

    await expect(labApi.login('admin', 'secret')).resolves.toEqual({ ok: true, login: 'admin' })
    expect(calls[0].url).toBe('/auth/lab/login')
    expect(calls[0].body).toEqual({ login: 'admin', password: 'secret' })
    expect(calls[0].credentials).toBe('include')
  })

  it('login reports failure without throwing — wrong creds is an outcome', async () => {
    stubFetch([jsonResponse({ message: 'Invalid credentials' }, 401)])
    await expect(labApi.login('admin', 'wrong')).resolves.toEqual({ ok: false })
  })

  it('login reports failure the same way when the gate is off (404)', async () => {
    stubFetch([jsonResponse({}, 404)])
    await expect(labApi.login('admin', 'secret')).resolves.toEqual({ ok: false })
  })

  it('login survives a 200 whose body will not parse', async () => {
    stubFetch([new Response('not json', { status: 200 })])
    await expect(labApi.login('a', 'b')).resolves.toEqual({ ok: true, login: undefined })
  })

  it('logout posts with the cookie', async () => {
    const { calls } = stubFetch([jsonResponse({ ok: true })])
    await labApi.logout()

    expect(calls[0].url).toBe('/auth/lab/logout')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].credentials).toBe('include')
  })

  it('me returns the session or null', async () => {
    stubFetch([jsonResponse({ login: 'admin' })])
    await expect(labApi.me()).resolves.toEqual({ login: 'admin' })

    stubFetch([jsonResponse({}, 401)])
    await expect(labApi.me()).resolves.toBeNull()
  })

  it('ollamaKey unwraps the key, and returns null when there is none', async () => {
    stubFetch([jsonResponse({ key: 'CestdelafrappeBB42' })])
    await expect(labApi.ollamaKey()).resolves.toBe('CestdelafrappeBB42')

    stubFetch([jsonResponse({}, 404)])
    await expect(labApi.ollamaKey()).resolves.toBeNull()
  })

  it('ollamaKey returns null on a 200 with no key field', async () => {
    stubFetch([jsonResponse({})])
    await expect(labApi.ollamaKey()).resolves.toBeNull()
  })
})

describe('labApi — the db-viz reads', () => {
  it('tables hits the listing endpoint', async () => {
    const { calls } = stubFetch([jsonResponse([])])
    await labApi.tables()

    expect(calls[0].url).toBe('/lab-data/tables')
  })

  it('table url-encodes the table name', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.table('message documents')

    expect(calls[0].url).toBe('/lab-data/tables/message%20documents')
  })

  it('tree url-encodes the conversation id', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.tree('a/b')

    expect(calls[0].url).toBe('/lab-data/tree/a%2Fb')
  })

  it('returns null on a gated response rather than throwing', async () => {
    stubFetch([jsonResponse({}, 401)])
    await expect(labApi.tables()).resolves.toBeNull()
  })
})

describe('labApi — the analytics reads and their querystring', () => {
  it('sends no querystring at all when there are no params', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.analyticsOverview()

    expect(calls[0].url).toBe('/analytics/overview')
  })

  it('builds a querystring from the params given', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.analyticsOverview({ from: '2026-03-01T00:00:00.000Z', to: '2026-03-08T00:00:00.000Z' })

    expect(calls[0].url).toBe(
      '/analytics/overview?from=2026-03-01T00%3A00%3A00.000Z&to=2026-03-08T00%3A00%3A00.000Z',
    )
  })

  it('drops undefined, null and empty values instead of sending them blank', async () => {
    // `page=` on the backend is an enum violation → 400. Dropping it is what
    // makes "no filter" expressible from the same object the UI holds.
    const { calls } = stubFetch([jsonResponse({})])
    // `null` and `''` are deliberately outside the declared parameter type —
    // the point of the test is that `qs()` drops them rather than sending
    // `to=null&page=`, which the backend rejects with a 400.
    await labApi.analyticsUnmatched(
      /** @type {any} */ ({ from: undefined, to: null, page: '', limit: 10 }),
    )

    expect(calls[0].url).toBe('/analytics/unmatched?limit=10')
  })

  it('keeps a numeric zero, which is a real offset', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.analyticsConversations({ offset: 0, limit: 25 })

    expect(calls[0].url).toBe('/analytics/conversations?offset=0&limit=25')
  })

  it('analyticsConversation url-encodes the id', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await labApi.analyticsConversation('a b')

    expect(calls[0].url).toBe('/analytics/conversations/a%20b')
  })

  it('returns null when the dashboard is gated', async () => {
    stubFetch([jsonResponse({}, 401)])
    await expect(labApi.analyticsOverview()).resolves.toBeNull()
  })
})

describe('ollamaApi.listModels', () => {
  it('sends the shared key as a header, never in the url', async () => {
    // The key must not end up in a browser history entry or a proxy access log.
    const { calls } = stubFetch([jsonResponse({ models: [{ name: 'mistral:latest' }] })])
    await listModels('the-key')

    expect(calls[0].url).toBe('/ollama/api/tags')
    expect(calls[0].headers['x-ollama-key']).toBe('the-key')
    expect(calls[0].url).not.toContain('the-key')
  })

  it('returns the model names', async () => {
    stubFetch([jsonResponse({ models: [{ name: 'mistral:latest' }, { name: 'llama3:latest' }] })])
    await expect(listModels('k')).resolves.toEqual(['mistral:latest', 'llama3:latest'])
  })

  it('returns an empty list when the body has no models', async () => {
    stubFetch([jsonResponse({})])
    await expect(listModels('k')).resolves.toEqual([])
  })

  it('drops nameless entries rather than rendering undefined in the dropdown', async () => {
    stubFetch([jsonResponse({ models: [{ name: 'a' }, {}, { name: '' }] })])
    await expect(listModels('k')).resolves.toEqual(['a'])
  })

  it('survives a 200 whose body will not parse', async () => {
    stubFetch([new Response('nope', { status: 200 })])
    await expect(listModels('k')).resolves.toEqual([])
  })

  it('throws with the status on a bad key (404)', async () => {
    stubFetch([jsonResponse({}, 404)])
    await expect(listModels('wrong')).rejects.toThrow('Model list failed (404)')
  })
})

describe('ollamaApi.generate', () => {
  it('posts the raw Ollama body with the key header', async () => {
    const { calls } = stubFetch([jsonResponse({ response: 'hi' })])
    await generate('k', { model: 'mistral:latest', prompt: 'x', options: { temperature: 0.2 } })

    expect(calls[0].url).toBe('/ollama/api/generate')
    expect(calls[0].headers['x-ollama-key']).toBe('k')
    expect(calls[0].body).toEqual({ model: 'mistral:latest', prompt: 'x', options: { temperature: 0.2 } })
  })

  it('returns the single JSON object when not streaming', async () => {
    stubFetch([jsonResponse({ response: 'au 2e', eval_count: 12 })])
    await expect(generate('k', { model: 'm', prompt: 'x' })).resolves.toEqual({
      response: 'au 2e',
      eval_count: 12,
    })
  })

  it('assembles the NDJSON pieces and keeps the last frame\'s stats', async () => {
    stubFetch([ndjsonResponse([
      { response: 'au ' },
      { response: '2e' },
      { response: '', done: true, eval_count: 12, total_duration: 42 },
    ])])

    /** @type {string[]} */
    const tokens = []
    const result = await generate('k', { model: 'm', prompt: 'x', stream: true }, {
      onToken: (text) => tokens.push(text),
    })

    expect(tokens).toEqual(['au ', '2e'])
    expect(result).toMatchObject({ response: 'au 2e', done: true, eval_count: 12, total_duration: 42 })
  })

  it('does not call onToken for a frame carrying no text', async () => {
    stubFetch([ndjsonResponse([{ done: false }, { response: 'x', done: true }])])

    /** @type {string[]} */
    const tokens = []
    await generate('k', { model: 'm', stream: true }, { onToken: (t) => tokens.push(t) })

    expect(tokens).toEqual(['x'])
  })

  it('streams fine with no onToken', async () => {
    stubFetch([ndjsonResponse([{ response: 'x', done: true }])])
    await expect(generate('k', { model: 'm', stream: true })).resolves.toMatchObject({ response: 'x' })
  })

  it('forwards the abort signal so a long generation can be stopped', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await generate('k', { model: 'm' }, { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('surfaces the upstream error text, which is what makes a model error readable', async () => {
    stubFetch([new Response('model "nope" not found', { status: 404 })])
    await expect(generate('k', { model: 'nope' })).rejects.toThrow('model "nope" not found')
  })

  it('falls back to the status when the error body is empty', async () => {
    stubFetch([new Response('', { status: 500 })])
    await expect(generate('k', { model: 'm' })).rejects.toThrow('Generation failed (500)')
  })
})

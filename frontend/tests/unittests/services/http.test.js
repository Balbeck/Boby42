import { describe, it, expect, afterEach, vi } from 'vitest'

import { apiUrl, throwIfNotOk, postJson, getJson, getJsonOrNull } from '../../../src/services/http'
import { stubFetch, jsonResponse, textResponse } from '../../fetchStub'

// http.js holds TWO error contracts on purpose, and mixing them up is the kind
// of bug that only shows in production: the student pages throw on a non-OK
// status (the backend's message is what the user reads), while the /lab reads
// return null because a 401/404 there is an expected state, not a failure.
// Most of this suite is about keeping those two apart.

afterEach(() => vi.unstubAllGlobals())

describe('apiUrl', () => {
  it('returns the path unchanged when VITE_API_URL is empty', () => {
    // Which is the deployed configuration: the browser calls the frontend's own
    // origin and Vite proxies to the backend server-side. An absolute URL here
    // would make it a cross-origin request and put CORS in the hot path.
    expect(apiUrl('/chat')).toBe('/chat')
    expect(apiUrl('/BaseDocumentaire/fr/Notion/Wi-Fi.md')).toBe('/BaseDocumentaire/fr/Notion/Wi-Fi.md')
  })
})

describe('throwIfNotOk', () => {
  it('resolves silently on a 2xx', async () => {
    await expect(throwIfNotOk(jsonResponse({ ok: true }))).resolves.toBeUndefined()
  })

  it('throws the backend message verbatim — it is what the user sees', async () => {
    const response = jsonResponse({ message: 'Document search failed - Ollama server is unreachable' }, 502)
    await expect(throwIfNotOk(response)).rejects.toThrow(
      'Document search failed - Ollama server is unreachable',
    )
  })

  it('falls back to a generic message when the error body has none', async () => {
    await expect(throwIfNotOk(jsonResponse({}, 500))).rejects.toThrow('Error contacting the server')
  })

  it('falls back when the error body is not JSON at all', async () => {
    // A proxy returning an HTML error page must not turn into a SyntaxError
    // that hides the real status.
    await expect(throwIfNotOk(textResponse(502))).rejects.toThrow('Error contacting the server')
  })

  it('falls back on an empty body', async () => {
    await expect(throwIfNotOk(new Response(null, { status: 504 }))).rejects.toThrow(
      'Error contacting the server',
    )
  })
})

describe('postJson', () => {
  it('POSTs a JSON body and resolves to the parsed response', async () => {
    const { calls } = stubFetch([jsonResponse({ count: 1 })])

    await expect(postJson('/chat/documents', { question: 'q' })).resolves.toEqual({ count: 1 })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('/chat/documents')
    expect(calls[0].headers['Content-Type']).toBe('application/json')
    expect(calls[0].body).toEqual({ question: 'q' })
  })

  it('lets extra headers override the default content type', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await postJson('/x', {}, { headers: { 'x-custom': '1' } })

    expect(calls[0].headers).toMatchObject({ 'Content-Type': 'application/json', 'x-custom': '1' })
  })

  it('omits `credentials` entirely unless asked — it is not a /lab call', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await postJson('/x', {})

    expect(calls[0].credentials).toBeUndefined()
  })

  it('passes credentials through when given', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    await postJson('/x', {}, { credentials: 'include' })

    expect(calls[0].credentials).toBe('include')
  })

  it('forwards the abort signal so a send can be cancelled', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await postJson('/x', {}, { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('throws on a non-OK status instead of resolving to the error body', async () => {
    stubFetch([jsonResponse({ message: 'Message not found' }, 404)])
    await expect(postJson('/feedback', {})).rejects.toThrow('Message not found')
  })
})

describe('getJson', () => {
  it('GETs and resolves to the parsed response', async () => {
    const { calls } = stubFetch([jsonResponse({ name: 'Wi-Fi', content: '# Wi-Fi' })])

    await expect(getJson('/BaseDocumentaire/fr/Notion/Wi-Fi.md')).resolves.toEqual({
      name: 'Wi-Fi',
      content: '# Wi-Fi',
    })
    expect(calls[0].method).toBe('GET')
  })

  it('forwards the abort signal', async () => {
    const { calls } = stubFetch([jsonResponse({})])
    const controller = new AbortController()
    await getJson('/x', { signal: controller.signal })

    expect(calls[0].signal).toBe(controller.signal)
  })

  it('throws the backend message on a non-OK status', async () => {
    stubFetch([jsonResponse({ message: 'Document not found' }, 404)])
    await expect(getJson('/x')).rejects.toThrow('Document not found')
  })
})

describe('getJsonOrNull — the /lab contract', () => {
  it('always sends the session cookie', async () => {
    const { calls } = stubFetch([jsonResponse({ login: 'admin' })])
    await getJsonOrNull('/auth/lab/me')

    expect(calls[0].credentials).toBe('include')
  })

  it('resolves to the payload on success', async () => {
    stubFetch([jsonResponse({ login: 'admin' })])
    await expect(getJsonOrNull('/auth/lab/me')).resolves.toEqual({ login: 'admin' })
  })

  it('returns null on a 401 rather than throwing — no session is a state, not an error', async () => {
    stubFetch([jsonResponse({ message: 'Invalid session' }, 401)])
    await expect(getJsonOrNull('/auth/lab/me')).resolves.toBeNull()
  })

  it('returns null on a 404 — the gate being off is also a state', async () => {
    stubFetch([jsonResponse({ message: 'Not Found' }, 404)])
    await expect(getJsonOrNull('/lab-data/tables')).resolves.toBeNull()
  })

  it('returns null when a 200 body will not parse', async () => {
    stubFetch([new Response('not json', { status: 200 })])
    await expect(getJsonOrNull('/lab-data/tables')).resolves.toBeNull()
  })
})

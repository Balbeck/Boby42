'use strict'

const { describe, it, after } = require('node:test')
const assert = require('node:assert')

const { generateAnswer, generateEmbedding } = require('../../services/ollama.service')
const {
  stubOllama, restoreFetch, jsonResponse, ndjsonResponse, connectionRefused
} = require('../ollamaStub')

after(restoreFetch)

describe('generateAnswer — request shape', () => {
  it('posts to /api/generate with the configured model and the explicit options', async () => {
    // num_ctx is set BECAUSE the model's Modelfile sets none: without it an
    // overflowing prompt is truncated silently, with no error and no log line.
    const calls = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) }).calls

    await generateAnswer('PROMPT')

    assert.strictEqual(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/api/generate'))
    assert.deepStrictEqual(calls[0].body, {
      model: process.env.OLLAMA_GENERATION_MODEL,
      prompt: 'PROMPT',
      stream: false,
      options: { num_ctx: 16384, temperature: 0.2, num_predict: 600 }
    })
  })

  it('merges per-call options over the defaults', async () => {
    const calls = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) }).calls
    await generateAnswer('PROMPT', { temperature: 0.9, top_p: 0.5 })

    assert.deepStrictEqual(calls[0].body.options, {
      num_ctx: 16384, temperature: 0.9, num_predict: 600, top_p: 0.5
    })
  })

  it('asks for stream:false without onToken and stream:true with it', async () => {
    let calls = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) }).calls
    await generateAnswer('P')
    assert.strictEqual(calls[0].body.stream, false)

    calls = stubOllama({ '/api/generate': () => ndjsonResponse(['ok']) }).calls
    await generateAnswer('P', {}, { onToken: () => {} })
    assert.strictEqual(calls[0].body.stream, true)
  })
})

describe('generateAnswer — streaming', () => {
  it('calls onToken per fragment and returns them assembled', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['Bon', 'jour']) })

    const seen = []
    const answer = await generateAnswer('P', {}, { onToken: (value) => seen.push(value) })

    assert.deepStrictEqual(seen, ['Bon', 'jour'])
    assert.strictEqual(answer, 'Bonjour')
  })

  // The realistic network case: a TCP read can end anywhere, including mid-JSON.
  // A parser that assumes one chunk = whole lines loses or corrupts a fragment,
  // and the answer is simply missing a piece — nothing throws.
  it('reassembles an object split across two network chunks', async () => {
    stubOllama({
      '/api/generate': () => ndjsonResponse([], {
        chunks: ['{"response":"Bon', 'jour"}\n{"response":" 42"}\n{"done":true}\n']
      })
    })

    const seen = []
    const answer = await generateAnswer('P', {}, { onToken: (value) => seen.push(value) })

    assert.deepStrictEqual(seen, ['Bonjour', ' 42'])
    assert.strictEqual(answer, 'Bonjour 42')
  })

  it('skips a malformed line and blank lines instead of aborting the stream', async () => {
    stubOllama({
      '/api/generate': () => ndjsonResponse([], {
        chunks: ['{"response":"a"}\n', 'not json\n', '\n', '{"response":"b"}\n{"done":true}\n']
      })
    })
    assert.strictEqual(await generateAnswer('P', {}, { onToken: () => {} }), 'ab')
  })

  it('throws when a stream line carries an `error` field', async () => {
    stubOllama({
      '/api/generate': () => ndjsonResponse([], {
        chunks: ['{"response":"a"}\n{"error":"model not found"}\n']
      })
    })
    await assert.rejects(
      () => generateAnswer('P', {}, { onToken: () => {} }),
      /Ollama stream error: model not found/
    )
  })

  it('ignores the terminal done line, which carries no text', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['only']) })
    const seen = []
    await generateAnswer('P', {}, { onToken: (value) => seen.push(value) })
    assert.deepStrictEqual(seen, ['only'])
  })
})

describe('ollamaFetch — telling "down" apart from "unhappy"', () => {
  // The distinction routes/archiviste.js and routes/chatDocuments.js branch
  // their 502 message on. Collapsing the two makes a dead Ollama look like a
  // broken document store.
  it('tags a connection failure as OLLAMA_UNREACHABLE and keeps the cause', async () => {
    stubOllama({ '/api/generate': () => { throw connectionRefused() } })

    await assert.rejects(() => generateAnswer('P'), (err) => {
      assert.strictEqual(err.code, 'OLLAMA_UNREACHABLE')
      assert.match(err.message, /Ollama is unreachable at/)
      // The original undici error is preserved whole: TypeError('fetch failed')
      // with the real socket error on its own `.cause`.
      assert.strictEqual(err.cause.message, 'fetch failed')
      assert.strictEqual(err.cause.cause.code, 'ECONNREFUSED')
      return true
    })
  })

  it('leaves a non-ok HTTP response alone — Ollama is reachable, just erroring', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ error: 'boom' }, 500) })

    await assert.rejects(() => generateAnswer('P'), (err) => {
      assert.match(err.message, /Ollama request failed with status 500/)
      assert.strictEqual(err.code, undefined, 'must NOT be tagged unreachable')
      return true
    })
  })

  it('passes an AbortError through untouched, so a client hang-up is not "down"', async () => {
    const controller = new AbortController()
    controller.abort()
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'unused' }) })

    await assert.rejects(
      () => generateAnswer('P', {}, { signal: controller.signal }),
      (err) => {
        assert.strictEqual(err.name, 'AbortError')
        assert.strictEqual(err.code, undefined)
        return true
      }
    )
  })

  it('forwards the AbortSignal to fetch', async () => {
    const controller = new AbortController()
    let seenSignal
    globalThis.fetch = async (url, init) => {
      seenSignal = init.signal
      return jsonResponse({ response: 'ok' })
    }
    await generateAnswer('P', {}, { signal: controller.signal })
    assert.strictEqual(seenSignal, controller.signal)
  })
})

describe('generateEmbedding', () => {
  it('posts the text to /api/embeddings with the embedding model and returns the vector', async () => {
    const calls = stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: [0.1, 0.2, 0.3] })
    }).calls

    const vector = await generateEmbedding('une question')

    assert.deepStrictEqual(vector, [0.1, 0.2, 0.3])
    assert.deepStrictEqual(calls[0].body, {
      model: process.env.OLLAMA_EMBEDDING_MODEL,
      prompt: 'une question'
    })
  })

  it('throws on a non-ok response', async () => {
    stubOllama({ '/api/embeddings': () => jsonResponse({}, 503) })
    await assert.rejects(() => generateEmbedding('x'), /status 503/)
  })

  it('tags a connection failure as OLLAMA_UNREACHABLE', async () => {
    stubOllama({ '/api/embeddings': () => { throw connectionRefused() } })
    await assert.rejects(() => generateEmbedding('x'), (err) => err.code === 'OLLAMA_UNREACHABLE')
  })
})

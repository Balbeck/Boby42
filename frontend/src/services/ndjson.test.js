import { describe, expect, it } from 'vitest'
import { readNdjson } from './ndjson.js'

// `readNdjson` only ever touches `response.body.getReader()`, so a plain object
// carrying a `ReadableStream` is a faithful stand-in — and keeps the test from
// depending on whether the jsdom environment exposes a real `Response`.
/**
 * @param {(string | Uint8Array)[]} chunks one network read each, in order
 * @returns {Response}
 */
function responseOf(chunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
  return /** @type {Response} */ (/** @type {unknown} */ ({ body: stream }))
}

/**
 * @param {(string | Uint8Array)[]} chunks
 * @returns {Promise<any[]>}
 */
async function collect(chunks) {
  const seen = /** @type {any[]} */ ([])
  await readNdjson(responseOf(chunks), (obj) => seen.push(obj))
  return seen
}

describe('readNdjson', () => {
  it('delivers well-formed lines in order, as parsed objects', async () => {
    const seen = await collect([
      '{"type":"token","value":"Bon"}\n{"type":"token","value":"jour"}\n',
      '{"type":"done","answer":"Bonjour","messageId":"m1"}\n',
    ])

    expect(seen).toEqual([
      { type: 'token', value: 'Bon' },
      { type: 'token', value: 'jour' },
      { type: 'done', answer: 'Bonjour', messageId: 'm1' },
    ])
  })

  it('delivers an object split across two chunks once, whole', async () => {
    // The realistic network case: a TCP read can end anywhere, including mid-JSON.
    const seen = await collect(['{"type":"done","answ', 'er":"ok","messageId":"m1"}\n'])

    expect(seen).toEqual([{ type: 'done', answer: 'ok', messageId: 'm1' }])
  })

  it('reassembles a multi-byte character split across two chunks', async () => {
    // 'é' is two bytes in UTF-8; a naive per-chunk decode yields two replacement
    // characters and the JSON no longer parses — the line would vanish silently.
    const bytes = new TextEncoder().encode('{"type":"token","value":"é"}\n')
    const cut = bytes.indexOf(0xc3) + 1

    const seen = await collect([bytes.slice(0, cut), bytes.slice(cut)])

    expect(seen).toEqual([{ type: 'token', value: 'é' }])
  })

  it('delivers a final line that carries no trailing newline', async () => {
    // The guard that protects /chat's terminal `done` frame: lose it and the
    // answer still shows, but messageId/conversationId are gone — no 👍/👎, and
    // the next question opens a fresh conversation, with no error anywhere.
    const seen = await collect([
      '{"type":"token","value":"hi"}\n',
      '{"type":"done","answer":"hi","messageId":"m1","conversationId":"c1"}',
    ])

    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual({
      type: 'done',
      answer: 'hi',
      messageId: 'm1',
      conversationId: 'c1',
    })
  })

  it('skips a malformed line without throwing, and keeps reading', async () => {
    const seen = await collect([
      '{"type":"token","value":"a"}\n',
      'not json at all\n',
      '\n',
      '{"type":"token","value":"b"}\n',
    ])

    expect(seen).toEqual([
      { type: 'token', value: 'a' },
      { type: 'token', value: 'b' },
    ])
  })

  it('propagates an error thrown by the callback', async () => {
    // chatApi throws on a {type:'error'} frame; that must abort the read loop
    // and reach the caller rather than be swallowed here.
    const seen = /** @type {any[]} */ ([])

    await expect(
      readNdjson(
        responseOf(['{"type":"token","value":"a"}\n{"type":"error","message":"boom"}\n{"type":"token","value":"b"}\n']),
        (obj) => {
          if (obj.type === 'error') throw new Error(obj.message)
          seen.push(obj)
        },
      ),
    ).rejects.toThrow('boom')

    expect(seen).toEqual([{ type: 'token', value: 'a' }])
  })
})

// Reads an `application/x-ndjson` response body: one JSON object per line.
// `chatApi.sendMessage` and `ollamaApi.generate` share this loop; each passes a
// callback handling one parsed object (a token / done / error frame for `/chat`,
// an incremental `{ response }` chunk for the `/lab` 💬 console).
//
// A malformed line is skipped. Errors thrown by `onObject` are NOT caught —
// `chatApi` throws on a `{type:'error'}` frame and that must abort the read loop
// and propagate to the caller.
//
// Trailing-buffer guard (F4): the loop exits on the reader's `done` and would
// drop whatever is left unterminated in the buffer. The backend does end every
// line with a `\n`, but a writer or proxy that ever omits the final newline
// would silently cost `/chat` its terminal `done` frame — and with it
// `messageId` + `conversationId` (the answer still shows, the 👍/👎 buttons
// never do, the next question opens a fresh conversation). So the decoder is
// flushed after the loop and a non-empty remainder is replayed through the same
// parse-and-dispatch path.

/**
 * @param {Response} response
 * @param {(obj: any) => void} onObject
 * @returns {Promise<void>}
 */
export async function readNdjson(response, onObject) {
  // `body` is non-null on a streamed 2xx response — asserted, not guarded.
  const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  /** @param {string} line */
  function handleLine(line) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      return
    }
    onObject(obj)
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      handleLine(line)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer.trim())
}

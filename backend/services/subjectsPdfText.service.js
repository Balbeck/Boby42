'use strict'

const fs = require('node:fs/promises')
const { PDFParse } = require('pdf-parse')

// Extracted subject-PDF text, memoised by absolute path and never evicted. The
// whole corpus is 48 subjects / ~0.77 MB of text, so a fully warm cache is
// nothing; at most 3 subjects reach a single answer, each extracted once
// (190-230 ms in-container) then served from here.
const cache = new Map()

/**
 * Reads one subject PDF and returns its plain text, cached forever by absolute
 * path. Extraction NEVER throws: a broken PDF is caught, logged, and yields
 * `null` so `loadDocuments()` keeps the row (still shown and previewable on the
 * page) with no content — an answer is never broken by a failed extraction.
 *
 * The text is returned as `pdf-parse` produces it — no cleaning, no reflow, no
 * stripping of the `-- N of M --` page markers (measured at 1.7 % of the corpus).
 *
 * @param {string} absolutePath - resolved path from resolveSubjectsPdfFile(), never request input
 * @returns {Promise<string | null>}
 */
async function readSubjectsPdfText (absolutePath) {
  if (cache.has(absolutePath)) return cache.get(absolutePath)

  let parser
  try {
    const buf = await fs.readFile(absolutePath)
    parser = new PDFParse({ data: new Uint8Array(buf) })
    const result = await parser.getText()
    cache.set(absolutePath, result.text)
    return result.text
  } catch (err) {
    console.warn(`[subjectsPdfText] extraction failed: ${absolutePath} — ${err.message}`)
    return null
  } finally {
    if (parser) {
      try {
        await parser.destroy()
      } catch { /* nothing to do — the text is already cached or the read failed */ }
    }
  }
}

module.exports = { readSubjectsPdfText }

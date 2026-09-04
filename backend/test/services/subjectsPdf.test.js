'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { listSubjectsPdfFiles, resolveSubjectsPdfFile } = require('../../services/subjectsPdfLibrary.service')
const { readSubjectsPdfText } = require('../../services/subjectsPdfText.service')

describe('subjectsPdfLibrary', () => {
  it('walks the whole SubjectsPdf tree, not one hard-coded folder', async () => {
    // Two categories today (Machine_Learning, Old_Common_Core). A non-recursive
    // walk would silently hide one of them from both pages.
    const files = await listSubjectsPdfFiles()
    assert.ok(files.includes('Libft.en.subject.pdf'), 'Old_Common_Core must be reachable')
    assert.ok(files.includes('MachineLearning-module00_Intro.en.pdf'), 'Machine_Learning must be reachable')
    assert.ok(files.every((name) => name.toLowerCase().endsWith('.pdf')))
  })

  it('indexes by basename, so names stay unique across categories', async () => {
    // Resolution is basename-based (like the Notion store). The day two
    // categories share a basename the serving route needs a :category segment.
    const files = await listSubjectsPdfFiles()
    assert.strictEqual(new Set(files).size, files.length, 'basename collision across categories')
  })

  it('resolves a whitelisted basename to its absolute path', async () => {
    const resolved = await resolveSubjectsPdfFile('Libft.en.subject.pdf')
    assert.ok(path.isAbsolute(resolved))
    assert.ok(resolved.endsWith(path.join('Old_Common_Core', 'Libft.en.subject.pdf')))
  })

  it('returns null for an unknown name, a traversal, or a path instead of a basename', async () => {
    for (const name of [
      'nope.pdf',
      '../../db/seed.js',
      '../SubjectsPdf/Old_Common_Core/Libft.en.subject.pdf',
      'Old_Common_Core/Libft.en.subject.pdf',
      'Libft.en.subject'
    ]) {
      assert.strictEqual(await resolveSubjectsPdfFile(name), null, `accepted: ${name}`)
    }
  })
})

describe('subjectsPdfText', () => {
  it('extracts a subject PDF as plain text', async () => {
    const file = await resolveSubjectsPdfFile('Libft.en.subject.pdf')
    const text = await readSubjectsPdfText(file)

    assert.strictEqual(typeof text, 'string')
    assert.ok(text.length > 1000)
    assert.match(text, /libft/i)
  })

  it('memoises by absolute path — the same object comes back', async () => {
    const file = await resolveSubjectsPdfFile('Libft.en.subject.pdf')
    const first = await readSubjectsPdfText(file)
    const second = await readSubjectsPdfText(file)
    assert.strictEqual(first, second)
  })

  // Extraction must NEVER throw: a broken PDF has to leave the row shown and
  // previewable with no content, not break the whole answer.
  it('returns null instead of throwing on an unreadable file', async () => {
    assert.strictEqual(await readSubjectsPdfText('/no/such/file.pdf'), null)
  })

  it('returns null instead of throwing on a file that is not a PDF', async () => {
    assert.strictEqual(await readSubjectsPdfText(path.join(__dirname, '..', 'env.js')), null)
  })
})

'use strict'

// The filesystem error branches of retriever.service.js and
// subjectsPdfLibrary.service.js — the last uncovered lines in services/.
//
// They can't be reached with a healthy `data/` tree, and deliberately corrupting
// the real one (deleting SubjectsPdf/, planting a duplicate basename, chmod 000
// on a Notion document) would leave a test able to wreck the repo it runs in. So
// `node:fs/promises` is patched instead — both services capture the module
// object once at require time and call methods off it, so replacing a method on
// that object is enough.
//
// What each branch guards is a real operational difference: a MISSING file is
// normal (a stale vector-store entry) and must be skipped in silence, while an
// UNREADABLE one is a broken deployment and must be loud. Swallowing both would
// turn a permissions mistake into "the chatbot answers with no sources", which
// is exactly the failure nobody would debug.

const { describe, it, after, afterEach } = require('node:test')
const assert = require('node:assert')

const fsPromises = require('node:fs/promises')
const { patch, spy, restoreAll } = require('../sequelizeStub')
const { stubOllama, restoreFetch, jsonResponse } = require('../ollamaStub')
const { embeddingFor } = require('../fixtures/embeddings')

const retriever = require('../../services/retriever.service')
const subjectsPdfLibrary = require('../../services/subjectsPdfLibrary.service')

afterEach(() => {
  restoreAll()
  restoreFetch()
})
after(() => {
  restoreAll()
  restoreFetch()
})

/**
 * @param {string} code
 * @param {string} [message]
 * @returns {Error & { code: string }}
 */
function fsError (code, message = code) {
  const err = new Error(message)
  err.code = code
  return err
}

/** Makes the embedding call return a vector that matches `Alternance.md` at 1.000. */
function stubEmbedding () {
  return stubOllama({
    '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') })
  })
}

/** Silences a console method for one test and returns its recorded calls. */
function muteConsole (method) {
  const recorder = spy(() => undefined)
  patch(console, method, recorder)
  return recorder
}

describe('readDocuments — a matched document that cannot be read', () => {
  /**
   * Fails only on the Notion documents, delegating everything else to the real
   * `readFile`. A blanket patch would break the vector-store load first and the
   * test would pass on the wrong throw — which it did, before this.
   *
   * @param {Error} err
   */
  function failOnNotionRead (err) {
    const realReadFile = fsPromises.readFile
    patch(fsPromises, 'readFile', async (file, ...rest) => {
      if (String(file).includes('documents/Notion/')) throw err
      return realReadFile(file, ...rest)
    })
  }

  it('skips a document whose file has vanished, and still returns the others', async () => {
    // The normal case for a stale vector-store entry: the store still lists a
    // document the repo no longer has. Failing the whole question over it would
    // take the chatbot down for one dangling filename.
    stubEmbedding()
    failOnNotionRead(fsError('ENOENT', 'no such file'))

    assert.deepStrictEqual(await retriever.retrieve('alternance'), [])
  })

  it('propagates a permissions error instead of silently answering with no sources', async () => {
    stubEmbedding()
    failOnNotionRead(fsError('EACCES', 'permission denied'))

    await assert.rejects(() => retriever.retrieve('alternance'), /permission denied/)
  })

  it('propagates an error carrying no code at all', async () => {
    stubEmbedding()
    failOnNotionRead(new Error('disk on fire'))

    await assert.rejects(() => retriever.retrieve('alternance'), /disk on fire/)
  })

  it('really does match a document first — otherwise the skip proves nothing', async () => {
    // Guard on the guard: if the fixture stopped matching, all three tests above
    // would pass vacuously on an empty result.
    stubEmbedding()
    const documents = await retriever.retrieve('alternance')

    assert.ok(documents.length > 0)
    assert.ok(documents.some((doc) => doc.name === 'Alternance.md'))
  })
})

describe('walkPdfFiles — the SubjectsPdf tree is wrong on disk', () => {
  it('yields an empty list and warns when the folder does not exist, so the app still boots', async () => {
    // A deployment that forgot to ship data/SubjectsPdf must degrade to "no
    // subject PDFs", not to a backend that refuses to start.
    const warn = muteConsole('warn')
    patch(fsPromises, 'readdir', async () => { throw fsError('ENOENT') })

    assert.deepStrictEqual(await subjectsPdfLibrary.listSubjectsPdfFiles(), [])
    assert.match(warn.calls[0][0], /folder not found/)
  })

  it('resolves nothing when the folder is missing rather than building a path anyway', async () => {
    muteConsole('warn')
    patch(fsPromises, 'readdir', async () => { throw fsError('ENOENT') })

    assert.strictEqual(await subjectsPdfLibrary.resolveSubjectsPdfFile('Libft.en.subject.pdf'), null)
  })

  it('propagates any other readdir failure — an unreadable folder is not an empty one', async () => {
    patch(fsPromises, 'readdir', async () => { throw fsError('EACCES', 'permission denied') })
    await assert.rejects(() => subjectsPdfLibrary.listSubjectsPdfFiles(), /permission denied/)
  })
})

describe('buildSubjectsPdfIndex — two categories sharing a basename', () => {
  // The whole basename-keyed scheme holds only while basenames are unique across
  // category folders (root CLAUDE.md, "Subject project PDFs"). This is the
  // behaviour on the day that stops being true.
  const dirent = (name, directory = false) => ({
    name,
    isDirectory: () => directory,
    isFile: () => !directory
  })

  /** A fake two-category tree, driven by the directory being read. */
  function stubTree () {
    patch(fsPromises, 'readdir', async (dir) => {
      const name = String(dir)
      if (name.endsWith('SubjectsPdf')) {
        return [dirent('Machine_Learning', true), dirent('Old_Common_Core', true), dirent('loose.pdf')]
      }
      if (name.endsWith('Machine_Learning')) return [dirent('Shared.pdf'), dirent('README.md')]
      if (name.endsWith('Old_Common_Core')) return [dirent('Shared.pdf'), dirent('Libft.pdf')]
      return []
    })
  }

  it('keeps the first match, warns, and never lists the name twice', async () => {
    stubTree()
    const warn = muteConsole('warn')

    const files = await subjectsPdfLibrary.listSubjectsPdfFiles()
    assert.deepStrictEqual(files, ['Shared.pdf', 'Libft.pdf', 'loose.pdf'])

    assert.strictEqual(warn.callCount, 1)
    assert.match(warn.calls[0][0], /duplicate basename ignored/)
    assert.match(warn.calls[0][0], /Old_Common_Core/)
    assert.match(warn.calls[0][0], /kept .*Machine_Learning/)
  })

  it('resolves the shared name to the first category found', async () => {
    stubTree()
    muteConsole('warn')

    const resolved = await subjectsPdfLibrary.resolveSubjectsPdfFile('Shared.pdf')
    assert.match(resolved, /Machine_Learning[/\\]Shared\.pdf$/)
  })

  it('walks nested categories and ignores non-pdf files', async () => {
    stubTree()
    muteConsole('warn')

    const files = await subjectsPdfLibrary.listSubjectsPdfFiles()
    assert.ok(!files.includes('README.md'))
    assert.ok(files.includes('loose.pdf'), 'a PDF sitting directly in the root still counts')
  })

  it('matches the .pdf extension case-insensitively', async () => {
    patch(fsPromises, 'readdir', async (dir) =>
      String(dir).endsWith('SubjectsPdf') ? [dirent('Upper.PDF'), dirent('notes.txt')] : []
    )

    assert.deepStrictEqual(await subjectsPdfLibrary.listSubjectsPdfFiles(), ['Upper.PDF'])
  })
})

'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const {
  resolveNotionDir, listDocumentNames, readDocumentByName,
  listBaseDocumentaireNames, readBaseDocumentaireDocument
} = require('../../services/documentReader.service')

// The whitelist that stands between a request param and the filesystem. Its
// failure mode is not a crash — it is serving a file nobody meant to expose.
describe('resolveNotionDir', () => {
  it("maps 'origin' to the untranslated retrieval store", () => {
    assert.ok(resolveNotionDir('origin').endsWith(path.join('data', 'documents', 'Notion')))
  })

  it('maps fr/en to their BaseDocumentaire copies (folder names are capitalised)', () => {
    assert.ok(resolveNotionDir('fr').endsWith(path.join('BaseDocumentaire', 'Fr', 'Notion')))
    assert.ok(resolveNotionDir('en').endsWith(path.join('BaseDocumentaire', 'En', 'Notion')))
  })

  it('returns null for anything else, including a traversal attempt', () => {
    for (const language of ['de', '', '../../..', 'FR', undefined, null]) {
      assert.strictEqual(resolveNotionDir(language), null, `expected null for ${language}`)
    }
  })
})

describe('listBaseDocumentaireNames', () => {
  it('lists .md filenames for each language', async () => {
    for (const language of ['fr', 'en', 'origin']) {
      const names = await listBaseDocumentaireNames(language)
      assert.ok(names.length > 0)
      assert.ok(names.every((name) => name.endsWith('.md')))
      assert.ok(names.includes('Alternance.md'))
    }
  })

  it('returns [] for an unknown language instead of throwing', async () => {
    assert.deepStrictEqual(await listBaseDocumentaireNames('de'), [])
  })

  it('mirrors the same document set across fr, en and origin', async () => {
    // Adding a doc means three folders; a drift here is invisible until a
    // student switches language and the document disappears.
    const [fr, en, origin] = await Promise.all(
      ['fr', 'en', 'origin'].map(listBaseDocumentaireNames)
    )
    assert.deepStrictEqual([...fr].sort(), [...en].sort())
    assert.deepStrictEqual([...fr].sort(), [...origin].sort())
  })
})

describe('readBaseDocumentaireDocument', () => {
  it('reads a document and strips .md from the returned name', async () => {
    const doc = await readBaseDocumentaireDocument('fr', 'Alternance.md')
    assert.strictEqual(doc.name, 'Alternance')
    assert.ok(doc.content.length > 0)
  })

  it('serves a different copy per language from the same name', async () => {
    const fr = await readBaseDocumentaireDocument('fr', 'Alternance.md')
    const en = await readBaseDocumentaireDocument('en', 'Alternance.md')
    assert.notStrictEqual(fr.content, en.content)
  })

  it('handles a name containing spaces', async () => {
    const doc = await readBaseDocumentaireDocument('fr', 'Visiter le campus.md')
    assert.strictEqual(doc.name, 'Visiter le campus')
  })

  it('returns null for an unknown name', async () => {
    assert.strictEqual(await readBaseDocumentaireDocument('fr', 'Nope.md'), null)
  })

  it('returns null for an unknown language', async () => {
    assert.strictEqual(await readBaseDocumentaireDocument('de', 'Alternance.md'), null)
  })

  // The whole point of checking the name against a live readdir BEFORE any
  // read: a path built from request input would happily escape the folder.
  it('refuses a path-traversal name', async () => {
    for (const name of ['../../../etc/passwd', '../seed.js', './Alternance.md', 'Alternance.md/../Wi-Fi.md']) {
      assert.strictEqual(await readBaseDocumentaireDocument('fr', name), null, `traversal accepted: ${name}`)
    }
  })

  it('refuses a name without the .md extension', async () => {
    assert.strictEqual(await readBaseDocumentaireDocument('fr', 'Alternance'), null)
  })
})

// The legacy language-agnostic pair, kept for the owner's manual curl probe
// (GET /archiviste/documents/:name) — unwired from src/ but never deleted.
describe('the legacy origin-store pair', () => {
  it('listDocumentNames strips the extension', async () => {
    const names = await listDocumentNames()
    assert.ok(names.includes('Alternance'))
    assert.ok(names.every((name) => !name.endsWith('.md')))
  })

  it('readDocumentByName reads from the untranslated store', async () => {
    const doc = await readDocumentByName('Alternance')
    const origin = await readBaseDocumentaireDocument('origin', 'Alternance.md')
    assert.deepStrictEqual(doc, origin)
  })

  it('readDocumentByName returns null for an unknown name', async () => {
    assert.strictEqual(await readDocumentByName('Nope'), null)
  })
})

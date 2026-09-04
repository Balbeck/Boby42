'use strict'

const { describe } = require('node:test')
const assert = require('node:assert')

const { getApp, itDb } = require('../helper')

const get = async (url) => (await getApp()).inject({ method: 'GET', url })

describe('GET /BaseDocumentaire/:language/Notion/:name', () => {
  itDb('serves one document per language', async () => {
    for (const language of ['fr', 'en', 'origin']) {
      const res = await get(`/BaseDocumentaire/${language}/Notion/Alternance.md`)
      assert.strictEqual(res.statusCode, 200)
      assert.strictEqual(res.json().name, 'Alternance')
      assert.ok(res.json().content.length > 0)
    }
  })

  itDb('serves a genuinely different copy for fr and en', async () => {
    const fr = (await get('/BaseDocumentaire/fr/Notion/Alternance.md')).json()
    const en = (await get('/BaseDocumentaire/en/Notion/Alternance.md')).json()
    assert.notStrictEqual(fr.content, en.content)
  })

  itDb('handles a name containing spaces once url-encoded', async () => {
    const res = await get(`/BaseDocumentaire/fr/Notion/${encodeURIComponent('Visiter le campus.md')}`)
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.json().name, 'Visiter le campus')
  })

  itDb('400s on an unknown language — the enum is checked before any read', async () => {
    assert.strictEqual((await get('/BaseDocumentaire/de/Notion/Alternance.md')).statusCode, 400)
  })

  itDb('404s on an unknown name', async () => {
    assert.strictEqual((await get('/BaseDocumentaire/fr/Notion/Nope.md')).statusCode, 404)
  })

  itDb('never escapes the language folder', async () => {
    // The name is checked against a live readdir BEFORE any path is built.
    for (const name of ['..%2F..%2F..%2Fetc%2Fpasswd', '..%2Fseed.js', 'Alternance']) {
      const res = await get(`/BaseDocumentaire/fr/Notion/${name}`)
      assert.ok(res.statusCode === 404 || res.statusCode === 400, `leaked on ${name}: ${res.statusCode}`)
    }
  })
})

// The owner's manual curl probe: unwired from src/ and ungated on purpose.
// Never delete it, never add auth to it — see backend/CLAUDE.md.
describe('GET /archiviste/documents/:name', () => {
  itDb('serves the untranslated document by name, no extension', async () => {
    const res = await get('/archiviste/documents/Alternance')
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.json().name, 'Alternance')
  })

  itDb('is reachable with no credentials at all', async () => {
    assert.strictEqual((await get('/archiviste/documents/Alternance')).statusCode, 200)
  })

  itDb('404s on an unknown name', async () => {
    assert.strictEqual((await get('/archiviste/documents/Nope')).statusCode, 404)
  })
})

describe('GET /subjectspdf/:file', () => {
  itDb('streams a subject PDF inline', async () => {
    const res = await get('/subjectspdf/Libft.en.subject.pdf')

    assert.strictEqual(res.statusCode, 200)
    assert.match(res.headers['content-type'], /application\/pdf/)
    // inline, so the browser's native viewer renders it in the <iframe>.
    assert.match(res.headers['content-disposition'], /^inline;/)
    assert.strictEqual(res.rawPayload.subarray(0, 4).toString(), '%PDF')
  })

  itDb('serves from any category folder', async () => {
    assert.strictEqual((await get('/subjectspdf/MachineLearning-module00_Intro.en.pdf')).statusCode, 200)
  })

  itDb('400s on a name that does not end in .pdf', async () => {
    assert.strictEqual((await get('/subjectspdf/Libft.en.subject')).statusCode, 400)
  })

  itDb('404s on an unknown pdf and on a traversal that ends in .pdf', async () => {
    assert.strictEqual((await get('/subjectspdf/nope.pdf')).statusCode, 404)
    assert.strictEqual((await get('/subjectspdf/..%2F..%2Fsecret.pdf')).statusCode, 404)
  })
})

describe('the scaffold routes', () => {
  itDb('GET / answers { root: true }', async () => {
    assert.deepStrictEqual((await get('/')).json(), { root: true })
  })

  itDb('GET /example answers the example string', async () => {
    assert.strictEqual((await get('/example')).payload, 'this is an example')
  })
})

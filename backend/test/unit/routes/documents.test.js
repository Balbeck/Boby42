'use strict'

// Unit suite for the three document-serving routes — no Postgres, no stubs.
//
// `documentReader.service.js` and `subjectsPdfLibrary.service.js` run for real
// here, against the repository's own `data/` tree: they are pure filesystem
// readers with no DB and no Ollama, so stubbing them would remove the only thing
// worth checking — that a request param can never become a path. Every rejection
// below is a real `fs.readdir` whitelist saying no.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')

const { buildRouteApp } = require('../../routeApp')

const baseDocumentaireRoute = require('../../../routes/baseDocumentaire')
const archivisteDocumentRoute = require('../../../routes/archivisteDocument')
const subjectspdfRoute = require('../../../routes/subjectspdf')

// Real names from data/. `Badge perdu.md` carries a space on purpose — the
// frontend calls the URL the search route built, so encoding has to survive.
const DOC = 'Badge perdu.md'
const PDF = '42_Multilayer_Perceptron.en.subject.pdf'

/** @type {import('fastify').FastifyInstance} */
let app
before(async () => {
  app = await buildRouteApp(async function (fastify) {
    await fastify.register(baseDocumentaireRoute)
    await fastify.register(archivisteDocumentRoute)
    await fastify.register(subjectspdfRoute)
  })
})
after(async () => app.close())

const get = (url) => app.inject({ method: 'GET', url })

describe('GET /BaseDocumentaire/:language/Notion/:name', () => {
  for (const language of ['fr', 'en', 'origin']) {
    it(`serves a document in ${language}`, async () => {
      const res = await get(`/BaseDocumentaire/${language}/Notion/${encodeURIComponent(DOC)}`)

      assert.strictEqual(res.statusCode, 200)
      // The response `name` comes back WITHOUT the extension, even though the
      // URL requires it — the archiviste bare-name convention.
      assert.strictEqual(res.json().name, 'Badge perdu')
      assert.ok(res.json().content.length > 0)
    })
  }

  it('serves a different copy per language — the mapping is not decorative', async () => {
    const fr = (await get(`/BaseDocumentaire/fr/Notion/${encodeURIComponent(DOC)}`)).json().content
    const en = (await get(`/BaseDocumentaire/en/Notion/${encodeURIComponent(DOC)}`)).json().content

    assert.notStrictEqual(fr, en)
  })

  it('reads the untranslated retrieval store for `origin`', async () => {
    // origin is a DOCUMENT choice, not a UI locale: it serves documents/Notion/,
    // the same files retrieval scores against.
    const origin = (await get(`/BaseDocumentaire/origin/Notion/${encodeURIComponent(DOC)}`)).json().content
    const fr = (await get(`/BaseDocumentaire/fr/Notion/${encodeURIComponent(DOC)}`)).json().content

    assert.ok(origin.length > 0)
    assert.notStrictEqual(origin, fr)
  })

  it('handles a name containing a space', async () => {
    const res = await get('/BaseDocumentaire/fr/Notion/Badge%20perdu.md')
    assert.strictEqual(res.statusCode, 200)
  })

  it('400s on an unknown language rather than probing the filesystem', async () => {
    const res = await get(`/BaseDocumentaire/de/Notion/${encodeURIComponent(DOC)}`)
    assert.strictEqual(res.statusCode, 400)
  })

  it('404s on an unknown document', async () => {
    const res = await get('/BaseDocumentaire/fr/Notion/Nope.md')
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Document not found')
  })

  it('404s on a name missing its .md extension — the whitelist is exact', async () => {
    const res = await get('/BaseDocumentaire/fr/Notion/Badge%20perdu')
    assert.strictEqual(res.statusCode, 404)
  })

  const traversals = [
    ['an encoded parent traversal', '..%2F..%2Fpackage.json'],
    ['a double-encoded traversal', '..%252F..%252Fpackage.json'],
    ['an absolute path', '%2Fetc%2Fpasswd'],
    ['a sibling store file', '..%2F..%2Fvector_store.json']
  ]

  for (const [label, name] of traversals) {
    it(`refuses ${label}`, async () => {
      const res = await get(`/BaseDocumentaire/fr/Notion/${name}`)

      // 404 (not whitelisted) or 400/404 from the router — never 200.
      assert.notStrictEqual(res.statusCode, 200)
      assert.ok(!res.payload.includes('"dependencies"'), 'a file outside the store was served')
    })
  }
})

describe('GET /archiviste/documents/:name', () => {
  // The owner's manual curl probe: deliberately unwired and ungated. It serves
  // documents/Notion/ with no language segment and no .md extension.
  it('serves a document by bare name', async () => {
    const res = await get('/archiviste/documents/Badge%20perdu')

    assert.strictEqual(res.statusCode, 200)
    assert.ok(res.json().content.length > 0)
  })

  it('404s on an unknown name', async () => {
    const res = await get('/archiviste/documents/Nope')
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Document not found')
  })

  it('refuses a traversal', async () => {
    const res = await get('/archiviste/documents/..%2F..%2Fpackage.json')
    assert.notStrictEqual(res.statusCode, 200)
  })
})

describe('GET /subjectspdf/:file', () => {
  it('streams the PDF inline so the browser renders it in place', async () => {
    const res = await get(`/subjectspdf/${encodeURIComponent(PDF)}`)

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers['content-type'], 'application/pdf')
    assert.strictEqual(res.headers['content-disposition'], `inline; filename="${PDF}"`)
    // A real PDF, not an error page that happened to get the right header.
    assert.strictEqual(res.rawPayload.subarray(0, 4).toString(), '%PDF')
  })

  it('404s on an unknown subject', async () => {
    const res = await get('/subjectspdf/Nope.pdf')
    assert.strictEqual(res.statusCode, 404)
    assert.strictEqual(res.json().message, 'Subject PDF not found')
  })

  it('400s on a name that does not end in .pdf', async () => {
    const res = await get('/subjectspdf/package.json')
    assert.strictEqual(res.statusCode, 400)
  })

  it('404s a traversal that ends in .pdf — the pattern is not the guard', async () => {
    // The `\.pdf$` pattern only filters the shape; the basename whitelist in
    // subjectsPdfLibrary is what actually refuses this.
    const res = await get('/subjectspdf/..%2F..%2Fsecret.pdf')
    assert.strictEqual(res.statusCode, 404)
  })

  it('resolves by basename, so a path prefix does not help', async () => {
    const res = await get(`/subjectspdf/${encodeURIComponent('Machine_Learning/' + PDF)}`)
    assert.strictEqual(res.statusCode, 404)
  })
})

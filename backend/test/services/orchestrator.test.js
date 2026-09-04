'use strict'

const { describe, it, after } = require('node:test')
const assert = require('node:assert')

const { getAnswer, selectPromptDocuments, buildPrompt } = require('../../services/orchestrator.service')
const { stubOllama, restoreFetch, jsonResponse, ndjsonResponse } = require('../ollamaStub')
const { embeddingFor, embeddingMatchingNothing } = require('../fixtures/embeddings')

after(restoreFetch)

const MAX_CONTEXT_CHARS = 24000
const MAX_CHARS_PER_DOC = 15000
const MAX_CHARS_PER_PDF = 8000

/**
 * @param {string} name
 * @param {'md'|'pdf'} type
 * @param {number} score
 * @param {number|string} content length to fill, or the literal content
 */
const row = (name, type, score, content) => ({
  name,
  type,
  score,
  content: typeof content === 'number' ? 'x'.repeat(content) : content
})

// What actually reaches the model. Every rule here was measured (see
// backend/CLAUDE.md → "Prompt building") and every failure mode is silent: the
// answer still comes back, just built on the wrong documents or a truncated
// context Ollama never complains about.
describe('selectPromptDocuments', () => {
  it('sorts md rows by descending score — retrieval order is not relevance order', () => {
    const selected = selectPromptDocuments([
      row('Low', 'md', 0.90, 'low'),
      row('High', 'md', 0.95, 'high'),
      row('Mid', 'md', 0.92, 'mid')
    ])
    assert.deepStrictEqual(selected.map((doc) => doc.name), ['High', 'Mid', 'Low'])
  })

  it('puts every md row before every pdf row, whatever the scores', () => {
    // Notion keeps priority on the shared budget even when a subject scores higher.
    const selected = selectPromptDocuments([
      row('Subject', 'pdf', 1.0, 'pdf text'),
      row('Notion', 'md', 0.89, 'md text')
    ])
    assert.deepStrictEqual(selected.map((doc) => doc.type), ['md', 'pdf'])
  })

  it('drops rows with no content (an unresolved doc or a failed extraction)', () => {
    const selected = selectPromptDocuments([
      { name: 'Empty', type: 'md', score: 0.99, content: null },
      { name: 'Blank', type: 'pdf', score: 0.99, content: '' },
      row('Real', 'md', 0.9, 'text')
    ])
    assert.deepStrictEqual(selected.map((doc) => doc.name), ['Real'])
  })

  it('caps one md row at MAX_CHARS_PER_DOC and marks the cut with [...]', () => {
    const [doc] = selectPromptDocuments([row('Big', 'md', 1, MAX_CHARS_PER_DOC + 500)])
    assert.strictEqual(doc.text.length, MAX_CHARS_PER_DOC + '\n\n[...]'.length)
    assert.ok(doc.text.endsWith('\n\n[...]'))
  })

  it('leaves a document that fits untouched — no [...] marker', () => {
    const [doc] = selectPromptDocuments([row('Small', 'md', 1, 'short')])
    assert.strictEqual(doc.text, 'short')
  })

  it('stops once the shared character budget is spent', () => {
    // 15 000 + 9 000 fills the 24 000 budget exactly; the third row gets nothing.
    const selected = selectPromptDocuments([
      row('A', 'md', 0.99, MAX_CHARS_PER_DOC),
      row('B', 'md', 0.98, MAX_CHARS_PER_DOC),
      row('C', 'md', 0.97, MAX_CHARS_PER_DOC)
    ])
    assert.deepStrictEqual(selected.map((doc) => doc.name), ['A', 'B'])
    const used = selected.reduce((n, doc) => n + doc.text.replace('\n\n[...]', '').length, 0)
    assert.strictEqual(used, MAX_CONTEXT_CHARS)
  })

  it('caps each pdf row at MAX_CHARS_PER_PDF when several subjects come back', () => {
    // Three at full size would overflow the 16 384-token window, which Ollama
    // truncates SILENTLY — this cap is what keeps all three inside it.
    const selected = selectPromptDocuments([
      row('S1', 'pdf', 0.99, 40000),
      row('S2', 'pdf', 0.98, 40000)
    ])
    for (const doc of selected) {
      assert.strictEqual(doc.text.replace('\n\n[...]', '').length, MAX_CHARS_PER_PDF)
    }
  })

  it('gives a LONE subject the whole budget instead of the per-pdf cap', () => {
    const [doc] = selectPromptDocuments([row('OnlySubject', 'pdf', 0.99, 40000)])
    assert.strictEqual(doc.text.replace('\n\n[...]', '').length, MAX_CONTEXT_CHARS)
  })

  it('keeps the per-pdf cap as soon as one md row is present', () => {
    const selected = selectPromptDocuments([
      row('Notion', 'md', 0.99, 'md'),
      row('Subject', 'pdf', 0.98, 40000)
    ])
    const pdf = selected.find((doc) => doc.type === 'pdf')
    assert.strictEqual(pdf.text.replace('\n\n[...]', '').length, MAX_CHARS_PER_PDF)
  })

  it('does not mutate its input — the full list is still what gets logged', () => {
    const input = [row('A', 'md', 0.9, 'aaa')]
    const snapshot = JSON.parse(JSON.stringify(input))
    selectPromptDocuments(input)
    assert.deepStrictEqual(input, snapshot)
  })

  it('returns [] for an empty list — the no-documents fallback depends on it', () => {
    assert.deepStrictEqual(selectPromptDocuments([]), [])
  })
})

describe('buildPrompt', () => {
  const docs = [{ name: 'Alternance', type: 'md', text: 'CONTENU' }]

  it("uses the French template for 'fr', absent and 'origin'", () => {
    for (const language of ['fr', undefined, 'origin']) {
      const prompt = buildPrompt('question ?', docs, language)
      assert.match(prompt, /Tu es Boby42/)
      assert.match(prompt, /Réponds dans la langue de la question/)
    }
  })

  it("uses the English template for 'en', whose rule 5 pins the answer language", () => {
    const prompt = buildPrompt('question ?', docs, 'en')
    assert.match(prompt, /You are Boby42/)
    // The whole point of the split: a French question in the English UI must
    // still come back in English.
    assert.match(prompt, /Always answer in English/)
    assert.doesNotMatch(prompt, /Réponds dans la langue/)
  })

  it('renders md and pdf under the SAME bare-name header', () => {
    // A distinct pdf header was measured worse: mistral copied it into its
    // [...] citation tag instead of citing the bare document name.
    const prompt = buildPrompt('q', [
      { name: 'Alternance', type: 'md', text: 'A' },
      { name: 'Libft.en.subject', type: 'pdf', text: 'B' }
    ], 'fr')
    assert.match(prompt, /--- Document : Alternance ---\nA/)
    assert.match(prompt, /--- Document : Libft\.en\.subject ---\nB/)
    assert.doesNotMatch(prompt, /Sujet de projet 42/)
  })

  it('carries the question and every document body', () => {
    const prompt = buildPrompt('où est la cafétéria ?', docs, 'fr')
    assert.ok(prompt.includes('où est la cafétéria ?'))
    assert.ok(prompt.includes('CONTENU'))
  })
})

describe('getAnswer', () => {
  it('re-resolves the given rows through the whitelist and never uses their url', async () => {
    const calls = stubOllama({
      '/api/generate': () => jsonResponse({ response: '  Voici la réponse.  ' })
    }).calls

    const { answer, sources } = await getAnswer(
      'alternance ?',
      // A hostile url: it must be ignored, the name is what gets resolved.
      [{ name: 'Alternance', type: 'md', score: 0.95, url: '/../../etc/passwd' }],
      'fr'
    )

    assert.strictEqual(answer, 'Voici la réponse.', 'the answer is trimmed')
    assert.strictEqual(sources.length, 1)
    assert.strictEqual(sources[0].name, 'Alternance')
    // The resolved path is the language copy, never anything from the request.
    assert.ok(sources[0].path.endsWith('/BaseDocumentaire/Fr/Notion/Alternance.md'))
    assert.strictEqual(calls.length, 1, 'exactly one generation call')
    assert.ok(calls[0].body.prompt.includes('Alternance'))
  })

  it("reads the 'en' copy and builds the English prompt when language is 'en'", async () => {
    const calls = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) }).calls

    const { sources } = await getAnswer(
      'apprenticeship?',
      [{ name: 'Alternance', type: 'md', score: 0.95 }],
      'en'
    )

    assert.ok(sources[0].path.endsWith('/BaseDocumentaire/En/Notion/Alternance.md'))
    assert.match(calls[0].body.prompt, /Always answer in English/)
  })

  it('drops an unresolvable row instead of throwing', async () => {
    stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) })

    const { sources } = await getAnswer('q', [
      { name: 'Alternance', type: 'md', score: 0.95 },
      { name: 'No Such Document', type: 'md', score: 0.94 },
      { name: 'no-such-subject', type: 'pdf', score: 0.93 }
    ], 'fr')

    assert.deepStrictEqual(sources.map((doc) => doc.name), ['Alternance'])
  })

  it('returns the frozen fallback with NO Ollama call when nothing carries text', async () => {
    const calls = stubOllama({
      '/api/generate': () => assert.fail('generation must not run on an empty document set')
    }).calls

    const { answer, sources } = await getAnswer('q', [], 'fr')

    assert.deepStrictEqual(sources, [])
    assert.match(answer, /aucune information à ce sujet dans mes datas/)
    assert.strictEqual(calls.length, 0)
  })

  it('returns the English fallback for language en', async () => {
    stubOllama({ '/api/generate': () => assert.fail('no generation expected') })
    const { answer } = await getAnswer('q', [], 'en')
    assert.match(answer, /don't have any information about this in my data/)
  })

  it('retrieves for itself when `documents` is absent (the one-call fallback)', async () => {
    const calls = stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: embeddingFor('notion', 'Alternance.md') }),
      '/api/generate': () => jsonResponse({ response: 'answer' })
    }).calls

    const { sources } = await getAnswer('alternance ?', undefined, 'fr')

    assert.ok(sources.some((doc) => doc.name === 'Alternance'))
    assert.ok(calls.some((call) => call.url.endsWith('/api/embeddings')), 'it embedded the question itself')
  })

  it('falls back with no generation when its own retrieval matches nothing', async () => {
    stubOllama({
      '/api/embeddings': () => jsonResponse({ embedding: embeddingMatchingNothing() }),
      '/api/generate': () => assert.fail('no generation expected')
    })
    const { sources } = await getAnswer('zzz', null, 'fr')
    assert.deepStrictEqual(sources, [])
  })

  it('streams every fragment through onToken and still returns the assembled answer', async () => {
    stubOllama({ '/api/generate': () => ndjsonResponse(['Bon', 'jour', ' 42']) })

    const seen = []
    const { answer } = await getAnswer(
      'q',
      [{ name: 'Alternance', type: 'md', score: 0.95 }],
      'fr',
      { onToken: (value) => seen.push(value) }
    )

    assert.deepStrictEqual(seen, ['Bon', 'jour', ' 42'])
    assert.strictEqual(answer, 'Bonjour 42')
  })

  it('feeds a subject PDF real extracted text into the prompt', async () => {
    const calls = stubOllama({ '/api/generate': () => jsonResponse({ response: 'ok' }) }).calls

    const { sources } = await getAnswer(
      "c'est quoi libft ?",
      [{ name: 'Libft.en.subject', type: 'pdf', score: 0.99 }],
      'fr'
    )

    assert.strictEqual(sources[0].type, 'pdf')
    assert.ok(sources[0].path.endsWith('/SubjectsPdf/Old_Common_Core/Libft.en.subject.pdf'))
    // Before L4 this block was empty under a "documents were found" sentence and
    // the model invented document names.
    assert.match(calls[0].body.prompt, /--- Document : Libft\.en\.subject ---\n.{200,}/s)
  })
})

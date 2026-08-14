'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const DOCUMENTS_ROOT = path.join(__dirname, '../data/documents')
const BASE_DOCUMENTAIRE_ROOT = path.join(__dirname, '../data/BaseDocumentaire')

// Maps the lowercase language code used in the API (front-end, URLs) to the
// actual on-disk folder name under data/BaseDocumentaire/.
const LANGUAGE_FOLDERS = { fr: 'Fr', en: 'En' }

/**
 * Resolves the Notion folder to read from for a given language code.
 * 'origin' is the language-agnostic source used for RAG retrieval
 * (data/documents/Notion/), fr/en are the translated copies under
 * data/BaseDocumentaire/<Fr|En>/Notion/.
 *
 * @param {string} language - 'fr' | 'en' | 'origin'
 * @returns {string | null}
 */
function resolveNotionDir(language) {
  if (language === 'origin') {
    return path.join(DOCUMENTS_ROOT, 'Notion')
  }

  const folder = LANGUAGE_FOLDERS[language]
  return folder ? path.join(BASE_DOCUMENTAIRE_ROOT, folder, 'Notion') : null
}

/**
 * Lists the names of all documents available on disk (data/documents/Notion/,
 * one flat .md file per document). Used as a whitelist to validate document
 * names coming from request params. Delegates to listBaseDocumentaireNames
 * with the 'origin' language, stripping the .md extension to match this
 * legacy route's name-without-extension contract.
 *
 * @returns {Promise<string[]>}
 */
async function listDocumentNames() {
  const names = await listBaseDocumentaireNames('origin')
  return names.map((name) => name.replace(/\.md$/, ''))
}

/**
 * Reads a document's raw markdown content by name (no .md extension).
 *
 * @param {string} name
 * @returns {Promise<{name: string, content: string} | null>} null if name isn't a known document
 */
async function readDocumentByName(name) {
  return readBaseDocumentaireDocument('origin', `${name}.md`)
}

/**
 * Lists the .md filenames available for a language under its Notion folder
 * (BaseDocumentaire/<Lang>/Notion/ for fr/en, documents/Notion/ for origin).
 * Used as a whitelist to validate document names coming from request params.
 *
 * @param {string} language - 'fr' | 'en' | 'origin'
 * @returns {Promise<string[]>}
 */
async function listBaseDocumentaireNames(language) {
  const notionDir = resolveNotionDir(language)
  if (!notionDir) {
    return []
  }

  const entries = await fs.readdir(notionDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name)
}

/**
 * Reads a document's raw markdown content by language + filename.
 *
 * @param {string} language - 'fr' | 'en' | 'origin'
 * @param {string} name - filename including the .md extension
 * @returns {Promise<{name: string, content: string} | null>} null if language/name isn't known
 */
async function readBaseDocumentaireDocument(language, name) {
  const notionDir = resolveNotionDir(language)
  if (!notionDir) {
    return null
  }

  const knownNames = await listBaseDocumentaireNames(language)
  if (!knownNames.includes(name)) {
    return null
  }

  const filePath = path.join(notionDir, name)
  const content = await fs.readFile(filePath, 'utf-8')
  return { name: name.replace(/\.md$/, ''), content }
}

module.exports = {
  listDocumentNames,
  readDocumentByName,
  listBaseDocumentaireNames,
  readBaseDocumentaireDocument
}

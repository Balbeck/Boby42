'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const DOCUMENTS_ROOT = path.join(__dirname, '../data/documents')
const BASE_DOCUMENTAIRE_ROOT = path.join(__dirname, '../data/BaseDocumentaire')

// Maps the lowercase language code used in the API (front-end, URLs) to the
// actual on-disk folder name under data/BaseDocumentaire/.
const LANGUAGE_FOLDERS = { fr: 'Fr', en: 'En' }

/**
 * Lists the names of all documents available on disk (one folder per document).
 * Used as a whitelist to validate document names coming from request params.
 *
 * @returns {Promise<string[]>}
 */
async function listDocumentNames() {
  const entries = await fs.readdir(DOCUMENTS_ROOT, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/**
 * Reads a document's raw markdown content by name.
 *
 * @param {string} name
 * @returns {Promise<{name: string, content: string} | null>} null if name isn't a known document
 */
async function readDocumentByName(name) {
  const knownNames = await listDocumentNames()
  if (!knownNames.includes(name)) {
    return null
  }

  const filePath = path.join(DOCUMENTS_ROOT, name, `${name}.md`)
  const content = await fs.readFile(filePath, 'utf-8')
  return { name, content }
}

/**
 * Lists the .md filenames available for a language under BaseDocumentaire/<Lang>/Notion/.
 * Used as a whitelist to validate document names coming from request params.
 *
 * @param {string} language - 'fr' | 'en'
 * @returns {Promise<string[]>}
 */
async function listBaseDocumentaireNames(language) {
  const folder = LANGUAGE_FOLDERS[language]
  if (!folder) {
    return []
  }

  const notionDir = path.join(BASE_DOCUMENTAIRE_ROOT, folder, 'Notion')
  const entries = await fs.readdir(notionDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name)
}

/**
 * Reads a document's raw markdown content by language + filename.
 *
 * @param {string} language - 'fr' | 'en'
 * @param {string} name - filename including the .md extension
 * @returns {Promise<{name: string, content: string} | null>} null if language/name isn't known
 */
async function readBaseDocumentaireDocument(language, name) {
  const folder = LANGUAGE_FOLDERS[language]
  if (!folder) {
    return null
  }

  const knownNames = await listBaseDocumentaireNames(language)
  if (!knownNames.includes(name)) {
    return null
  }

  const filePath = path.join(BASE_DOCUMENTAIRE_ROOT, folder, 'Notion', name)
  const content = await fs.readFile(filePath, 'utf-8')
  return { name: name.replace(/\.md$/, ''), content }
}

module.exports = {
  listDocumentNames,
  readDocumentByName,
  listBaseDocumentaireNames,
  readBaseDocumentaireDocument
}

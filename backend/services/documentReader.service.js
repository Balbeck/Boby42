'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const DOCUMENTS_ROOT = path.join(__dirname, '../data/documents')

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

module.exports = { listDocumentNames, readDocumentByName }

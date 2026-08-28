'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

// Artisanal on purpose: every project subject PDF currently lives in this one
// hard-coded category folder. NOT recursive. Basename-based resolution, exactly
// like retriever.service.js's resolveDocumentPath() for the Notion base. See
// root CLAUDE.md ("Subject project PDFs") for what a future multi-category
// reorganisation has to change.
const SUBJECTS_PDF_DIR = path.join(__dirname, '../data/SubjectsPdf/Machine_Learning')

/**
 * Lists the .pdf filenames in the subject PDF folder — used as a whitelist to
 * validate names coming from request params. Missing folder -> empty list +
 * warning, so the app still boots.
 *
 * @returns {Promise<string[]>}
 */
async function listSubjectsPdfFiles () {
  try {
    const entries = await fs.readdir(SUBJECTS_PDF_DIR, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[subjectsPdfLibrary] folder not found: ${SUBJECTS_PDF_DIR}`)
      return []
    }
    throw err
  }
}

/**
 * Resolves a requested PDF name to an absolute path, only if it is whitelisted.
 * Never builds a path straight from request input.
 *
 * @param {string} name - filename including the .pdf extension
 * @returns {Promise<string | null>} absolute path, or null if unknown
 */
async function resolveSubjectsPdfFile (name) {
  const knownNames = await listSubjectsPdfFiles()
  if (!knownNames.includes(name)) {
    return null
  }
  return path.join(SUBJECTS_PDF_DIR, name)
}

module.exports = { listSubjectsPdfFiles, resolveSubjectsPdfFile }

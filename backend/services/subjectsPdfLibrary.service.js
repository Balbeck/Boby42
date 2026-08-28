'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

// Subject PDFs live under data/SubjectsPdf/<Category>/<Name>.pdf. There are now
// two category folders (Machine_Learning, Old_Common_Core), so this walks the
// whole SubjectsPdf tree recursively instead of one hard-coded folder. Resolution
// stays basename-based, exactly like retriever.service.js's resolveDocumentPath()
// for the Notion base: the store's `filename` keeps its full path, only the
// basename is matched. This works only while basenames stay unique across
// categories — if a future category reuses a basename, the serving route needs a
// :category segment (see root CLAUDE.md, "Subject project PDFs").
const SUBJECTS_PDF_ROOT = path.join(__dirname, '../data/SubjectsPdf')

/**
 * Recursively collects the absolute paths of every .pdf under `dir`.
 * A missing directory yields an empty list (so the app still boots).
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walkPdfFiles (dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[subjectsPdfLibrary] folder not found: ${dir}`)
      return []
    }
    throw err
  }

  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkPdfFiles(full))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(full)
    }
  }
  return files
}

/**
 * Builds a { basename -> absolute path } index of every subject PDF, used as the
 * whitelist for request params. On a basename collision the first match wins and
 * a warning is logged (the URL scheme can't disambiguate two same-named files).
 *
 * @returns {Promise<Map<string, string>>}
 */
async function buildSubjectsPdfIndex () {
  const index = new Map()
  for (const full of await walkPdfFiles(SUBJECTS_PDF_ROOT)) {
    const name = path.basename(full)
    if (index.has(name)) {
      console.warn(`[subjectsPdfLibrary] duplicate basename ignored: ${full} (kept ${index.get(name)})`)
      continue
    }
    index.set(name, full)
  }
  return index
}

/**
 * Lists the .pdf filenames (basenames) across every subject PDF category folder.
 *
 * @returns {Promise<string[]>}
 */
async function listSubjectsPdfFiles () {
  return [...(await buildSubjectsPdfIndex()).keys()]
}

/**
 * Resolves a requested PDF name to an absolute path, only if it is whitelisted.
 * Never builds a path straight from request input.
 *
 * @param {string} name - filename including the .pdf extension
 * @returns {Promise<string | null>} absolute path, or null if unknown
 */
async function resolveSubjectsPdfFile (name) {
  const index = await buildSubjectsPdfIndex()
  return index.get(name) || null
}

module.exports = { listSubjectsPdfFiles, resolveSubjectsPdfFile }

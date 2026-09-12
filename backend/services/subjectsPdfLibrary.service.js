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

// Hector adds subject PDFs by hand while the stack is running, so the index
// built below is cached in-process and invalidated by directory mtime rather
// than rebuilt on every call: a stat on the root AND every category folder
// visited by the last walk (adding a file inside a category changes that
// category's mtime, not the root's — a root-only check would miss it). This is
// what makes a hand-dropped PDF show up without a container restart.
/** @type {{ dirs: Map<string, number> | null, promise: Promise<Map<string, string>> } | null} */
let cache = null

/**
 * Recursively collects the absolute paths of every .pdf under `dir`, and
 * records every directory successfully read into `visitedDirs` (used to build
 * the mtime-based invalidation cache). A missing directory yields an empty
 * list (so the app still boots).
 *
 * @param {string} dir
 * @param {string[]} visitedDirs
 * @returns {Promise<string[]>}
 */
async function walkPdfFiles (dir, visitedDirs) {
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

  visitedDirs.push(dir)

  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkPdfFiles(full, visitedDirs))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(full)
    }
  }
  return files
}

/**
 * True when the cached index must be rebuilt: a recorded directory's mtime
 * changed, or a recorded directory no longer exists (stat throws). Only
 * called by `buildSubjectsPdfIndex` once a completed build's directories are
 * on hand — "nothing cached yet" and "a build is still in flight" are handled
 * there instead, synchronously and without an intervening `await`, so two
 * concurrent first calls can't both decide to start walking.
 *
 * @param {Map<string, number>} dirs
 * @returns {Promise<boolean>}
 */
async function indexIsStale (dirs) {
  if (dirs.size === 0) {
    return true
  }
  for (const [dir, mtimeMs] of dirs) {
    try {
      const st = await fs.stat(dir)
      if (st.mtimeMs !== mtimeMs) {
        return true
      }
    } catch {
      return true
    }
  }
  return false
}

/**
 * Starts a rebuild, publishing the in-flight promise to the module cache
 * BEFORE any `await` runs — so a concurrent caller that checks `cache` right
 * after sees the placeholder and reuses this same promise instead of starting
 * its own walk.
 *
 * @returns {Promise<Map<string, string>>}
 */
function rebuildIndex () {
  const current = { dirs: /** @type {Map<string, number> | null} */ (null), promise: /** @type {any} */ (null) }
  cache = current

  current.promise = (async () => {
    const visitedDirs = []
    const files = await walkPdfFiles(SUBJECTS_PDF_ROOT, visitedDirs)

    const index = new Map()
    for (const full of files) {
      const name = path.basename(full)
      if (index.has(name)) {
        console.warn(`[subjectsPdfLibrary] duplicate basename ignored: ${full} (kept ${index.get(name)})`)
        continue
      }
      index.set(name, full)
    }

    const dirs = new Map()
    for (const dir of visitedDirs) {
      try {
        const st = await fs.stat(dir)
        dirs.set(dir, st.mtimeMs)
      } catch {
        // Can't record this directory's mtime (e.g. it vanished mid-walk) —
        // leave it out so the next call sees an incomplete cache and rebuilds.
      }
    }
    current.dirs = dirs

    return index
  })()

  return current.promise.catch((err) => {
    if (cache === current) {
      cache = null
    }
    throw err
  })
}

/**
 * Builds a { basename -> absolute path } index of every subject PDF, used as the
 * whitelist for request params. On a basename collision the first match wins and
 * a warning is logged (the URL scheme can't disambiguate two same-named files).
 * The result is cached and only rebuilt when a covered directory's mtime changed.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function buildSubjectsPdfIndex () {
  if (!cache) {
    return rebuildIndex()
  }
  if (cache.dirs === null) {
    return cache.promise
  }
  if (!(await indexIsStale(cache.dirs))) {
    return cache.promise
  }
  return rebuildIndex()
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

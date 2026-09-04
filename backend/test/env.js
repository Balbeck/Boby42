'use strict'

// Test environment — loaded with `node --test --require ./test/env.js`.
//
// It HAS to run through --require rather than from inside a test file: the flag
// propagates to every test child process, and `db/config.js` reads process.env
// at REQUIRE time to build the Sequelize singleton in `models/index.js`. A
// variable set in a test file body would already be too late for any module
// that pulled in ../models first.
//
// Two rules here:
//   1. POSTGRES_DB is forced to a *_test database — test/db.js TRUNCATEs, so it
//      must never be able to point at the dev database.
//   2. Everything /lab-related is forced to fixed test values, so assertions
//      never depend on what a given host happens to have in .env.lab.

const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.join(__dirname, '..', '..')

/**
 * Loads `KEY=value` lines without overwriting anything already in the
 * environment (so `POSTGRES_HOST=… npm test` still wins).
 *
 * @param {string} file
 */
function loadEnvFile (file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || line.trim().startsWith('#')) continue
    if (!(match[1] in process.env)) process.env[match[1]] = match[2]
  }
}

// The only secret with no default anywhere is POSTGRES_PASSWORD, and it lives in
// the git-ignored root .env.lab. Absent (a fresh clone, CI) → the connection
// fails, test/db.js reports it, and the DB suites skip instead of failing.
loadEnvFile(path.join(REPO_ROOT, '.env.lab'))

// Postgres — the container publishes 5432 on the host as POSTGRES_HOST_PORT
// (loopback only, default 5442). Tests run on the HOST, so they use that
// published port, not the in-container 5432 the backend service uses.
process.env.POSTGRES_HOST = process.env.TEST_POSTGRES_HOST || '127.0.0.1'
process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT || process.env.POSTGRES_HOST_PORT || '5442'
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'boby42'
process.env.POSTGRES_DB = 'boby42_test'

process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8421'

// Ollama is stubbed in every suite (test/ollamaStub.js swaps global fetch), so
// this host must not resolve: a forgotten stub then fails loudly instead of
// quietly hitting a real Ollama and taking ~100 s.
process.env.OLLAMA_BASE_URL = 'http://ollama.invalid:11434'
process.env.OLLAMA_GENERATION_MODEL = 'test-generation-model'
process.env.OLLAMA_EMBEDDING_MODEL = 'test-embedding-model'

// /lab — forced, never read from .env.lab (see rule 2 above).
process.env.LAB_JWT_SECRET = 'test-lab-jwt-secret'
process.env.LAB_LOGIN = 'test-lab-login'
process.env.LAB_PASSWORD = 'test-lab-password'

// The /ollama proxy's shared key. A suite that needs the "unset" branch deletes
// it in its own file — each test file is its own process, so that is isolated.
process.env.OLLAMA_PROXY_KEY = 'test-ollama-proxy-key'

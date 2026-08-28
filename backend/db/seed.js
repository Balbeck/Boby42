'use strict'

// Seeds the single /lab user from LAB_LOGIN / LAB_PASSWORD.
//
// Runs two ways, same logic:
//   - automatically at boot (plugins/sequelize.js, right after migrations)
//   - on demand via `make db-seed` (this file run directly)
//
// Idempotent: keyed on the unique `login`, only `password_hash` is written, and
// nothing is written at all when the stored hash already matches — so a normal
// restart is a no-op and `session_token` is never touched.

const bcrypt = require('bcryptjs')
const { sequelize, User } = require('../models')

/**
 * @param {{ log?: (msg: string) => void, warn?: (msg: string) => void }} [io]
 * @returns {Promise<'seeded' | 'unchanged' | 'skipped'>}
 */
async function seedLabUser({ log = () => {}, warn = () => {} } = {}) {
  const login = process.env.LAB_LOGIN
  const password = process.env.LAB_PASSWORD

  if (!login || !password) {
    warn('[seed] LAB_LOGIN / LAB_PASSWORD unset — no /lab user seeded, the gate stays disabled (/auth/lab/* → 404).')
    return 'skipped'
  }

  const existing = await User.findOne({ where: { login } })
  if (existing && bcrypt.compareSync(password, existing.password_hash)) {
    log(`[seed] /lab user "${login}" already up to date.`)
    return 'unchanged'
  }

  await User.upsert({ login, password_hash: bcrypt.hashSync(password, 10) })
  log(`[seed] /lab user "${login}" ${existing ? 'password updated' : 'created'}.`)
  return 'seeded'
}

module.exports = { seedLabUser }

// `node db/seed.js` (make db-seed)
if (require.main === module) {
  seedLabUser({ log: console.log, warn: console.warn })
    .then(() => sequelize.close())
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

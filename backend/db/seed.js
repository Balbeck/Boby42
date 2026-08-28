'use strict'

// Upserts the single /lab user from LAB_LOGIN / LAB_PASSWORD. Run via
// `make db-seed` (backend container). If either var is unset, nothing is
// written and the /lab feature stays disabled (routes 404).

const bcrypt = require('bcryptjs')
const { sequelize, User } = require('../models')

async function main() {
  const login = process.env.LAB_LOGIN
  const password = process.env.LAB_PASSWORD

  if (!login || !password) {
    console.warn('[seed] LAB_LOGIN / LAB_PASSWORD not set — no user seeded (the /lab page stays disabled).')
    await sequelize.close()
    return
  }

  // Keyed on the unique `login`: only login + password_hash are written, so a
  // re-seed never clobbers an active session_token.
  await User.upsert({ login, password_hash: bcrypt.hashSync(password, 10) })
  console.log(`[seed] lab user "${login}" is set.`)

  await sequelize.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

'use strict'

// Standalone migration runner for `make db-migrate`. Applies the same pending
// migrations that plugins/sequelize.js applies at boot — safe to run either way
// (umzug tracks applied migrations in the SequelizeMeta table).

const { sequelize } = require('../models')
const { createUmzug } = require('./umzug')

async function main() {
  const applied = await createUmzug().up()
  console.log(
    applied.length
      ? `Applied: ${applied.map((m) => m.name).join(', ')}`
      : 'No pending migrations.'
  )
  await sequelize.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

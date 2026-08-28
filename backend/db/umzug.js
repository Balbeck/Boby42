'use strict'

const path = require('node:path')
const { Umzug, SequelizeStorage } = require('umzug')
const { sequelize, Sequelize } = require('../models')

// Shared umzug instance — applied at boot by plugins/sequelize.js and on demand
// by db/migrate.js (`make db-migrate`). Migration files use the sequelize-cli
// shape (`up(queryInterface, Sequelize)` / `down(queryInterface)`), so the
// resolver bridges umzug's context to that signature.
function createUmzug() {
  return new Umzug({
    migrations: {
      glob: path.join(__dirname, 'migrations', '*.js'),
      resolve: ({ name, path: migrationPath, context }) => {
        const migration = require(migrationPath)
        return {
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize)
        }
      }
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console
  })
}

module.exports = { createUmzug }

'use strict'

const fp = require('fastify-plugin')
const { sequelize, User } = require('../models')
const { createUmzug } = require('../db/umzug')

/**
 * Brings up the database for the whole backend: verifies the connection,
 * applies pending migrations (umzug, SequelizeMeta storage), then decorates
 * `fastify.sequelize` and `fastify.models`. Closes the pool on shutdown.
 *
 * This is the project's migration mechanism — it replaces the earlier
 * raw-SQL-runner idea. Later tasks add models + migrations; nothing here
 * changes.
 */
module.exports = fp(async function (fastify) {
  await sequelize.authenticate()

  const applied = await createUmzug().up()
  if (applied.length) {
    fastify.log.info(`DB migrations applied: ${applied.map((m) => m.name).join(', ')}`)
  }

  fastify.decorate('sequelize', sequelize)
  fastify.decorate('models', { User })

  fastify.addHook('onClose', async () => {
    await sequelize.close()
  })
})

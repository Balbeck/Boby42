'use strict'

const fp = require('fastify-plugin')
const {
  sequelize, User, Visitor, Conversation, Message, MessageDocument, Event, MessageFeedback
} = require('../models')
const { createUmzug } = require('../db/umzug')
const { seedLabUser } = require('../db/seed')

/**
 * Brings up the database for the whole backend: waits for the connection,
 * applies pending migrations (umzug, SequelizeMeta storage), seeds the /lab
 * user, then decorates `fastify.sequelize` and `fastify.models`. Closes the
 * pool on shutdown.
 *
 * This is the project's migration mechanism — it replaces the earlier
 * raw-SQL-runner idea. Later tasks add models + migrations; nothing here
 * changes.
 */
module.exports = fp(async function (fastify) {
  await authenticateWithRetry(fastify)

  const applied = await createUmzug().up()
  if (applied.length) {
    fastify.log.info(`DB migrations applied: ${applied.map((m) => m.name).join(', ')}`)
  }

  // Seed at boot so a fresh host never needs a separate `make db-seed`.
  // Idempotent — a no-op once the user matches .env.lab.
  await seedLabUser({
    log: (msg) => fastify.log.info(msg),
    warn: (msg) => fastify.log.warn(msg)
  })

  fastify.decorate('sequelize', sequelize)
  fastify.decorate('models', {
    User, Visitor, Conversation, Message, MessageDocument, Event, MessageFeedback
  })

  fastify.addHook('onClose', async () => {
    await sequelize.close()
  })
})

/**
 * `depends_on: service_healthy` already gates start order, but a retry keeps a
 * momentarily-unready Postgres from taking the whole backend down — and the
 * per-attempt log line is the first thing to check when prod login breaks.
 */
async function authenticateWithRetry(fastify, tries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await sequelize.authenticate()
      fastify.log.info(`[db] connected (${sequelize.config.host}:${sequelize.config.port}/${sequelize.config.database})`)
      return
    } catch (err) {
      if (attempt === tries) throw err
      fastify.log.warn(
        `[db] not reachable (attempt ${attempt}/${tries}): ${err.message} — retrying in ${delayMs}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

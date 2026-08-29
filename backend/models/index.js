'use strict'

const { Sequelize } = require('sequelize')
const config = require('../db/config')

// One shared Sequelize instance for the whole backend — required as a module
// singleton by plugins/sequelize.js, db/umzug.js, db/migrate.js, db/seed.js and
// the services.
const sequelize = new Sequelize(config.database, config.username, config.password, config)

const User = require('./user')(sequelize)

// Interaction logging (T4) — anonymous student traffic on /chat + /archiviste.
const Visitor = require('./visitor')(sequelize)
const Conversation = require('./conversation')(sequelize)
const Message = require('./message')(sequelize)
const MessageDocument = require('./messageDocument')(sequelize)
const Event = require('./event')(sequelize)

// Answer feedback — one 👍 / 👎 per assistant message, the project's only
// answer-quality signal. Built on T4's UUID `messages.id`.
const MessageFeedback = require('./messageFeedback')(sequelize)

// Associations — declared here, after every model is required. FK columns are
// snake_case because the models are `underscored` (`visitor_id`,
// `conversation_id`, `message_id`). ON DELETE is enforced by the migration (the
// schema is never built from `sync()`); mirrored here for documentation.
Visitor.hasMany(Conversation, { foreignKey: 'visitor_id', onDelete: 'CASCADE' })
Conversation.belongsTo(Visitor, { foreignKey: 'visitor_id' })

Conversation.hasMany(Message, { foreignKey: 'conversation_id', onDelete: 'CASCADE' })
Message.belongsTo(Conversation, { foreignKey: 'conversation_id' })

Message.hasMany(MessageDocument, { foreignKey: 'message_id', onDelete: 'CASCADE' })
MessageDocument.belongsTo(Message, { foreignKey: 'message_id' })

Message.hasOne(MessageFeedback, { foreignKey: 'message_id', onDelete: 'CASCADE' })
MessageFeedback.belongsTo(Message, { foreignKey: 'message_id' })

Visitor.hasMany(Event, { foreignKey: 'visitor_id', onDelete: 'SET NULL' })
Event.belongsTo(Visitor, { foreignKey: 'visitor_id' })

Conversation.hasMany(Event, { foreignKey: 'conversation_id', onDelete: 'SET NULL' })
Event.belongsTo(Conversation, { foreignKey: 'conversation_id' })

module.exports = {
  sequelize,
  Sequelize,
  User,
  Visitor,
  Conversation,
  Message,
  MessageDocument,
  Event,
  MessageFeedback
}

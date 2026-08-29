'use strict'

// Interaction logging (T4) — one migration, five tables:
//   visitors           anonymous student browsers (anon_id = the localStorage UUID)
//   conversations      a thread on one page (UUID pk)
//   messages           user + assistant rows, two per exchange (UUID pk)
//   message_documents  RAG sources / matched docs, by reference only
//   events             generic append-only bus (first use: 'no_match')
//
// Same shape as 20260828235529-create-users.js: created_at / updated_at are
// declared explicitly where the model keeps them. UUID pks carry no DB-level
// default — every insert goes through Sequelize, whose model `defaultValue:
// UUIDV4` generates the value client-side.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('visitors', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      anon_id: { type: Sequelize.STRING, allowNull: false, unique: true },
      intra_login: { type: Sequelize.STRING, allowNull: true, unique: true },
      first_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    })

    await queryInterface.createTable('conversations', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      visitor_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'visitors', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      page: { type: Sequelize.ENUM('chat', 'archiviste'), allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    })

    await queryInterface.createTable('messages', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      conversation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'conversations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      role: { type: Sequelize.ENUM('user', 'assistant'), allowNull: false },
      content: { type: Sequelize.TEXT, allowNull: false },
      language: { type: Sequelize.STRING, allowNull: true },
      latency_ms: { type: Sequelize.INTEGER, allowNull: true },
      error_code: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false }
    })

    await queryInterface.createTable('message_documents', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      message_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'messages', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      name: { type: Sequelize.STRING, allowNull: false },
      url: { type: Sequelize.STRING, allowNull: true },
      path: { type: Sequelize.STRING, allowNull: true },
      score: { type: Sequelize.FLOAT, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false }
    })

    await queryInterface.createTable('events', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      visitor_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'visitors', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      conversation_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'conversations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      type: { type: Sequelize.STRING, allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false }
    })

    await queryInterface.addIndex('conversations', ['visitor_id', { name: 'updated_at', order: 'DESC' }], {
      name: 'conversations_visitor_id_updated_at'
    })
    await queryInterface.addIndex('messages', ['conversation_id', 'created_at'], {
      name: 'messages_conversation_id_created_at'
    })
    await queryInterface.addIndex('message_documents', ['message_id'], {
      name: 'message_documents_message_id'
    })
    await queryInterface.addIndex('events', ['type', { name: 'created_at', order: 'DESC' }], {
      name: 'events_type_created_at'
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('events')
    await queryInterface.dropTable('message_documents')
    await queryInterface.dropTable('messages')
    await queryInterface.dropTable('conversations')
    await queryInterface.dropTable('visitors')
    // Postgres keeps ENUM types after their table is dropped.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_conversations_page";')
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_messages_role";')
  }
}

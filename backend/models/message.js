'use strict'

const { DataTypes } = require('sequelize')

/**
 * One message in a conversation. Two per exchange: the student question
 * (`role: 'user'`) then the answer (`role: 'assistant'`). On the error path, or
 * on /archiviste where there is no LLM answer, the assistant row still exists
 * with an empty `content` and — for errors — an `error_code`
 * ('ollama_error' | 'retrieval_error').
 *
 * UUID pk for the same reason as `Conversation`: it becomes the `messageId` in
 * the future /feedback contract. `latency_ms` is measured around the service
 * call in the route.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'Message',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      conversation_id: { type: DataTypes.UUID, allowNull: false },
      role: { type: DataTypes.ENUM('user', 'assistant'), allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      language: { type: DataTypes.STRING, allowNull: true },
      latency_ms: { type: DataTypes.INTEGER, allowNull: true },
      error_code: { type: DataTypes.STRING, allowNull: true }
    },
    {
      tableName: 'messages',
      underscored: true,
      updatedAt: false // created_at only — messages are never edited
    }
  )

'use strict'

const { DataTypes } = require('sequelize')

/**
 * One conversation — a series of exchanges on a single page. `id` is a UUID
 * (client-side UUIDV4, no DB extension needed) because it surfaces in URLs
 * later (`GET /conversations/:id`) and is the handle the frontend carries
 * between questions; a sequential integer would leak volume and invite
 * enumeration.
 *
 * `page` pins the conversation to one surface — /chat and /archiviste produce
 * different result shapes and are never mixed in the same thread. `title` is
 * the first question, truncated, set once at creation.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'Conversation',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      visitor_id: { type: DataTypes.INTEGER, allowNull: false },
      page: { type: DataTypes.ENUM('chat', 'archiviste'), allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false }
    },
    {
      tableName: 'conversations',
      underscored: true // created_at / updated_at
    }
  )

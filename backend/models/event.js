'use strict'

const { DataTypes } = require('sequelize')

/**
 * Generic append-only event bus for later analytics. First use (T4): a
 * `no_match` row every time /archiviste returns nothing — the running list of
 * what the document base is missing, carried in `payload` (JSONB).
 *
 * `Event` shadows a browser global, but there is no DOM in the backend, so the
 * name is safe. Both FKs are nullable / ON DELETE SET NULL — an event outlives
 * the visitor or conversation it happened in.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'Event',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      visitor_id: { type: DataTypes.INTEGER, allowNull: true },
      conversation_id: { type: DataTypes.UUID, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true }
    },
    {
      tableName: 'events',
      underscored: true,
      updatedAt: false // created_at only
    }
  )

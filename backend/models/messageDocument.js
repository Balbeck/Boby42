'use strict'

const { DataTypes } = require('sequelize')

/**
 * A document referenced by an assistant message — a RAG source (/chat) or a
 * matched document (/archiviste). Stored **by reference only, never the
 * content** (cross-cutting decision 7): `name`, `type` (`md` | `pdf`), `url`,
 * `path`, `score`, and `position` — the 0-based order in the array the route
 * returned.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'MessageDocument',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      message_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      // 'md' (Notion doc) | 'pdf' (subject PDF). Null on rows written before
      // this column existed.
      type: { type: DataTypes.ENUM('md', 'pdf'), allowNull: true },
      url: { type: DataTypes.STRING, allowNull: true },
      path: { type: DataTypes.STRING, allowNull: true },
      score: { type: DataTypes.FLOAT, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false }
    },
    {
      tableName: 'message_documents',
      underscored: true,
      timestamps: false
    }
  )

'use strict'

const { DataTypes } = require('sequelize')

/**
 * A 👍 / 👎 rating on one assistant message — the only quality signal the
 * project collects. A separate table, not a column on `messages`: feedback is a
 * distinct event with its own timestamps and an optional comment, and it can be
 * changed or withdrawn. The `message_id` UNIQUE keeps it to one current rating
 * per answer (the service upserts on it).
 *
 * `rating` is an integer (`1` / `-1`) so the analytics queries can average it
 * directly; `0` is never stored — it means "withdraw" and the service deletes
 * the row. `comment` is only kept for a `-1` (no free-text on positive ratings).
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'MessageFeedback',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      message_id: { type: DataTypes.UUID, allowNull: false, unique: true },
      rating: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        validate: { isIn: [[-1, 1]] }
      },
      comment: { type: DataTypes.TEXT, allowNull: true }
    },
    {
      tableName: 'message_feedback',
      underscored: true
    }
  )

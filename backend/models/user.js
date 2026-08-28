'use strict'

const { DataTypes } = require('sequelize')

/**
 * The single /lab login account. Seeded once by db/seed.js from LAB_LOGIN /
 * LAB_PASSWORD; auth compares the submitted password against `password_hash`
 * (bcryptjs). `session_token` holds the currently valid JWT — a protected
 * request must present a cookie whose value equals this column, so logout
 * (nulls it) and a second login (overwrites it) both invalidate older tokens.
 *
 * Distinct from the future `visitors` table (anonymous students) — do not merge.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'User',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      login: { type: DataTypes.STRING, allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      session_token: { type: DataTypes.TEXT, allowNull: true }
    },
    {
      tableName: 'users',
      underscored: true // created_at / updated_at
    }
  )

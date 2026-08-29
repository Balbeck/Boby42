'use strict'

const { DataTypes } = require('sequelize')

/**
 * One row per anonymous browser hitting /chat or /archiviste. `anon_id` is the
 * real external key — the UUID the frontend generates once and keeps in
 * localStorage (`boby42.visitorId`), sent on every request as `visitorId`. It
 * is a STRING (not UUID) so a malformed value can't crash a query the way a bad
 * UUID cast would; callers trim/guard it, no format validation is required.
 *
 * Distinct from `models/user.js` (the authenticated /lab principal) on purpose:
 * anonymous student traffic is a different concept and must not be squeezed
 * into `users`. `intra_login` is a reserved slot for a future student login.
 *
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) =>
  sequelize.define(
    'Visitor',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      anon_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      intra_login: { type: DataTypes.STRING, allowNull: true, unique: true },
      first_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'visitors',
      timestamps: false // first_seen_at / last_seen_at are managed by the service
    }
  )

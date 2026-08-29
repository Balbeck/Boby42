'use strict'

// Answer feedback — one 👍 / 👎 per assistant message, with an optional comment
// on a 👎. A separate table (not a column on `messages`) because feedback is its
// own event: own timestamps, changeable, withdrawable. `message_id` is UNIQUE so
// there is one current rating per answer; the service upserts on it and deletes
// the row on withdraw (`rating: 0`). `rating` is a checked SMALLINT (-1 | 1).
//
// Same shape as the earlier migrations: created_at / updated_at declared
// explicitly, no DB-level default on ids that Sequelize fills client-side (here
// `id` is a plain autoincrement BIGINT, so it does have one).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('message_feedback', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      message_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'messages', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      rating: { type: Sequelize.SMALLINT, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    })

    await queryInterface.addConstraint('message_feedback', {
      fields: ['rating'],
      type: 'check',
      name: 'message_feedback_rating_check',
      where: { rating: [-1, 1] }
    })

    await queryInterface.addIndex('message_feedback', ['rating', { name: 'created_at', order: 'DESC' }], {
      name: 'message_feedback_rating_created_at'
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('message_feedback')
  }
}

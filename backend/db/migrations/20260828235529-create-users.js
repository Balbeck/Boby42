'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      login: { type: Sequelize.STRING, allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING, allowNull: false },
      session_token: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users')
  }
}

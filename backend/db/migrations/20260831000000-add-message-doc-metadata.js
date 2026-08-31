'use strict'

// Adds two columns, both additive and nullable (no backfill of existing rows):
//   messages.document_count   how many documents the exchange returned to the
//                             front — 0 is the queryable form of "nothing
//                             matched" (paired with an events row, type
//                             'no_match', now logged on /chat too, not just
//                             /archiviste).
//   message_documents.type    'md' (Notion) | 'pdf' (subject PDF) — was only
//                             inferable from the url prefix before.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('messages', 'document_count', {
      type: Sequelize.INTEGER,
      allowNull: true
    })
    await queryInterface.addColumn('message_documents', 'type', {
      type: Sequelize.ENUM('md', 'pdf'),
      allowNull: true
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('message_documents', 'type')
    await queryInterface.removeColumn('messages', 'document_count')
    // Postgres keeps the ENUM type after its column is dropped.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_message_documents_type";')
  }
}

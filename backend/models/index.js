'use strict'

const { Sequelize } = require('sequelize')
const config = require('../db/config')

// One shared Sequelize instance for the whole backend — required as a module
// singleton by plugins/sequelize.js, db/umzug.js, db/migrate.js and db/seed.js.
const sequelize = new Sequelize(config.database, config.username, config.password, config)

const User = require('./user')(sequelize)

module.exports = { sequelize, Sequelize, User }

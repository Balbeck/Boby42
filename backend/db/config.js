'use strict'

// Single source of truth for the Postgres connection, for both sequelize-cli
// (via .sequelizerc) and the runtime Sequelize instance (models/index.js).
//
// The connection is assembled from discrete POSTGRES_* parts rather than a
// single DATABASE_URL: Docker Compose does not reliably interpolate ${VAR}
// inside a value coming from an --env-file, so the backend container receives
// the parts (see docker-compose.yml, .env.localMac, .env.prod) and the URL is
// built here. Host/port differ per mode — Compose bridge service name on local
// Mac, loopback-published port in prod (network_mode: host).

const config = {
  dialect: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  username: process.env.POSTGRES_USER || 'boby42',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DB || 'boby42',
  logging: false
}

// sequelize-cli reads this file keyed by environment; the runtime reads the
// flat object. Every environment resolves to the same env-driven config.
module.exports = { ...config, development: config, test: config, production: config }

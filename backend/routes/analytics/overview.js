'use strict'

const analytics = require('../../services/analytics.service')

// The one payload the /lab 🔬 dashboard needs for its tiles + charts, driven by
// a `{ from, to }` window (default: now − 7 days → now). Transport only — every
// figure is a raw SQL aggregate in services/analytics.service.js.
//
// Autoload prefixes this folder as `/analytics`, so the path below is
// `/analytics/overview`. Behind `fastify.verifyLab` like the rest of /lab.

const querystring = {
  type: 'object',
  properties: {
    from: { type: 'string' }, // ISO 8601; unparseable → default window
    to: { type: 'string' }
  }
}

module.exports = async function (fastify) {
  fastify.get(
    '/overview',
    { schema: { querystring }, preHandler: fastify.verifyLab },
    async function (request) {
      const window = analytics.resolveWindow(request.query)

      const [
        range,
        allTime,
        visitors,
        volume,
        feedback,
        scoreHistogram,
        topDocuments,
        languages,
        errors
      ] = await Promise.all([
        analytics.totals(window),
        // The all-time block reuses the same SQL with an unbounded window.
        analytics.totals({ from: '-infinity', to: 'infinity' }),
        analytics.dailyVisitors(window),
        analytics.dailyVolume(window),
        analytics.dailyFeedback(window),
        analytics.scoreHistogram(window),
        analytics.topDocuments(window),
        analytics.languageSplit(window),
        analytics.errorBreakdown(window)
      ])

      return {
        window,
        totals: { range, allTime },
        daily: { visitors, volume, feedback },
        scoreHistogram,
        topDocuments,
        languages,
        errors
      }
    }
  )
}

'use strict'

/**
 * Deletes all three fixture-scoped cache rows so the next request recomputes fresh data.
 * Called after any write that mutates match data (deliveries, manual entries, result edits).
 * @param {import('better-sqlite3').Database} db
 * @param {string} fixtureId
 */
function invalidateFixtureCaches(db, fixtureId) {
  db.prepare('DELETE FROM match_stats_cache  WHERE fixture_id = ?').run(fixtureId)
  db.prepare('DELETE FROM match_detail_cache WHERE fixture_id = ?').run(fixtureId)
  db.prepare('DELETE FROM mvp_cache          WHERE fixture_id = ?').run(fixtureId)
}

module.exports = { invalidateFixtureCaches }

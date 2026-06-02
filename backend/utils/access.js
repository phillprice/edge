'use strict'
const { getAuthContext } = require('../middleware/auth')

// Reads the verified auth context attached by attachAuthContext middleware.
// Returns { isSuperAdmin, groups: [{ team_id, season_id }] }.
function getJwtMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, groups: ctx.groups }
}

/**
 * Build a SQL WHERE fragment restricting fixtures to those the user can see.
 * Assumes the fixtures table is aliased as `f` in the calling query.
 *
 * Access is based on watched_teams (team_id + season_id), resolved through
 * scheduled_fixtures.play_cricket_id → fixtures.play_cricket_id.
 *
 * Returns null (no restriction) for super admins or when Clerk is not configured.
 * Returns { sql: '1 = 0', params: [] } for authenticated users with no groups.
 * Returns { sql, params } subquery filter for users with groups.
 */
function buildAccessFilter(req) {
  const { isSuperAdmin, groups } = getJwtMeta(req)

  if (isSuperAdmin) return null
  if (groups.length === 0) return { sql: '1 = 0', params: [] }

  // Each group is { team_id, season_id } — filter by fixtures ingested for those teams
  const clauses = groups.map(() => '(sf.team_id = ? AND sf.season_id = ?)')
  return {
    sql: `f.play_cricket_id IS NOT NULL AND CAST(f.play_cricket_id AS INTEGER) IN (
      SELECT sf.play_cricket_id FROM scheduled_fixtures sf
      WHERE ${clauses.join(' OR ')}
    )`,
    params: groups.flatMap(g => [Number(g.team_id), Number(g.season_id)]),
  }
}

module.exports = { buildAccessFilter, getJwtMeta }

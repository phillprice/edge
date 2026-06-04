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
 * Access is based on watched_teams (team_id + season_id), resolved through the
 * fixture_seasons mapping table — which covers BOTH ingested and manual matches.
 *
 * Returns null (no restriction) for super admins or when Clerk is not configured.
 * Returns { sql: '1 = 0', params: [] } for authenticated users with no groups.
 * Returns { sql, params } subquery filter for users with groups.
 */
function buildAccessFilter(req) {
  const { isSuperAdmin, groups } = getJwtMeta(req)

  if (isSuperAdmin) return null
  if (groups.length === 0) return { sql: '1 = 0', params: [] }

  // Each group is { team_id, season_id }. Scope via fixture_seasons so manual matches
  // (no play_cricket_id) are visible to scoped users, identically to ingested ones.
  const clauses = groups.map(() => '(fs.team_id = ? AND fs.season_id = ?)')
  return {
    sql: `f.fixture_id IN (
      SELECT fs.fixture_id FROM fixture_seasons fs
      WHERE ${clauses.join(' OR ')}
    )`,
    params: groups.flatMap(g => [Number(g.team_id), Number(g.season_id)]),
  }
}

// Parse requested team_id+season_id pairs from a query — either
//   ?groups=team:season,team:season   or   ?team_id=…&season_id=…
function parseGroupPairs(query) {
  const add = (acc, t, s) => {
    const ti = parseInt(t, 10), si = parseInt(s, 10)
    if (Number.isFinite(ti) && Number.isFinite(si)) acc.push({ team_id: ti, season_id: si })
    return acc
  }
  if (typeof query.groups === 'string' && query.groups.trim()) {
    return query.groups.split(',').reduce((acc, tok) => add(acc, ...tok.split(':')), [])
  }
  return add([], query.team_id, query.season_id)
}

/**
 * Build a WHERE fragment narrowing fixtures (alias `f`) to the team/season pairs the user
 * explicitly selected in the filter. Returns null when no valid pairs are requested.
 * Security: each pair must be in the user's own access groups (super admins may pick any),
 * so a fabricated pair can only narrow within the already-allowed set. Scopes via
 * fixture_seasons so manual + ingested matches behave identically.
 */
function buildGroupFilter(req) {
  const pairs = parseGroupPairs(req.query)
  if (!pairs.length) return null

  const { isSuperAdmin, groups } = getJwtMeta(req)
  const allowed = isSuperAdmin
    ? pairs
    : pairs.filter(p => groups.some(g => Number(g.team_id) === p.team_id && Number(g.season_id) === p.season_id))
  if (!allowed.length) return null

  const clause = allowed.map(() => '(fs.team_id = ? AND fs.season_id = ?)').join(' OR ')
  return {
    sql: `f.fixture_id IN (SELECT fs.fixture_id FROM fixture_seasons fs WHERE ${clause})`,
    params: allowed.flatMap(p => [p.team_id, p.season_id]),
  }
}

module.exports = { buildAccessFilter, buildGroupFilter, getJwtMeta }

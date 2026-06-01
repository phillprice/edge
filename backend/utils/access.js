'use strict'

// Reads access groups from the Clerk session claims on req.auth.
// Returns { isSuperAdmin, groups: [{team, year}] } or null when no CLERK_SECRET_KEY.
// isSuperAdmin: sees everything, no filtering.
// groups: only fixtures/stats where team+year matches at least one group.
// No groups (empty array): sees nothing. Clerk not configured: unrestricted (dev mode).
function getUserAccess(req) {
  if (!process.env.CLERK_SECRET_KEY) return { isSuperAdmin: true, groups: [] }
  const meta = req.auth?.sessionClaims?.metadata ?? {}
  return {
    isSuperAdmin: meta.isSuperAdmin === true,
    groups:       Array.isArray(meta.accessGroups) ? meta.accessGroups : [],
  }
}

// Returns a SQL WHERE fragment (without leading AND) that restricts fixtures to those
// accessible by the user, or null if no restriction is needed.
// teamCol and yearCol are the SQL expressions for the team and year columns.
//
// Usage: const filter = buildAccessFilter(req, 'f.home_team', 'f.away_team', "substr(f.match_date_iso,1,4)")
//        if (filter) query += ` AND (${filter.sql})`, params.push(...filter.params)
function buildAccessFilter(req, homeTeamCol, awayTeamCol, yearCol) {
  const { isSuperAdmin, groups } = getUserAccess(req)
  if (isSuperAdmin) return null
  if (groups.length === 0) return { sql: '1 = 0', params: [] }

  // For each group, the fixture must be in the right year AND involve the right team.
  // A team value like 'whirlwind' matches any team name containing that string.
  const clauses = groups.map(g => {
    const teamPat = `%${g.team.toLowerCase()}%`
    return {
      sql: `(${yearCol} = ? AND (lower(${homeTeamCol}) LIKE ? OR lower(${awayTeamCol}) LIKE ?))`,
      params: [g.year, teamPat, teamPat],
    }
  })

  return {
    sql:    clauses.map(c => c.sql).join(' OR '),
    params: clauses.flatMap(c => c.params),
  }
}

module.exports = { getUserAccess, buildAccessFilter }

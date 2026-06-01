'use strict'

// Decodes the Clerk JWT from the Authorization header and returns access metadata.
// Returns { isSuperAdmin, groups: [{team, year}] }.
// isSuperAdmin: sees everything, no filtering.
// groups: restricts to matching fixtures; empty = sees nothing.
// No CLERK_SECRET_KEY (dev mode): unrestricted.
function getUserAccess(req) {
  if (!process.env.CLERK_SECRET_KEY) return { isSuperAdmin: true, groups: [] }
  try {
    const token  = (req.headers.authorization || '').replace('Bearer ', '')
    const meta   = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))?.metadata ?? {}
    return {
      isSuperAdmin: meta.isSuperAdmin === true,
      groups:       Array.isArray(meta.accessGroups) ? meta.accessGroups : [],
    }
  } catch {
    return { isSuperAdmin: false, groups: [] }
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

'use strict'

const WHCC_FALLBACK = ['woking', 'horsell', 'whirlwind', 'hurricane']

function escapeLike(s) {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function getJwtMeta(req) {
  if (!process.env.CLERK_SECRET_KEY) return { isSuperAdmin: true, club_id: null, accessGroups: [] }
  const meta = req.auth?.sessionClaims?.metadata ?? {}
  return {
    isSuperAdmin: meta.isSuperAdmin === true,
    club_id:      meta.club_id ?? null,
    accessGroups: Array.isArray(meta.accessGroups) ? meta.accessGroups : [],
  }
}

/**
 * Returns the club's team patterns for the requesting user,
 * or null if no club is assigned (backwards compat — no restriction).
 * Super admins also return null (they see everything).
 */
function getMyClubPatterns(req, db) {
  const { isSuperAdmin, club_id } = getJwtMeta(req)
  if (isSuperAdmin || !club_id) return null
  const rows = db.prepare('SELECT pattern FROM club_teams WHERE club_id = ?').all(club_id)
  return rows.map(r => r.pattern) // empty array = club with no patterns → caller restricts to nothing
}

/**
 * Returns true if teamName matches any of the club's patterns.
 * patterns = null → fall back to WHCC keywords (backwards compat for unassigned users).
 */
function isMyTeam(teamName, patterns) {
  const haystack = (teamName || '').toLowerCase()
  return (patterns ?? WHCC_FALLBACK).some(p => haystack.includes(p.toLowerCase()))
}

/**
 * Build a SQL WHERE fragment restricting fixtures to those visible to the
 * requesting user.  Returns null when no restriction is needed (super admin,
 * or no access policy configured).
 *
 * @param {object}  req
 * @param {string}  homeTeamCol  SQL expression for the home_team column
 * @param {string}  awayTeamCol  SQL expression for the away_team column
 * @param {string}  yearCol      SQL expression for the year (e.g. "substr(f.match_date_iso,1,4)")
 * @param {object}  [db]         better-sqlite3 db instance (required for club_id path)
 * @returns {{ sql: string, params: any[] } | null}
 */
function buildAccessFilter(req, homeTeamCol, awayTeamCol, yearCol, db) {
  const { isSuperAdmin, club_id, accessGroups } = getJwtMeta(req)

  if (isSuperAdmin) return null

  // Club-based access: user is assigned to a specific club
  if (club_id && db) {
    const patterns = db.prepare('SELECT pattern FROM club_teams WHERE club_id = ?').all(club_id)
    if (patterns.length) {
      const clauses = patterns.map(() =>
        `(lower(${homeTeamCol}) LIKE ? ESCAPE '\\' OR lower(${awayTeamCol}) LIKE ? ESCAPE '\\')`
      )
      return {
        sql:    clauses.join(' OR '),
        params: patterns.flatMap(p => [`%${escapeLike(p.pattern)}%`, `%${escapeLike(p.pattern)}%`]),
      }
    }
    // Club with no patterns defined — see nothing (avoid accidental data leak)
    return { sql: '1 = 0', params: [] }
  }

  // Legacy: per-team/year access groups
  if (accessGroups.length > 0) {
    const built = accessGroups.map(g => {
      const pat = `%${escapeLike(g.team.toLowerCase())}%`
      return {
        sql:    `(${yearCol} = ? AND (lower(${homeTeamCol}) LIKE ? ESCAPE '\\' OR lower(${awayTeamCol}) LIKE ? ESCAPE '\\'))`,
        params: [String(g.year), pat, pat],
      }
    })
    return {
      sql:    built.map(c => c.sql).join(' OR '),
      params: built.flatMap(c => c.params),
    }
  }

  return null
}

module.exports = { buildAccessFilter, getJwtMeta, getMyClubPatterns, isMyTeam, escapeLike, WHCC_FALLBACK }

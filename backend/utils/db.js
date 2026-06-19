// Shared helpers for the "is this one of OUR club's teams?" test.
//
// Our club is Woking & Horsell CC (WHCC). In play-cricket data our teams always
// appear as either "WHCC <sub-team>" or "Woking & Horsell CC - <sub-team>", so the
// only reliable markers are 'whcc' and 'horsell'. We deliberately do NOT match:
//   - bare 'woking'  → hits the unrelated "Old Woking CC"
//   - sub-team names (whirlwind/hurricane/thunder/lightning) → reused by other clubs,
//     e.g. "Camberley CC - Girls U14 Lightning", "Horsley & Send CC - U10 Hurricanes"
//
// This module is the single source of truth — JS predicate (isWhccTeam) and SQL
// fragments (whccCol / whccFixtureWhere / whccPlayerWhere) all derive from WHCC_MARKERS.
// Using functions for alias flexibility — different queries use different table aliases.

const WHCC_MARKERS = ['whcc', 'horsell']

// JS predicate: does this team name belong to our club?
function isWhccTeam(name) {
  const l = (name || '').toLowerCase()
  return WHCC_MARKERS.some((m) => l.includes(m))
}

// SQL fragment for the same test against a single column. `col` is always a
// hardcoded literal identifier at call sites — never user input.
function whccCol(col) {
  return '(' + WHCC_MARKERS.map((m) => `lower(${col}) LIKE '%${m}%'`).join(' OR ') + ')'
}

function whccFixtureWhere(alias = 'f') {
  return `(${whccCol(`${alias}.home_team`)} OR ${whccCol(`${alias}.away_team`)})`
}

function whccPlayerWhere(alias = 'p') {
  return whccCol(`${alias}.team`)
}

// Year string from the normalised ISO date column.
function yearExpr(alias = 'f') {
  return `substr(${alias}.match_date_iso, 1, 4)`
}

// Build a team WHERE clause for the WHCC sub-team filter on player stats.
// Narrows to a named sub-team (e.g. 'whirlwind') AND requires a WHCC marker on the
// SAME team, so opposition teams sharing the sub-name are excluded.
function whccTeamClause(team) {
  if (!team) return { clause: '', params: [] }
  return {
    clause: `AND ((lower(f.home_team) LIKE ? AND ${whccCol('f.home_team')})
             OR (lower(f.away_team) LIKE ? AND ${whccCol('f.away_team')}))`,
    params: [`%${team}%`, `%${team}%`]
  }
}

/**
 * Returns club-specific SQL filter fragments for the requesting club.
 * Pass the db instance and the clubId from the auth context.
 *
 * Returns:
 *   fixtureWhere   — SQL fragment for WHERE on fixtures aliased as `f`
 *   fixtureParams  — positional params for fixtureWhere
 *   playerWhere    — function(alias) → SQL fragment for filtering players by club team name
 *   playerParams   — params array for playerWhere (empty — marker matching uses LIKE literals)
 *
 * Falls back to WHCC behaviour when clubId is null (dev mode / no Clerk).
 */
function getClubFilters(db, clubId) {
  if (clubId == null) {
    return {
      fixtureWhere: whccFixtureWhere(),
      fixtureParams: [],
      colWhere: (col) => whccCol(col),
      playerWhere: (alias = 'p') => whccPlayerWhere(alias),
      playerParams: []
    }
  }
  const row = db.prepare(`SELECT name_markers FROM clubs WHERE club_id = ?`).get(clubId)
  const markers = row?.name_markers ? JSON.parse(row.name_markers) : WHCC_MARKERS
  const markerSql = (col) =>
    '(' + markers.map((m) => `lower(${col}) LIKE '%${m}%'`).join(' OR ') + ')'
  return {
    fixtureWhere: `f.fixture_id IN (
      SELECT fs.fixture_id FROM fixture_seasons fs
      WHERE fs.team_id IN (SELECT team_id FROM watched_teams WHERE club_id = ?)
    )`,
    fixtureParams: [clubId],
    colWhere: (col) => markerSql(col),
    playerWhere: (alias = 'p') => markerSql(`${alias}.team`),
    playerParams: []
  }
}

module.exports = {
  WHCC_MARKERS,
  isWhccTeam,
  whccCol,
  whccFixtureWhere,
  whccPlayerWhere,
  yearExpr,
  whccTeamClause,
  getClubFilters
}

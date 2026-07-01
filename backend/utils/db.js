// Shared helpers for the "is this one of OUR club's teams?" test.
//
// In play-cricket data, club teams appear with the club's own name markers.
// This module is the single source of truth — JS predicate (isOurTeam) and SQL
// fragments (ourCol / ourFixtureWhere / ourPlayerWhere) all derive from DEFAULT_MARKERS.
// Using functions for alias flexibility — different queries use different table aliases.
//
// DEFAULT_MARKERS is the fallback for WHCC (the seed club). All route handlers
// should use getClubFilters(db, clubId) to get per-club markers at request time.

const DEFAULT_MARKERS = ['whcc', 'horsell']

// JS predicate: does this team name belong to our club?
function isOurTeam(name) {
  const l = (name || '').toLowerCase()
  return DEFAULT_MARKERS.some((m) => l.includes(m))
}

// SQL fragment for the same test against a single column. `col` is always a
// hardcoded literal identifier at call sites — never user input.
function ourCol(col) {
  return '(' + DEFAULT_MARKERS.map((m) => `lower(${col}) LIKE '%${m}%'`).join(' OR ') + ')'
}

function ourFixtureWhere(alias = 'f') {
  return `(${ourCol(`${alias}.home_team`)} OR ${ourCol(`${alias}.away_team`)})`
}

function ourPlayerWhere(alias = 'p') {
  return ourCol(`${alias}.team`)
}

// Year string from the normalised ISO date column.
function yearExpr(alias = 'f') {
  return `substr(${alias}.match_date_iso, 1, 4)`
}

// Build a team WHERE clause for a club sub-team filter on player stats.
// Narrows to a named sub-team (e.g. 'whirlwind') AND requires a club marker on the
// SAME team, so opposition teams sharing the sub-name are excluded.
function ourTeamClause(team) {
  if (!team) return { clause: '', params: [] }
  return {
    clause: `AND ((lower(f.home_team) LIKE ? AND ${ourCol('f.home_team')})
             OR (lower(f.away_team) LIKE ? AND ${ourCol('f.away_team')}))`,
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
 *   colWhere       — function(col) → SQL LIKE fragment for the club's markers
 *   playerWhere    — function(alias) → SQL fragment for filtering players by club team name
 *   playerParams   — params array for playerWhere (empty — marker matching uses LIKE literals)
 *   isOurTeam      — JS predicate: does this team name belong to the club?
 *
 * Falls back to WHCC behaviour when clubId is null (dev mode / no Clerk).
 */
function getClubFilters(db, clubId) {
  if (clubId == null) {
    return {
      fixtureWhere: ourFixtureWhere(),
      fixtureParams: [],
      colWhere: (col) => ourCol(col),
      playerWhere: (alias = 'p') => ourPlayerWhere(alias),
      playerParams: [],
      isOurTeam
    }
  }
  const row = db.prepare(`SELECT name_markers FROM clubs WHERE club_id = ?`).get(clubId)
  const markers = row?.name_markers ? JSON.parse(row.name_markers) : DEFAULT_MARKERS
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
    playerParams: [],
    isOurTeam: (name) => markers.some((m) => (name || '').toLowerCase().includes(m))
  }
}

function getClubShowMvp(db, clubId) {
  if (clubId == null) return true
  const row = db.prepare('SELECT show_mvp FROM clubs WHERE club_id = ?').get(clubId)
  return row ? !!row.show_mvp : true
}

module.exports = {
  DEFAULT_MARKERS,
  isOurTeam,
  ourCol,
  ourFixtureWhere,
  ourPlayerWhere,
  yearExpr,
  ourTeamClause,
  getClubFilters,
  getClubShowMvp
}

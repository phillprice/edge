// Shared SQL fragments used across route files.
// Using functions for alias flexibility — different queries use different table aliases.

function whccFixtureWhere(alias = 'f') {
  return `(lower(${alias}.home_team) LIKE '%woking%' OR lower(${alias}.home_team) LIKE '%horsell%'
    OR lower(${alias}.away_team) LIKE '%woking%' OR lower(${alias}.away_team) LIKE '%horsell%'
    OR lower(${alias}.home_team) LIKE '%whirlwind%' OR lower(${alias}.home_team) LIKE '%hurricane%'
    OR lower(${alias}.away_team) LIKE '%whirlwind%' OR lower(${alias}.away_team) LIKE '%hurricane%')`;
}

function whccPlayerWhere(alias = 'p') {
  return `(lower(${alias}.team) LIKE '%woking%' OR lower(${alias}.team) LIKE '%horsell%'
    OR lower(${alias}.team) LIKE '%whirlwind%' OR lower(${alias}.team) LIKE '%hurricane%')`;
}

// Year string from the normalised ISO date column.
function yearExpr(alias = 'f') {
  return `substr(${alias}.match_date_iso, 1, 4)`;
}

// Build a parametric team WHERE clause for the WHCC-team filter on player stats.
// Returns { clause, params } — params must be spread into the prepared-statement args.
// The 'hurricane' case also requires a WHCC primary marker to exclude teams that happen
// to share the name (e.g. Horsley & Send Hurricanes).
function whccTeamClause(team) {
  if (!team) return { clause: '', params: [] };
  if (team === 'hurricane') {
    const whcc = `(lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%' OR lower(f.home_team) LIKE '%whcc%')`;
    const awcc = `(lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%' OR lower(f.away_team) LIKE '%whcc%')`;
    return {
      clause: `AND ((lower(f.home_team) LIKE '%hurricane%' AND ${whcc}) OR (lower(f.away_team) LIKE '%hurricane%' AND ${awcc}))`,
      params: [],
    };
  }
  return {
    clause: `AND (lower(f.home_team) LIKE ? OR lower(f.away_team) LIKE ?)`,
    params: [`%${team}%`, `%${team}%`],
  };
}

/**
 * Builds a { sql, params } WHERE fragment for "fixtures involving my club's teams".
 * patterns = null  → falls back to whccFixtureWhere() (backwards compat, no params).
 * patterns = []    → '1 = 0' (club exists but has no patterns — show nothing).
 */
function buildMyClubFixtureWhere(patterns, homeAlias = 'f.home_team', awayAlias = 'f.away_team') {
  const { escapeLike } = require('./access');
  if (!patterns) return { sql: whccFixtureWhere(), params: [] };
  if (patterns.length === 0) return { sql: '1 = 0', params: [] };
  const clauses = patterns.map(() =>
    `(lower(${homeAlias}) LIKE ? ESCAPE '\\' OR lower(${awayAlias}) LIKE ? ESCAPE '\\')`
  );
  return {
    sql:    clauses.join(' OR '),
    params: patterns.flatMap(p => [`%${escapeLike(p)}%`, `%${escapeLike(p)}%`]),
  };
}

module.exports = { whccFixtureWhere, whccPlayerWhere, yearExpr, whccTeamClause, buildMyClubFixtureWhere };

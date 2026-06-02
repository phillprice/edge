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
//
// Sub-team names (hurricane, whirlwind, thunder, lightning) are used by other clubs too,
// so we always require a WHCC primary marker on the SAME team to avoid matching opposition
// teams with the same sub-name (e.g. Camberley Lightning, Horsley & Send Hurricanes).
const WHCC_QUAL = (col) =>
  `(lower(${col}) LIKE '%woking%' OR lower(${col}) LIKE '%horsell%' OR lower(${col}) LIKE '%whcc%')`;

function whccTeamClause(team) {
  if (!team) return { clause: '', params: [] };
  return {
    clause: `AND ((lower(f.home_team) LIKE '%${team}%' AND ${WHCC_QUAL('f.home_team')})
             OR (lower(f.away_team) LIKE '%${team}%' AND ${WHCC_QUAL('f.away_team')}))`,
    params: [],
  };
}

module.exports = { whccFixtureWhere, whccPlayerWhere, yearExpr, whccTeamClause };

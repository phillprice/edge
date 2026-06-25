'use strict'

const playerStatsService = require('./playerStatsService')
const { buildFilterClauses } = require('../utils/filterClauses')

const BENCHMARKS = { bat: 8.0, bowl: 6.0, field: 2.5 }
const MIN_MATCHES = 5

function clamp100(v) {
  return Math.min(100, Math.max(0, Math.round(v)))
}

const GC_SQL = `
WITH
filtered_fixtures AS (
  SELECT f.fixture_id FROM fixtures f
  WHERE {fixtureWhere}
  {yearClause}
  {teamClause}
  {compFilter}
  {formatClause}
  {accessClause}
  {groupClause}
),
whcc_players AS (
  SELECT player_id FROM players WHERE {playerWhere}
),
bat_pts AS (
  SELECT i.fixture_id, d.batter_id AS player_id, SUM(d.runs_bat) * 0.1 AS pts
  FROM deliveries d
  JOIN innings i ON i.result_id = d.result_id
  JOIN filtered_fixtures ff ON ff.fixture_id = i.fixture_id
  WHERE d.batter_id IN (SELECT player_id FROM whcc_players)
  GROUP BY i.fixture_id, d.batter_id
  UNION ALL
  SELECT mb.fixture_id, mb.player_id, SUM(mb.runs) * 0.1 AS pts
  FROM manual_batting mb
  JOIN filtered_fixtures ff ON ff.fixture_id = mb.fixture_id
  WHERE mb.player_id IN (SELECT player_id FROM whcc_players) AND mb.did_not_bat = 0
  GROUP BY mb.fixture_id, mb.player_id
),
bowl_pts AS (
  SELECT i.fixture_id, d.bowler_id AS player_id,
    SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) * 1.8
    + CASE
        WHEN SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) >= 5 THEN 1.0
        WHEN SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) >= 3 THEN 0.5
        ELSE 0
      END AS pts
  FROM deliveries d
  JOIN innings i ON i.result_id = d.result_id
  JOIN filtered_fixtures ff ON ff.fixture_id = i.fixture_id
  WHERE d.bowler_id IN (SELECT player_id FROM whcc_players)
  GROUP BY i.fixture_id, d.bowler_id
  UNION ALL
  SELECT mbw.fixture_id, mbw.player_id,
    SUM(mbw.wickets) * 1.8
    + CASE
        WHEN SUM(mbw.wickets) >= 5 THEN 1.0
        WHEN SUM(mbw.wickets) >= 3 THEN 0.5
        ELSE 0
      END AS pts
  FROM manual_bowling mbw
  JOIN filtered_fixtures ff ON ff.fixture_id = mbw.fixture_id
  WHERE mbw.player_id IN (SELECT player_id FROM whcc_players)
  GROUP BY mbw.fixture_id, mbw.player_id
),
field_pts AS (
  SELECT dis.fixture_id, dis.fielder_id AS player_id, COUNT(*) * 0.36 AS pts
  FROM dismissals dis
  JOIN filtered_fixtures ff ON ff.fixture_id = dis.fixture_id
  WHERE dis.method IN ('Caught','CaughtAndBowled','Stumped','RunOut')
    AND dis.fielder_id IN (SELECT player_id FROM whcc_players)
  GROUP BY dis.fixture_id, dis.fielder_id
  UNION ALL
  SELECT mf.fixture_id, mf.player_id,
    (SUM(mf.catches) + SUM(mf.stumpings) + SUM(mf.run_outs)) * 0.36 AS pts
  FROM manual_fielding mf
  JOIN filtered_fixtures ff ON ff.fixture_id = mf.fixture_id
  WHERE mf.player_id IN (SELECT player_id FROM whcc_players)
  GROUP BY mf.fixture_id, mf.player_id
),
all_pts AS (
  SELECT fixture_id, player_id, SUM(pts) AS total
  FROM (
    SELECT fixture_id, player_id, pts FROM bat_pts
    UNION ALL SELECT fixture_id, player_id, pts FROM bowl_pts
    UNION ALL SELECT fixture_id, player_id, pts FROM field_pts
  )
  GROUP BY fixture_id, player_id
),
ranked AS (
  SELECT fixture_id, player_id,
    RANK() OVER (PARTITION BY fixture_id ORDER BY total DESC) AS rnk
  FROM all_pts
)
SELECT player_id, COUNT(*) AS gamechanger_count
FROM ranked WHERE rnk = 1
GROUP BY player_id
`

function queryGamechangers(db, clauses) {
  const {
    yearClause,
    yearParams,
    teamClause,
    teamParams,
    compFilter,
    formatClause,
    accessClause,
    accessParams,
    groupClause,
    groupParams,
    clubFilters
  } = clauses
  const sql = GC_SQL.replace('{fixtureWhere}', clubFilters.fixtureWhere)
    .replace('{playerWhere}', clubFilters.playerWhere('players'))
    .replace('{yearClause}', yearClause)
    .replace('{teamClause}', teamClause)
    .replace('{compFilter}', compFilter)
    .replace('{formatClause}', formatClause)
    .replace('{accessClause}', accessClause)
    .replace('{groupClause}', groupClause)
  const rows = db
    .prepare(sql)
    .all(
      ...clubFilters.fixtureParams,
      ...yearParams,
      ...teamParams,
      ...accessParams,
      ...groupParams
    )
  return new Map(rows.map((r) => [r.player_id, r.gamechanger_count]))
}

function normalisePlayer(r, gcMap) {
  const matches = r.games_attended
  const batPtsPerMatch = (r.runs * 0.1) / matches
  const haulBonus = r.five_fers * 1.0 + (r.three_fers - r.five_fers) * 0.5
  const bowlPtsPerMatch = (r.wickets * 1.8 + haulBonus + r.maidens * 0.9) / matches
  const fieldPtsPerMatch = ((r.catches + r.stumpings + r.run_outs) * 0.36) / matches
  const batting = clamp100((batPtsPerMatch / BENCHMARKS.bat) * 100)
  const bowling = clamp100((bowlPtsPerMatch / BENCHMARKS.bowl) * 100)
  const fielding = clamp100((fieldPtsPerMatch / BENCHMARKS.field) * 100)
  const gamechanger = gcMap.get(r.player_id) || 0
  const overall = clamp100(
    0.45 * batting + 0.3 * bowling + 0.15 * fielding + Math.min(10, gamechanger)
  )
  return {
    player_id: r.player_id,
    name: r.name,
    jerseyNumber: r.jerseyNumber,
    batting,
    bowling,
    fielding,
    gamechanger,
    overall,
    matches,
    qualified: matches >= MIN_MATCHES
  }
}

function computeTopTrumps(db, req) {
  const allStats = playerStatsService.queryCombinedStats(db, req)
  const gcMap = queryGamechangers(db, buildFilterClauses(db, req))
  return allStats
    .filter((r) => r.games_attended > 0)
    .map((r) => normalisePlayer(r, gcMap))
    .sort((a, b) => b.overall - a.overall)
}

module.exports = { computeTopTrumps }

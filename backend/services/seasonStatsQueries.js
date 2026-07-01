'use strict'

// Shared SQL fragments for the delivery-sourced vs manual-entry-sourced halves of the
// season-stats batting/bowling summary and leaderboard queries in getSeasonStats.
//
// Both the "summary" queries (aggregate totals across all qualifying fixtures) and the
// "leaderboard" queries (per-player totals, ranked) union together a delivery-derived
// subselect and a manual_batting/manual_bowling-derived subselect. The two halves below
// are textually identical to what previously lived inline in matchService.js — this
// module only gives them names and lets summary/leaderboard queries share the same
// underlying SQL text instead of hand-duplicating it.

// Delivery-sourced batting rows. groupBy is `d.batter_id, d.result_id` for the summary
// query (per-innings totals) or just `d.batter_id` for the leaderboard (per-player totals).
function deliveryBattingSelect(rfSub, colWhere, groupBy) {
  return `
      SELECT d.batter_id AS player_id, SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS outs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY ${groupBy}`
}

// Manual-entry batting rows (manual_batting is already one row per player per innings).
function manualBattingSelect(rfSub, groupBy) {
  return `
      SELECT mb.player_id, mb.runs,
        CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END AS outs,
        mb.balls
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
      ${groupBy ? `GROUP BY ${groupBy}` : ''}`
}

// Delivery-sourced bowling rows. groupBy is `d.bowler_id, d.result_id` for the summary
// query (per-innings totals) or just `d.bowler_id` for the leaderboard (per-player totals).
function deliveryBowlingSelect(rfSub, colWhere, groupBy) {
  return `
      SELECT d.bowler_id AS player_id,
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY ${groupBy}`
}

// Manual-entry bowling rows (manual_bowling is already one row per player per innings).
function manualBowlingSelect(rfSub, groupBy) {
  return `
      SELECT mbw.player_id, mbw.wickets, mbw.balls AS legal_balls, mbw.runs
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
      ${groupBy ? `GROUP BY ${groupBy}` : ''}`
}

// Season-wide batting summary: SUM(runs)/SUM(outs)/SUM(balls) across delivery + manual rows.
function battingSummarySql(rfSub, colWhere) {
  return `SELECT SUM(runs) AS total_runs, SUM(outs) AS total_outs, SUM(balls) AS total_balls
    FROM (
      ${deliveryBattingSelect(rfSub, colWhere, 'd.batter_id, d.result_id')}
      UNION ALL
      ${manualBattingSelect(rfSub, null)}
    )`
}

// Season-wide bowling summary: SUM(wickets)/SUM(legal_balls)/SUM(runs) across delivery + manual rows.
function bowlingSummarySql(rfSub, colWhere) {
  return `SELECT SUM(wickets) AS total_wickets, SUM(legal_balls) AS total_balls, SUM(runs) AS total_runs
    FROM (
      ${deliveryBowlingSelect(rfSub, colWhere, 'd.bowler_id, d.result_id')}
      UNION ALL
      ${manualBowlingSelect(rfSub, null)}
    )`
}

// Top-3 run scorers across the season (delivery + manual rows combined per player).
function topBattersSql(rfSub, colWhere) {
  return `SELECT p.player_id, p.name,
      SUM(t.runs) AS total_runs,
      SUM(t.outs) AS total_outs
    FROM (
      ${deliveryBattingSelect(rfSub, colWhere, 'd.batter_id')}
      UNION ALL
      ${manualBattingSelect(rfSub, 'mb.player_id')}
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.runs) DESC LIMIT 3`
}

// Top-3 wicket takers across the season (delivery + manual rows combined per player).
function topBowlersSql(rfSub, colWhere) {
  return `SELECT p.player_id, p.name,
      SUM(t.wickets) AS total_wickets,
      SUM(t.legal_balls) AS total_balls,
      SUM(t.runs) AS total_runs
    FROM (
      ${deliveryBowlingSelect(rfSub, colWhere, 'd.bowler_id')}
      UNION ALL
      ${manualBowlingSelect(rfSub, 'mbw.player_id')}
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.wickets) DESC LIMIT 3`
}

module.exports = {
  battingSummarySql,
  bowlingSummarySql,
  topBattersSql,
  topBowlersSql
}

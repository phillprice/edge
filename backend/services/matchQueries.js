'use strict'

const { tagsSubquery } = require('../utils/tags')

// The match-list fixture SELECT, with its dozen manual-vs-ingested correlated subqueries.
// Parameterized by accessWhere since that clause (built from the caller's access/group
// filters) is computed per-request in getMatchList, not static SQL text.
function buildFixtureSelectSql(accessWhere) {
  return `
    SELECT f.*,
      COUNT(DISTINCT i.result_id) as innings_count,
      COUNT(d.id) as total_deliveries,
      (SELECT COALESCE(SUM(mb.runs), 0) + COALESCE((SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id) as manual_runs,
      (SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id) as manual_extras,
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.not_out = 0 AND mb.did_not_bat = 0) as manual_wkts,
      (SELECT SUM(mbw.wickets) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_bowl_wkts,
      (SELECT COALESCE(SUM(mbw.runs), 0) + COALESCE((SELECT me.bowling_byes + me.bowling_leg_byes FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_opp_runs,
      COALESCE(
        (SELECT me.our_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.our_overs IS NOT NULL AND me.our_overs != ''),
        (SELECT CASE WHEN SUM(mb.balls) > 0 THEN CAST(SUM(mb.balls)/6 AS TEXT)||'.'||CAST(SUM(mb.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0)
      ) as manual_our_overs,
      COALESCE(
        (SELECT me.opp_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.opp_overs IS NOT NULL AND me.opp_overs != ''),
        (SELECT CASE WHEN SUM(mbw.balls) > 0 THEN CAST(SUM(mbw.balls)/6 AS TEXT)||'.'||CAST(SUM(mbw.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id)
      ) as manual_opp_overs,
      (SELECT p.name FROM manual_batting mb JOIN players_dn p ON p.player_id = mb.player_id
       WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat,
      (SELECT mb.runs FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_runs,
      (SELECT mb.balls FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_balls,
      (SELECT p.name FROM manual_bowling mbw JOIN players_dn p ON p.player_id = mbw.player_id
       WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl,
      (SELECT mbw.wickets FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_wkts,
      (SELECT mbw.runs FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_runs,
      msc.top_bat_name     AS ing_top_bat,
      msc.top_bat_runs     AS ing_top_bat_runs,
      msc.top_bat_balls    AS ing_top_bat_balls,
      msc.top_bowl_name    AS ing_top_bowl,
      msc.top_bowl_wickets AS ing_top_bowl_wkts,
      msc.top_bowl_runs    AS ing_top_bowl_runs,
      msc.mvp_name         AS ing_top_mvp_cached,
      msc.mvp_pts          AS ing_top_mvp_pts_cached,
      (SELECT COUNT(DISTINCT d3.batter_id) FROM innings i3 JOIN deliveries d3 ON d3.result_id = i3.result_id
       WHERE i3.fixture_id = f.fixture_id AND i3.innings_order = 1) AS inn1_batters,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT SUM(d2.runs_bat + d2.runs_extra) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 1) END AS inn1_runs,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT COUNT(*) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 1 AND d2.dismissed_batter_id IS NOT NULL) END AS inn1_wkts,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT SUM(d2.runs_bat + d2.runs_extra) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 2) END AS inn2_runs,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT COUNT(*) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 2 AND d2.dismissed_batter_id IS NOT NULL) END AS inn2_wkts,
      (${tagsSubquery('f.fixture_id')}) AS tags_csv
    FROM fixtures f
    LEFT JOIN innings i ON i.fixture_id = f.fixture_id
    LEFT JOIN deliveries d ON d.result_id = i.result_id
    LEFT JOIN match_stats_cache msc ON msc.fixture_id = f.fixture_id
    ${accessWhere}
    GROUP BY f.fixture_id
    ORDER BY f.match_date_iso DESC, f.fixture_id DESC
  `
}

module.exports = { buildFixtureSelectSql }

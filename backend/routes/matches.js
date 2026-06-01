const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { classifyDismissal } = require('../utils/cricket');
const { whccFixtureWhere, yearExpr: _yearExpr } = require('../utils/db');
const { buildAccessFilter } = require('../utils/access');

// Only use identifiers unique to WHCC — "Whirlwinds"/"Hurricanes" are used by other clubs too
const isWhccTeam = t => /woking|horsell|whcc/i.test(t || '');

const DEFAULT_OVERS = 20;

function parseHowOut(s) {
  if (!s) return null
  const lo = s.trim().toLowerCase()
  if (lo.startsWith('run out')) {
    const m = s.match(/run out\s*\(([^)]+)\)/i)
    return { type: 'Run out', fielder: m?.[1]?.trim() || null, bowler: null }
  }
  if (lo.startsWith('c&b') || lo.startsWith('caught and bowled')) {
    const bowler = s.replace(/^(c&b|caught and bowled)\s*/i, '').trim() || null
    return { type: 'CaughtAndBowled', fielder: null, bowler }
  }
  if (lo.startsWith('lbw')) {
    const m = s.match(/lbw\s+b\s+(.+)/i)
    return { type: 'LBW', fielder: null, bowler: m?.[1]?.trim() || null }
  }
  const stM = s.match(/^(?:st|stumped)\s+(.+)\s+b\s+(\S.+)$/i)
  if (stM) return { type: 'Stumped', fielder: stM[1].trim(), bowler: stM[2].trim() }
  const ctM = s.match(/^(?:ct|caught)\s+(.+)\s+b\s+(\S.+)$/i)
  if (ctM) return { type: 'Caught', fielder: ctM[1].trim(), bowler: ctM[2].trim() }
  const bM = s.match(/^(?:b|bowled)\s+(\S.+)$/i)
  if (bM) return { type: 'Bowled', fielder: null, bowler: bM[1].trim() }
  return null
}

// GET /api/matches
router.get('/', (req, res) => {
  const db = getDb();

  const MAX_LIMIT = 100;
  const DEFAULT_LIMIT = 50;
  let limit  = parseInt(req.query.limit,  10);
  let offset = parseInt(req.query.offset, 10);
  if (!Number.isFinite(limit)  || limit  < 1) limit  = DEFAULT_LIMIT;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const accessFilter = buildAccessFilter(req, 'f.home_team', 'f.away_team', "substr(f.match_date_iso,1,4)");
  const accessWhere  = accessFilter ? `WHERE (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];

  const FIXTURE_SELECT = `
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
        (SELECT me.whcc_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.whcc_overs IS NOT NULL AND me.whcc_overs != ''),
        (SELECT CASE WHEN SUM(mb.balls) > 0 THEN CAST(SUM(mb.balls)/6 AS TEXT)||'.'||CAST(SUM(mb.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0)
      ) as manual_whcc_overs,
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
      -- Fallback scores from deliveries for in-progress matches (only computed when home_score is null)
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
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 2 AND d2.dismissed_batter_id IS NOT NULL) END AS inn2_wkts
    FROM fixtures f
    LEFT JOIN innings i ON i.fixture_id = f.fixture_id
    LEFT JOIN deliveries d ON d.result_id = i.result_id
    LEFT JOIN match_stats_cache msc ON msc.fixture_id = f.fixture_id
    ${accessWhere}
    GROUP BY f.fixture_id
    ORDER BY f.match_date_iso DESC, f.fixture_id DESC
  `;

  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM (${FIXTURE_SELECT})`
  ).get(...accessParams);

  const fixtures = db.prepare(`${FIXTURE_SELECT} LIMIT ? OFFSET ?`).all(...accessParams, limit, offset);

  // Use pre-computed cache for all fixtures; fall back to on-demand for any cache misses.
  const uncachedManual = fixtures
    .filter(f => f.total_deliveries === 0 && f.manual_runs !== null && f.ing_top_mvp_cached === null)
    .map(f => f.fixture_id);
  const fallbackMvp = uncachedManual.length ? computeManualMvpForFixtures(db, uncachedManual) : {};
  const matches = fixtures.map(f => {
    let { home_score, away_score, home_wickets, away_wickets, result } = f
    // For in-progress matches with delivery data, compute scores from innings
    if (home_score === null && f.inn1_runs != null) {
      const homeWonToss = f.toss_winner && f.home_team &&
        f.toss_winner.toLowerCase().includes(f.home_team.split(' ')[0].toLowerCase())
      const inn1IsHome = (homeWonToss && f.toss_decision === 'bat') ||
                         (!homeWonToss && f.toss_decision === 'field')
      home_score    = String(inn1IsHome ? f.inn1_runs  : f.inn2_runs  ?? 0)
      away_score    = String(inn1IsHome ? f.inn2_runs  : f.inn1_runs  ?? 0)
      home_wickets  = String(inn1IsHome ? f.inn1_wkts  : f.inn2_wkts  ?? 0)
      away_wickets  = String(inn1IsHome ? f.inn2_wkts  : f.inn1_wkts  ?? 0)
      result = 'In Progress'
    }
    return {
      ...f,
      home_score, away_score, home_wickets, away_wickets, result,
      ing_top_mvp:     f.ing_top_mvp_cached     ?? fallbackMvp[f.fixture_id]?.name ?? null,
      ing_top_mvp_pts: f.ing_top_mvp_pts_cached ?? fallbackMvp[f.fixture_id]?.pts  ?? null,
    }
  });
  res.json({ matches, total, limit, offset });
});

// GET /api/matches/season?year=2025&team=whirlwind
router.get('/season', (req, res) => {
  const db = getDb();
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const VALID_TEAMS = ['whirlwind', 'hurricane'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const VALID_COMPS = ['cup', 'friendly', 'league'];
  const comp = VALID_COMPS.includes((req.query.comp || '').toLowerCase()) ? req.query.comp.toLowerCase() : null;

  const _ye = _yearExpr();
  const yearClause = year ? `AND ${_ye} = ?` : '';
  const yearParams = year ? [year] : [];

  const whccWhere = whccFixtureWhere();

  let teamClause = '', teamParams = [];
  if (team === 'hurricane') {
    const hw = `(lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%' OR lower(f.home_team) LIKE '%whcc%')`;
    const aw = `(lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%' OR lower(f.away_team) LIKE '%whcc%')`;
    teamClause = `AND ((lower(f.home_team) LIKE '%hurricane%' AND ${hw}) OR (lower(f.away_team) LIKE '%hurricane%' AND ${aw}))`;
  } else if (team === 'whirlwind') {
    teamClause = `AND (lower(f.home_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%whirlwind%')`;
  }
  const compClause = comp === 'cup'      ? `AND lower(f.competition) LIKE '%cup%'`
                   : comp === 'friendly' ? `AND lower(f.competition) = 'friendly'`
                   : comp === 'league'   ? `AND (f.competition IS NULL OR (lower(f.competition) NOT LIKE '%cup%' AND lower(f.competition) != 'friendly'))`
                   : '';

  const accessFilter = buildAccessFilter(req, 'f.home_team', 'f.away_team', "substr(f.match_date_iso,1,4)");
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];
  const rfSub = `SELECT f.fixture_id FROM fixtures f WHERE ${whccWhere} ${yearClause} ${teamClause} ${compClause} ${accessClause}`;

  // Fixtures for match record
  const fixtures = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.home_score, f.away_score,
      f.home_wickets, f.away_wickets, f.toss_winner, f.toss_decision,
      f.format, f.starting_score,
      (SELECT COUNT(DISTINCT d.batter_id) FROM innings i JOIN deliveries d ON d.result_id = i.result_id
        WHERE i.fixture_id = f.fixture_id AND i.innings_order = 1) AS inn1_batters
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})
  `).all(...yearParams, ...teamParams, ...accessParams);

  function isWhcc(name) {
    const l = (name || '').toLowerCase();
    return l.includes('woking') || l.includes('horsell') || l.includes('whirlwind') || l.includes('hurricane') || l.includes('whcc');
  }
  function netScore(score, wickets, ss) { return score - (ss ?? 200) - (wickets ?? 0) * 5; }

  let won = 0, lost = 0, tied = 0, nrd = 0;
  for (const f of fixtures) {
    const hs = Number(f.home_score), as = Number(f.away_score);
    if (!f.home_score || !f.away_score || isNaN(hs) || isNaN(as)) { nrd++; continue; }
    const isWhccHome = isWhcc(f.home_team);
    let whccScore = isWhccHome ? hs : as;
    let oppScore  = isWhccHome ? as : hs;
    if (f.format === 'pairs') {
      const ss = Number(f.starting_score) || 200;
      const ww = Number(isWhccHome ? f.home_wickets : f.away_wickets) || 0;
      const ow = Number(isWhccHome ? f.away_wickets : f.home_wickets) || 0;
      whccScore = netScore(whccScore, ww, ss);
      oppScore  = netScore(oppScore,  ow, ss);
    }
    if (whccScore > oppScore) won++;
    else if (whccScore < oppScore) lost++;
    else tied++;
  }

  // Batting aggregates (WHCC batters identified by team name)
  const batRow = db.prepare(`
    SELECT SUM(runs) AS total_runs, SUM(outs) AS total_outs, SUM(balls) AS total_balls
    FROM (
      SELECT SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS outs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND (lower(pb.team) LIKE '%woking%' OR lower(pb.team) LIKE '%horsell%'
             OR lower(pb.team) LIKE '%whirlwind%' OR lower(pb.team) LIKE '%hurricane%')
      GROUP BY d.batter_id, d.result_id
      UNION ALL
      SELECT mb.runs, CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END, mb.balls
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
    )
  `).get(...yearParams, ...teamParams, ...accessParams, ...yearParams, ...teamParams, ...accessParams);

  // Bowling aggregates (WHCC bowlers identified by team name)
  const bowlRow = db.prepare(`
    SELECT SUM(wickets) AS total_wickets, SUM(legal_balls) AS total_balls, SUM(runs) AS total_runs
    FROM (
      SELECT COUNT(d.dismissed_batter_id) AS wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      WHERE i.fixture_id IN (${rfSub})
        AND (lower(pb.team) LIKE '%woking%' OR lower(pb.team) LIKE '%horsell%'
             OR lower(pb.team) LIKE '%whirlwind%' OR lower(pb.team) LIKE '%hurricane%')
      GROUP BY d.bowler_id, d.result_id
      UNION ALL
      SELECT mbw.wickets, mbw.balls, mbw.runs
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
    )
  `).get(...yearParams, ...teamParams, ...accessParams, ...yearParams, ...teamParams, ...accessParams);

  // Top batters (top 3 with runs + average)
  const topBatterRows = db.prepare(`
    SELECT p.player_id, p.name,
      SUM(t.total_runs) AS total_runs,
      SUM(t.total_outs) AS total_outs
    FROM (
      SELECT d.batter_id AS player_id, SUM(d.runs_bat) AS total_runs,
        SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS total_outs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND (lower(pb.team) LIKE '%woking%' OR lower(pb.team) LIKE '%horsell%'
             OR lower(pb.team) LIKE '%whirlwind%' OR lower(pb.team) LIKE '%hurricane%')
      GROUP BY d.batter_id
      UNION ALL
      SELECT mb.player_id, SUM(mb.runs),
        SUM(CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END)
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
      GROUP BY mb.player_id
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.total_runs) DESC LIMIT 3
  `).all(...yearParams, ...teamParams, ...accessParams, ...yearParams, ...teamParams, ...accessParams);

  // Top wicket-takers (top 3 with wickets + economy)
  const topBowlerRows = db.prepare(`
    SELECT p.player_id, p.name,
      SUM(t.total_wickets) AS total_wickets,
      SUM(t.total_balls) AS total_balls,
      SUM(t.total_runs) AS total_runs
    FROM (
      SELECT d.bowler_id AS player_id,
        COUNT(d.dismissed_batter_id) AS total_wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS total_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS total_runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      WHERE i.fixture_id IN (${rfSub})
        AND (lower(pb.team) LIKE '%woking%' OR lower(pb.team) LIKE '%horsell%'
             OR lower(pb.team) LIKE '%whirlwind%' OR lower(pb.team) LIKE '%hurricane%')
      GROUP BY d.bowler_id
      UNION ALL
      SELECT mbw.player_id, SUM(mbw.wickets), SUM(mbw.balls), SUM(mbw.runs)
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
      GROUP BY mbw.player_id
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.total_wickets) DESC LIMIT 3
  `).all(...yearParams, ...teamParams, ...accessParams, ...yearParams, ...teamParams, ...accessParams);

  // Match scores for form chart
  const matchScoreFixtures = db.prepare(`
    SELECT f.fixture_id, f.match_date_iso, f.home_team, f.away_team,
      f.home_score, f.away_score, f.home_wickets, f.away_wickets,
      f.format, f.starting_score
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})
    AND f.match_date_iso IS NOT NULL
    ORDER BY f.match_date_iso ASC
  `).all(...yearParams, ...teamParams, ...accessParams);

  const years = db.prepare(`
    SELECT DISTINCT substr(f.match_date_iso, 1, 4) AS year FROM fixtures f
    WHERE ${whccWhere} AND f.match_date_iso IS NOT NULL
    ORDER BY year DESC
  `).all().map(r => r.year);

  const totalRuns = batRow?.total_runs || 0;
  const totalOuts = batRow?.total_outs || 0;
  const totalBatBalls = batRow?.total_balls || 0;
  const totalWkts = bowlRow?.total_wickets || 0;
  const totalBowlBalls = bowlRow?.total_balls || 0;
  const totalBowlRuns = bowlRow?.total_runs || 0;

  res.json({
    record: { played: fixtures.length, won, lost, tied, nrd },
    batting: {
      total_runs: totalRuns,
      bat_avg: totalOuts > 0 ? (totalRuns / totalOuts).toFixed(2) : null,
      run_rate: totalBatBalls > 0 ? ((totalRuns / totalBatBalls) * 6).toFixed(2) : null,
    },
    bowling: {
      total_wickets: totalWkts,
      bowl_avg: totalWkts > 0 ? (totalBowlRuns / totalWkts).toFixed(2) : null,
      economy: totalBowlBalls > 0 ? ((totalBowlRuns / totalBowlBalls) * 6).toFixed(2) : null,
    },
    top_batters: topBatterRows.map(r => ({
      player_id: r.player_id,
      name: r.name,
      runs: r.total_runs,
      average: r.total_outs > 0 ? (r.total_runs / r.total_outs).toFixed(1) : null,
    })),
    top_bowlers: topBowlerRows.map(r => ({
      player_id: r.player_id,
      name: r.name,
      wickets: r.total_wickets,
      economy: r.total_balls > 0 ? ((r.total_runs / r.total_balls) * 6).toFixed(1) : null,
    })),
    match_scores: matchScoreFixtures.map(f => {
      const isWhccHome = isWhcc(f.home_team);
      const hs = Number(f.home_score);
      const as = Number(f.away_score);
      const hw = Number(f.home_wickets);
      const aw = Number(f.away_wickets);
      const ss = Number(f.starting_score) || 200;
      let whccScore = isWhccHome ? hs : as;
      let oppScore  = isWhccHome ? as : hs;
      let result = 'nr';
      if (f.home_score && f.away_score && !isNaN(hs) && !isNaN(as)) {
        if (f.format === 'pairs') {
          const ww = isWhccHome ? hw : aw;
          const ow = isWhccHome ? aw : hw;
          whccScore = hs + as - (ss * 2);
          const wNet = (isWhccHome ? hs : as) - ss - (isWhccHome ? hw : aw) * 5;
          const oNet = (isWhccHome ? as : hs) - ss - (isWhccHome ? aw : hw) * 5;
          if (wNet > oNet) result = 'won';
          else if (wNet < oNet) result = 'lost';
          else result = 'tied';
          whccScore = isWhccHome ? hs : as;
        } else {
          if (whccScore > oppScore) result = 'won';
          else if (whccScore < oppScore) result = 'lost';
          else result = 'tied';
        }
      }
      return {
        fixture_id: f.fixture_id,
        date: f.match_date_iso,
        whcc_score: isWhccHome ? f.home_score : f.away_score,
        whcc_wickets: isWhccHome ? f.home_wickets : f.away_wickets,
        opp_score: isWhccHome ? f.away_score : f.home_score,
        opp_team: isWhccHome ? f.away_team : f.home_team,
        result,
      };
    }),
    years,
  });
});

// GET /api/matches/:fixtureId
router.get('/:fixtureId', (req, res) => {
  const db = getDb();
  const fixtureId = req.params.fixtureId;

  const af = buildAccessFilter(req, 'f.home_team', 'f.away_team', "substr(f.match_date_iso,1,4)");
  const fixture = db.prepare(`
    SELECT f.*,
      (SELECT MAX(i.ingested_at) FROM ingests i WHERE i.fixture_id = f.fixture_id) AS last_ingested_at,
      (SELECT i.clerk_user_name FROM ingests i WHERE i.fixture_id = f.fixture_id ORDER BY i.ingested_at DESC LIMIT 1) AS last_ingested_by
    FROM fixtures f WHERE f.fixture_id = ?${af ? ` AND (${af.sql})` : ''}
  `).get(fixtureId, ...(af?.params ?? []));
  if (!fixture) return res.status(404).json({ error: 'Match not found' });

  const inningsList = db.prepare(`
    SELECT * FROM innings WHERE fixture_id = ? ORDER BY innings_order
  `).all(fixtureId);

  const hasDeliveries = inningsList.some(inn =>
    db.prepare(`SELECT 1 FROM deliveries WHERE result_id = ? LIMIT 1`).get(inn.result_id)
  );
  const hasManual = db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
                    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId);

  const scorecards = (!hasDeliveries && hasManual)
    ? buildManualScorecard(db, fixtureId, fixture.format, fixture.starting_score)
    : inningsList.map(inn => {
        // Use first batter's stored team to decide who's batting — more reliable than
        // fixture home/away since toss determines order, and "Hurricanes"/"Whirlwinds"
        // are used by other clubs so we can't trust fixture team names alone.
        const firstBatterTeam = db.prepare(`
          SELECT p.team FROM deliveries d
          JOIN players p ON p.player_id = d.batter_id
          WHERE d.result_id = ? AND p.team IS NOT NULL LIMIT 1
        `).get(inn.result_id)?.team ?? '';
        const whccBatting = isWhccTeam(firstBatterTeam);
        return buildScorecard(db, fixtureId, inn.result_id, inn.innings_order, fixture.format, fixture.starting_score, whccBatting, fixture.max_overs || DEFAULT_OVERS);
      });

  const whccNames = db.prepare(`
    SELECT COALESCE(display_name, name) AS name FROM players
    WHERE lower(team) LIKE '%woking%' OR lower(team) LIKE '%horsell%'
       OR lower(team) LIKE '%whirlwind%' OR lower(team) LIKE '%whcc%'
  `).all().map(r => r.name);

  const fixtureMaxOvers = fixture.max_overs || DEFAULT_OVERS;
  const isManualMatch = scorecards.some(sc => sc.isManual);
  let mvp, mvpMeta;
  if (isManualMatch) {
    const cachedMvp = db.prepare('SELECT players_json FROM mvp_cache WHERE fixture_id = ?').get(fixtureId);
    if (cachedMvp) {
      mvp = JSON.parse(cachedMvp.players_json);
    } else {
      mvp = buildManualMvp(db, fixtureId);
      if (mvp.length) {
        db.prepare('INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)')
          .run(fixtureId, JSON.stringify(mvp), JSON.stringify(null), Date.now());
      }
    }
    mvpMeta = null;
  } else if (!hasDeliveries) {
    mvp = [];
    mvpMeta = null;
  } else {
    const cached = db.prepare('SELECT players_json, meta_json FROM mvp_cache WHERE fixture_id = ?').get(fixtureId);
    if (cached) {
      mvp = JSON.parse(cached.players_json);
      mvpMeta = JSON.parse(cached.meta_json);
    } else {
      const mvpResult = buildMvp(db, fixtureId, scorecards, fixtureMaxOvers);
      mvp = mvpResult?.players ?? [];
      mvpMeta = mvpResult?.meta ?? null;
      if (mvpResult) {
        db.prepare('INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)')
          .run(fixtureId, JSON.stringify(mvp), JSON.stringify(mvpMeta), Date.now());
      }
    }
  }
  let phases = [];

  // Attach spell breakdowns to bowler rows (ingested matches only)
  if (hasDeliveries) {
    const allSpells = getSpells(db, fixtureId);
    for (const sc of scorecards) {
      if (sc.isManual) continue;
      for (const b of sc.bowling) {
        b.spells = allSpells.filter(s => s.innings_order === sc.inningsOrder && s.bowler_id === b.player_id);
      }
    }
  }

  if (hasDeliveries) {
    const detailCache = db.prepare('SELECT partnerships_json, phases_json FROM match_detail_cache WHERE fixture_id = ?').get(fixtureId);
    if (detailCache) {
      partnerships = JSON.parse(detailCache.partnerships_json);
      phases       = JSON.parse(detailCache.phases_json);
    } else {
      partnerships = getPartnerships(db, fixtureId);
      phases       = getPhaseStats(db, fixtureId, fixtureMaxOvers);
      db.prepare('INSERT OR REPLACE INTO match_detail_cache (fixture_id, partnerships_json, phases_json, computed_at) VALUES (?, ?, ?, ?)')
        .run(fixtureId, JSON.stringify(partnerships), JSON.stringify(phases), Date.now());
    }
  }

  // Collect all players seen in this match (for delivery editor dropdowns)
  const matchPlayers = (() => {
    const seen = new Map();
    for (const sc of scorecards) {
      for (const b of sc.batting  || []) if (b.player_id && b.player_id > 0) seen.set(b.player_id, b.name);
      for (const b of sc.bowling  || []) if (b.player_id && b.player_id > 0) seen.set(b.player_id, b.name);
    }
    return [...seen.entries()].map(([player_id, name]) => ({ player_id, name })).sort((a, b) => a.name.localeCompare(b.name));
  })();

  res.json({ fixture, scorecards, whccNames, mvp, mvpMeta, partnerships, phases, matchPlayers });
});

function getPartnerships(db, fixtureId) {
  const rows = db.prepare(`
    SELECT d.result_id, i.innings_order, d.over_no, d.ball_no,
           d.batter_id, d.batter_id_ns, d.runs_bat, d.runs_extra,
           d.extras_type, d.dismissed_batter_id
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
    ORDER BY i.innings_order, d.over_no, d.ball_no
  `).all(fixtureId);

  if (!rows.length) return [];

  const playerIds = new Set();
  for (const r of rows) {
    if (r.batter_id)    playerIds.add(r.batter_id);
    if (r.batter_id_ns) playerIds.add(r.batter_id_ns);
  }
  const nameMap = {};
  if (playerIds.size) {
    const ph = [...playerIds].map(() => '?').join(',');
    for (const r of db.prepare(`SELECT player_id, name FROM players_dn WHERE player_id IN (${ph})`).all(...playerIds)) {
      nameMap[r.player_id] = r.name;
    }
  }

  const partnerships = [];
  let current = null;
  const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join(':');

  for (const d of rows) {
    const a = d.batter_id, b = d.batter_id_ns;
    if (!a || !b || a === b) continue; // skip if ns missing or same player as striker (bad data)
    const key = pairKey(a, b);

    if (!current || current.key !== key || current.innings_order !== d.innings_order) {
      current = {
        key, innings_order: d.innings_order,
        batter1_id: Math.min(a, b), batter2_id: Math.max(a, b),
        runs: 0, balls: 0,
        batter1_runs: 0, batter1_balls: 0,
        batter2_runs: 0, batter2_balls: 0,
        dismissed_batter_id: null,
      };
      partnerships.push(current);
    }

    const isLegal = d.extras_type !== 1 && d.extras_type !== 2;
    current.runs += d.runs_bat + (d.runs_extra || 0);
    if (isLegal) current.balls += 1;

    if (d.batter_id === current.batter1_id) {
      current.batter1_runs += d.runs_bat;
      if (isLegal) current.batter1_balls += 1;
    } else {
      current.batter2_runs += d.runs_bat;
      if (isLegal) current.batter2_balls += 1;
    }

    if (d.dismissed_batter_id) current.dismissed_batter_id = d.dismissed_batter_id;
  }

  return partnerships.map(p => ({
    innings_order: p.innings_order,
    batter1_id: p.batter1_id, batter2_id: p.batter2_id,
    batter1_name: nameMap[p.batter1_id] || `#${p.batter1_id}`,
    batter2_name: nameMap[p.batter2_id] || `#${p.batter2_id}`,
    batter1_runs: p.batter1_runs, batter1_balls: p.batter1_balls,
    batter2_runs: p.batter2_runs, batter2_balls: p.batter2_balls,
    runs: p.runs, balls: p.balls,
    dismissed_batter_id: p.dismissed_batter_id,
  }));
}

function ballsToOvers(balls) {
  if (!balls) return '0';
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function getPhaseStats(db, fixtureId, maxOvers) {
  // Phase boundaries (1-based over numbers, inclusive) — format-aware
  const { phaseBoundaries: phases } = getFormatConfig(maxOvers);

  // over_no is 0-based in the DB; convert: over_no + 1 = over display number
  const rows = db.prepare(`
    SELECT
      i.innings_order,
      d.over_no,
      SUM(d.runs_bat) AS runs_bat,
      SUM(CASE WHEN d.extras_type IN (3,4) THEN d.runs_extra ELSE 0 END) AS byes_legbyes,
      SUM(CASE WHEN d.extras_type IN (1,2) THEN d.runs_extra ELSE 0 END) AS wides_noballs,
      COUNT(d.dismissed_batter_id) AS wickets,
      COUNT(CASE WHEN d.extras_type IS NULL OR d.extras_type NOT IN (1,2) THEN 1 END) AS legal_balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
    GROUP BY i.innings_order, d.over_no
    ORDER BY i.innings_order, d.over_no
  `).all(fixtureId);

  if (!rows.length) return [];

  // Group rows by innings_order
  const byInnings = {};
  for (const row of rows) {
    if (!byInnings[row.innings_order]) byInnings[row.innings_order] = [];
    byInnings[row.innings_order].push(row);
  }

  const result = [];
  for (const [inningsOrder, overs] of Object.entries(byInnings)) {
    const phaseStats = [];
    for (const { phase, from, to } of phases) {
      // over_no is 0-based; display over = over_no + 1
      const phaseOvers = overs.filter(r => {
        const dispOver = r.over_no + 1;
        return dispOver >= from && dispOver <= to;
      });
      if (!phaseOvers.length) continue;

      const runs    = phaseOvers.reduce((s, r) => s + r.runs_bat + r.byes_legbyes, 0);
      const wickets = phaseOvers.reduce((s, r) => s + r.wickets, 0);
      const balls   = phaseOvers.reduce((s, r) => s + r.legal_balls, 0);
      const run_rate = balls > 0 ? ((runs / balls) * 6).toFixed(2) : '0.00';
      const actualFrom = Math.min(...phaseOvers.map(r => r.over_no + 1));
      const actualTo   = Math.max(...phaseOvers.map(r => r.over_no + 1));
      phaseStats.push({ phase, from: actualFrom, to: actualTo, runs, wickets, balls, run_rate });
    }
    if (phaseStats.length) result.push({ innings_order: Number(inningsOrder), phases: phaseStats });
  }
  return result;
}

function getSpells(db, fixtureId) {
  const overs = db.prepare(`
    SELECT i.innings_order, d.over_no, d.bowler_id,
      SUM(CASE WHEN d.extras_type IS NULL OR d.extras_type NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
      SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) AS wide_count,
      SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) AS nb_count,
      SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
      COUNT(d.dismissed_batter_id) AS wickets,
      MAX(CASE WHEN d.extras_type IN (1,2) THEN 1 WHEN d.runs_bat > 0 THEN 1 ELSE 0 END) AS had_run
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
    GROUP BY i.innings_order, d.over_no, d.bowler_id
    ORDER BY i.innings_order, d.over_no
  `).all(fixtureId)

  // active: map of `${innings_order}:${bowler_id}` → the spell currently being built for that bowler
  // spells: finished spells (bowler was rested for >2 overs before returning, or innings ended)
  const active = {}
  const spells = []
  for (const over of overs) {
    const key = `${over.innings_order}:${over.bowler_id}`
    const cur = active[key]
    if (cur && over.over_no - cur.to_over <= 2) {
      cur.to_over   = over.over_no
      cur.balls    += over.legal_balls
      cur.wides    += over.wide_count
      cur.noBalls  += over.nb_count
      cur.runs     += over.runs
      cur.wickets  += over.wickets
      if (over.had_run === 0) cur.maidens++
    } else {
      if (cur) spells.push(cur)
      active[key] = { innings_order: over.innings_order, bowler_id: over.bowler_id, from_over: over.over_no, to_over: over.over_no, balls: over.legal_balls, wides: over.wide_count, noBalls: over.nb_count, runs: over.runs, wickets: over.wickets, maidens: over.had_run === 0 ? 1 : 0 }
    }
  }
  for (const spell of Object.values(active)) spells.push(spell)
  return spells
}

function buildManualScorecard(db, fixtureId, format, startingScore) {
  const isPairs = format === 'pairs';
  if (isPairs && !startingScore) startingScore = 200;
  const extras      = db.prepare(`SELECT batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs FROM manual_extras WHERE fixture_id = ?`).get(fixtureId);
  const batting_extras  = extras?.batting_extras  ?? 0;
  const bowling_byes    = extras?.bowling_byes    ?? 0;
  const bowling_leg_byes = extras?.bowling_leg_byes ?? 0;
  const whcc_overs_stored = extras?.whcc_overs ?? null;
  const opp_overs_stored  = extras?.opp_overs  ?? null;

  // ── WHCC batting innings ──────────────────────────────────────────────────
  const batRows = db.prepare(`
    SELECT mb.*, p.name FROM manual_batting mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.innings_order = 1 ORDER BY mb.id
  `).all(fixtureId);

  const batting = batRows.map(b => {
    const parsed = !b.not_out && !b.did_not_bat ? parseHowOut(b.how_out) : null
    const row = {
      player_id: b.player_id, name: b.name,
      runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes,
      dismissed: !b.not_out && !b.did_not_bat,
      dismissalDesc: b.did_not_bat ? 'did not bat' : (b.not_out ? 'not out' : (b.how_out || 'out')),
      dismissalType: parsed?.type || null,
      timesOut: (!b.not_out && !b.did_not_bat) ? 1 : 0,
      did_not_bat: !!b.did_not_bat,
    }
    if (parsed) { row.dismissalFielder = parsed.fielder ?? null; row.dismissalBowler = parsed.bowler ?? null }
    return row
  });

  const played    = batRows.filter(b => !b.did_not_bat);
  const batRuns   = played.reduce((s, b) => s + b.runs, 0);
  const batBalls  = played.reduce((s, b) => s + b.balls, 0);
  const batWkts   = played.filter(b => !b.not_out).length;
  const whccTotal = batRuns + batting_extras;
  const whcc_overs = whcc_overs_stored || (batBalls > 0 ? ballsToOvers(batBalls) : null);

  const whccSc = {
    inningsOrder: 1, isPairs, isManual: true,
    batting, bowling: [], overs: [],
    dismissalMethods: {}, catches: {},
    totals: {
      runs: whccTotal, wickets: batWkts, overs: whcc_overs,
      extras: { total: batting_extras },
      netTotal: isPairs ? whccTotal + (startingScore || 0) - batWkts * 5 : null,
    },
  };

  // ── Opposition batting (derived from WHCC bowling figures) ────────────────
  const bowlRows = db.prepare(`
    SELECT mbw.*, p.name FROM manual_bowling mbw
    JOIN players_dn p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ? AND mbw.innings_order = 2 ORDER BY mbw.id
  `).all(fixtureId);

  const bowling = bowlRows.map(b => ({
    player_id: b.player_id, name: b.name,
    balls: b.balls, overs: ballsToOvers(b.balls),
    runs: b.runs, wickets: b.wickets,
    wides: b.wides, noBalls: b.no_balls, maidens: b.maidens,
    economy: b.balls > 0 ? ((b.runs / b.balls) * 6).toFixed(2) : null,
  }));

  const oppRuns   = bowlRows.reduce((s, b) => s + b.runs, 0) + bowling_byes + bowling_leg_byes;
  const oppWkts   = bowlRows.reduce((s, b) => s + b.wickets, 0);
  const bowlBalls = bowlRows.reduce((s, b) => s + b.balls, 0);
  const opp_overs = opp_overs_stored || (bowlBalls > 0 ? ballsToOvers(bowlBalls) : null);

  const fieldRows = db.prepare(`
    SELECT mf.catches, mf.stumpings, mf.run_outs, p.name FROM manual_fielding mf
    JOIN players_dn p ON p.player_id = mf.player_id
    WHERE mf.fixture_id = ? AND mf.innings_order = 2 ORDER BY mf.id
  `).all(fixtureId);

  const oppSc = {
    inningsOrder: 2, isPairs, isManual: true,
    batting: [], bowling, overs: [],
    fielding: fieldRows,
    dismissalMethods: {}, catches: {},
    totals: {
      runs: oppRuns, wickets: oppWkts, overs: opp_overs,
      extras: (bowling_byes || bowling_leg_byes) ? { byes: bowling_byes, legByes: bowling_leg_byes, wides: 0, noBalls: 0 } : null,
      netTotal: isPairs ? oppRuns + (startingScore || 0) - oppWkts * 5 : null,
    },
  };

  return [whccSc, oppSc];
}

function buildScorecard(db, fixtureId, resultId, inningsOrder, format, startingScore, isWhccBatting = false, maxOvers = DEFAULT_OVERS) {
  const isPairs = format === 'pairs';
  const deliveries = db.prepare(`
    SELECT d.*, p_bat.name as batter_name, p_bow.name as bowler_name
    FROM deliveries d
    LEFT JOIN players_dn p_bat ON p_bat.player_id = d.batter_id
    LEFT JOIN players_dn p_bow ON p_bow.player_id = d.bowler_id
    WHERE d.result_id = ?
    ORDER BY d.over_no, d.ball_no_disp
  `).all(resultId);

  if (!deliveries.length) return { inningsOrder, isPairs, batting: [], bowling: [], overs: [], totals: {} };

  // WK assignments for this innings (keeper swaps)
  const wkAssignments = db.prepare(`
    SELECT wa.from_over, wa.to_over, p.name AS keeper_name
    FROM wk_assignments wa
    JOIN players_dn p ON p.player_id = wa.player_id
    WHERE wa.fixture_id = ? AND wa.innings_order = ?
    ORDER BY wa.from_over
  `).all(fixtureId, inningsOrder);

  // Dismissal map for match flow: batter_id → { method, fielder }
  const dismissalMap = {};
  for (const r of db.prepare(`
    SELECT dis.batter_id, dis.method, dis.fielder_id, dis.bowler_id, pf.name AS fielder_name
    FROM dismissals dis
    LEFT JOIN players_dn pf ON pf.player_id = dis.fielder_id
    WHERE dis.fixture_id = ? AND dis.innings_order = ?
  `).all(fixtureId, inningsOrder)) {
    if (!dismissalMap[r.batter_id]) dismissalMap[r.batter_id] = [];
    dismissalMap[r.batter_id].push({ method: r.method, fielder: r.fielder_name, fielder_id: r.fielder_id, bowler_id: r.bowler_id });
  }
  // Fallback for dismissals where the HTML batter name didn't resolve to a player_id.
  // These land in dismissalMap[null]; index by bowler so we can still surface the method.
  const nullBatterByBowler = {};
  for (const di of (dismissalMap[null] || [])) {
    if (di.bowler_id && !nullBatterByBowler[di.bowler_id]) nullBatterByBowler[di.bowler_id] = di;
  }

  // Pre-compute over list (needed by both bowler overs and totals sections)
  const overNos = [...new Set(deliveries.map(d => d.over_no))].sort((a, b) => a - b);

  // ---- Batting ----
  // Use array + index map to preserve chronological batting order.
  // Plain objects with numeric keys iterate in ascending key order, not insertion order.
  const batters = [];
  const batterIdx = {};
  for (const d of deliveries) {
    const id = d.batter_id;
    if (batterIdx[id] === undefined) {
      batterIdx[id] = batters.length;
      batters.push({
        player_id: id, name: d.batter_name || (id < 0 ? nameFromDesc(d.l_desc, 'batter') : null) || `#${Math.abs(id)}`,
        runs: 0, balls: 0, fours: 0, sixes: 0,
        _dotBalls: 0, _facedBalls: 0,
        dismissed: false, dismissalDesc: null, dismissalType: null, timesOut: 0
      });
    }
    const b = batters[batterIdx[id]];
    b.runs  += d.runs_bat;
    b.balls += 1;
    if (d.runs_bat === 4) b.fours++;
    if (d.runs_bat === 6) b.sixes++;
    // Dot ball for batting: legal delivery (not wide/no-ball) where total runs = 0
    const isLegal = d.extras_type === null || (d.extras_type !== 1 && d.extras_type !== 2);
    if (isLegal) {
      b._facedBalls++;
      if (d.runs_bat === 0 && (!d.runs_extra || d.runs_extra === 0)) b._dotBalls++;
    }
    if (d.dismissed_batter_id === id) {
      if (isPairs) {
        b.timesOut++;
      } else {
        b.dismissed = true;
        b.dismissalDesc = d.l_desc?.trim() || 'out';
        b.dismissalType = classifyDismissal(d.l_desc, d.s_desc);
      }
    }
  }

  if (isPairs) {
    for (const b of batters) {
      b.netScore = b.runs - b.timesOut * 5;
    }
  }

  // Override dismissal info from PDF-sourced dismissals table (more reliable than ball descriptions)
  const pdfDismissals = db.prepare(`
    SELECT dis.batter_id, dis.method, pf.name as fielder_name, dis.fielder_id, pb.name as bowler_name, dis.bowler_id
    FROM dismissals dis
    LEFT JOIN players_dn pf ON pf.player_id = dis.fielder_id
    LEFT JOIN players_dn pb ON pb.player_id = dis.bowler_id
    JOIN innings i ON i.fixture_id = dis.fixture_id AND i.innings_order = dis.innings_order
    WHERE i.result_id = ?
  `).all(resultId);
  for (const pd of pdfDismissals) {
    if (!pd.batter_id || batterIdx[pd.batter_id] === undefined) continue;
    const b = batters[batterIdx[pd.batter_id]];
    b.dismissed        = true;
    b.dismissalType    = pd.method;
    b.dismissalDesc    = formatDismissal(pd.method, pd.fielder_name, pd.bowler_name);
    b.dismissalFielder   = pd.fielder_name ?? null;
    b.dismissalFielderId = pd.fielder_id   ?? null;
    b.dismissalBowler    = pd.bowler_name  ?? null;
    b.dismissalBowlerId  = pd.bowler_id    ?? null;
  }

  // Apply display_name overrides to any remaining l_desc fallback strings
  const nameOverrides = db.prepare(`SELECT name, display_name FROM players WHERE display_name IS NOT NULL`).all();
  if (nameOverrides.length) {
    for (const b of batters) {
      if (b.dismissalFielder === undefined && b.dismissalDesc && b.dismissalDesc !== 'out') {
        for (const { name, display_name } of nameOverrides) {
          b.dismissalDesc = b.dismissalDesc.replaceAll(name, display_name);
        }
      }
    }
  }

  // Compute dot_pct for batters and remove private counters
  for (const b of batters) {
    b.dot_pct = b._facedBalls > 0 ? Math.round(10 * (b._dotBalls / b._facedBalls) * 100) / 10 : null;
    delete b._dotBalls;
    delete b._facedBalls;
  }

  // ---- Bowling ----
  // Use array + index map to preserve chronological bowling order (same reason as batters).
  const bowlers = [];
  const bowlerIdx = {};
  for (const d of deliveries) {
    const id = d.bowler_id;
    if (bowlerIdx[id] === undefined) {
      bowlerIdx[id] = bowlers.length;
      bowlers.push({
        player_id: id, name: d.bowler_name || (id < 0 ? nameFromDesc(d.l_desc, 'bowler') : null) || `#${Math.abs(id)}`,
        balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, maidens: 0,
        _dotBalls: 0, _legalBalls: 0
      });
    }
    const b = bowlers[bowlerIdx[id]];
    const isExtra = d.extras_type === 1 || d.extras_type === 2;
    if (!isExtra) {
      b.balls++;
      b._legalBalls++;
      // Dot ball for bowling: legal delivery, batter scored 0, no extras of any kind
      if (d.runs_bat === 0 && d.extras_type === null && (!d.runs_extra || d.runs_extra === 0)) b._dotBalls++;
    }
    b.runs += d.runs_bat + (d.extras_type === 3 || d.extras_type === 4 ? 0 : d.runs_extra);
    if (d.dismissed_batter_id) b.wickets++;
    if (d.extras_type === 2) b.wides += d.runs_extra;
    if (d.extras_type === 1) b.noBalls += d.runs_extra;
  }

  // Maiden overs: group by over+bowler, maiden if 0 runs conceded
  const overGroups = {};
  for (const d of deliveries) {
    const key = `${d.over_no}:${d.bowler_id}`;
    if (!overGroups[key]) overGroups[key] = { bowler_id: d.bowler_id, runs: 0 };
    overGroups[key].runs += d.runs_bat + (d.extras_type === 3 || d.extras_type === 4 ? 0 : d.runs_extra);
  }
  for (const g of Object.values(overGroups)) {
    if (g.runs === 0 && bowlerIdx[g.bowler_id] !== undefined) bowlers[bowlerIdx[g.bowler_id]].maidens++;
  }
  // Bowler overs: count distinct over_no values (API often has missing balls in middle overs)
  // Only the last over of the innings might be genuinely incomplete
  const inningsLastOver = overNos.length ? overNos[overNos.length - 1] : -1;
  for (const b of bowlers) {
    const bOvers = [...new Set(deliveries.filter(d => d.bowler_id === b.player_id).map(d => d.over_no))].sort((a, x) => a - x);
    if (!bOvers.length) { b.overs = '0'; b.economy = null; continue; }
    const bLast = bOvers[bOvers.length - 1];
    const lastBalls = bLast === inningsLastOver
      ? deliveries.filter(d => d.bowler_id === b.player_id && d.over_no === bLast && d.extras_type !== 1 && d.extras_type !== 2).length
      : 6;
    const complete = bOvers.length - (lastBalls < 6 ? 1 : 0);
    b.overs = lastBalls < 6 ? `${complete}.${lastBalls}` : String(complete);
    const effOvers = complete + (lastBalls < 6 ? lastBalls / 6 : 0);
    b.economy = effOvers > 0 ? (b.runs / effOvers).toFixed(2) : null;
  }

  // Compute dot_pct for bowlers and remove private counters
  for (const b of bowlers) {
    b.dot_pct = b._legalBalls > 0 ? Math.round(10 * (b._dotBalls / b._legalBalls) * 100) / 10 : null;
    delete b._dotBalls;
    delete b._legalBalls;
  }

  // ---- Dismissal method stats — built from batters (already PDF-corrected above) ----
  const dismissalMethods = {};
  for (const b of batters) {
    if (!b.dismissed) continue;
    const t = b.dismissalType || 'out';
    dismissalMethods[t] = (dismissalMethods[t] || 0) + 1;
  }

  // ---- Catches ----
  const catches = {};  // player_id -> count
  for (const d of deliveries) {
    if (!d.dismissed_batter_id) continue;
    const catcher = parseCatcher(d.l_desc);
    if (catcher) catches[catcher] = (catches[catcher] || 0) + 1;
  }

  // ---- Over-by-over ----
  const overs = overNos.map(ov => {
    const balls = deliveries.filter(d => d.over_no === ov).sort((a,b)=>a.ball_no_disp-b.ball_no_disp);
    const runs  = balls.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0);
    const wkts  = balls.filter(d => d.dismissed_batter_id).length;
    return {
      over: ov + 1,
      runs,
      wickets: wkts,
      bowler: balls[0]?.bowler_name || (balls[0]?.bowler_id < 0 ? nameFromDesc(balls[0]?.l_desc, 'bowler') : null) || '?',
      bowler_id: balls[0]?.bowler_id ?? null,
      balls: balls.map(d => {
        const dis = d.dismissed_batter_id
          ? (dismissalMap[d.dismissed_batter_id]?.[0] ?? (d.bowler_id ? nullBatterByBowler[d.bowler_id] : null) ?? null)
          : null;
        return {
          id: d.id,
          s_desc: d.s_desc?.trim() || '.',
          runs_bat: d.runs_bat,
          runs_extra: d.runs_extra,
          extras_type: d.extras_type,
          wicket: !!d.dismissed_batter_id,
          batter_id: d.batter_id,
          batter_id_ns: d.batter_id_ns ?? null,
          batter_name: d.batter_name,
          bowler_id: d.bowler_id,
          bowler_name: d.bowler_name,
          dismissed_batter_id: d.dismissed_batter_id ?? null,
          dismissal_method: dis?.method ?? null,
          dismissal_fielder_id: dis?.fielder_id ?? null,
          dismissal_bowler_id: dis?.bowler_id ?? null,
        };
      })
    };
  });

  // ---- Totals ----
  const totalRuns  = deliveries.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0);
  const totalWkts  = deliveries.filter(d => d.dismissed_batter_id).length;
  const extras = { byes: 0, legByes: 0, wides: 0, noBalls: 0 };
  for (const d of deliveries) {
    if (d.extras_type === 3) extras.byes    += d.runs_extra;
    if (d.extras_type === 4) extras.legByes += d.runs_extra;
    if (d.extras_type === 2) extras.wides   += d.runs_extra;
    if (d.extras_type === 1) extras.noBalls += d.runs_extra;
  }

  // Use MAX(over_no) rather than total legal balls — API data often has missing deliveries in middle overs
  const maxOverNo = overNos.length ? overNos[overNos.length - 1] : -1;
  const ballsInLastOver = maxOverNo >= 0
    ? deliveries.filter(d => d.over_no === maxOverNo && d.extras_type !== 1 && d.extras_type !== 2).length
    : 0;
  const oversStr = maxOverNo < 0 ? '0'
    : ballsInLastOver === 6 ? String(maxOverNo + 1)
    : `${maxOverNo}.${ballsInLastOver}`;

  return {
    inningsOrder,
    resultId,
    isPairs,
    batting: batters,
    bowling: bowlers,
    overs,
    dismissalMethods,
    catches,
    flow: buildMatchFlow(deliveries, isPairs, startingScore, dismissalMap, nullBatterByBowler, wkAssignments, isWhccBatting, maxOvers),
    totals: {
      runs: totalRuns, wickets: totalWkts,
      overs: oversStr,
      extras,
      netTotal: isPairs ? totalRuns + (startingScore || 0) - totalWkts * 5 : null,
    }
  };
}

// Returns format-specific thresholds keyed by max overs per innings.
// Used by buildMatchFlow, getPhaseStats, and MVP computation.
function getFormatConfig(maxOvers) {
  const mo = maxOvers || DEFAULT_OVERS;
  if (mo <= 22) return {
    name: 'T20',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 6  },
      { phase: 'Middle',    from: 7,  to: 15 },
      { phase: 'Death',     from: 16, to: mo },
    ],
    batterMilestones: [15, 20, 25, 30],
    teamMilestones:   [50, 75, 100, 150, 200, 250, 300],
    wicketVal: 1.8, maidensPerWicket: 2, srPct: 0.08,
  };
  if (mo <= 35) return {
    name: '30-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 6  },
      { phase: 'Middle',    from: 7,  to: 24 },
      { phase: 'Death',     from: 25, to: mo },
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.0, maidensPerWicket: 2, srPct: 0.06,
  };
  if (mo <= 45) return {
    name: '40-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 8  },
      { phase: 'Middle',    from: 9,  to: 30 },
      { phase: 'Death',     from: 31, to: mo },
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.2, maidensPerWicket: 3, srPct: 0.05,
  };
  return {
    name: '50-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 10 },
      { phase: 'Middle',    from: 11, to: 40 },
      { phase: 'Death',     from: 41, to: mo },
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.5, maidensPerWicket: 3, srPct: 0.04,
  };
}

function buildMatchFlow(deliveries, isPairs, startingScore, dismissalMap, nullBatterByBowler = {}, wkAssignments = [], isWhccBatting = false, maxOvers = DEFAULT_OVERS) {
  if (!deliveries.length) return [];

  const { teamMilestones, batterMilestones } = getFormatConfig(maxOvers);

  const events = [];
  let teamRuns = 0;
  let dismissals = 0;
  let partnershipStart = 0;
  const batterRuns = {}, batterBalls = {}, batterNames = {};
  const bowlerWickets = {}, reportedBowlerHauls = {};
  const reportedTeamMilestones = new Set();
  const reportedBatterMilestones = {};
  const dismissalUsed = {};  // tracks how many dismissals we've consumed per batter_id

  // Keeper swaps: sorted by from_over; skip from_over=1 (initial keeper, not a swap)
  const keeperSwaps = [...wkAssignments].sort((a, b) => a.from_over - b.from_over).filter(w => w.from_over > 1);
  let keeperIdx = 0;
  let currentOver = -1;

  for (let i = 0; i < deliveries.length; i++) {
    const d = deliveries[i];
    const overDisplay = `${d.over_no}.${d.ball_no_disp ?? d.ball_no}`;

    // Inject keeper_change events at the start of each new over
    if (d.over_no !== currentOver) {
      currentOver = d.over_no;
      while (keeperIdx < keeperSwaps.length && keeperSwaps[keeperIdx].from_over === d.over_no + 1) {
        events.push({ type: 'keeper_change', over: `${d.over_no}.0`, player: keeperSwaps[keeperIdx].keeper_name });
        keeperIdx++;
      }
    }

    teamRuns += d.runs_bat + d.runs_extra;
    if (!batterNames[d.batter_id]) batterNames[d.batter_id] = d.batter_name || `#${Math.abs(d.batter_id)}`;
    batterRuns[d.batter_id] = (batterRuns[d.batter_id] || 0) + d.runs_bat;
    batterBalls[d.batter_id] = (batterBalls[d.batter_id] || 0) + 1;

    // Team milestones — thresholds vary by format
    for (const m of teamMilestones) {
      if (teamRuns >= m && !reportedTeamMilestones.has(m)) {
        reportedTeamMilestones.add(m);
        events.push({ type: 'team_milestone', over: overDisplay, runs: m, wickets: dismissals });
      }
    }

    // Batter milestones — thresholds vary by format (T20: 15/20/25/30; longer: 25/50/75/100)
    const br = batterRuns[d.batter_id];
    const prevM = reportedBatterMilestones[d.batter_id] || 0;
    for (const m of batterMilestones) {
      if (br >= m && prevM < m) {
        reportedBatterMilestones[d.batter_id] = m;
        events.push({ type: 'batter_milestone', over: overDisplay, player: batterNames[d.batter_id], player_id: d.batter_id, runs: m, balls: batterBalls[d.batter_id] });
      }
    }

    // Dismissal / wicket
    if (d.dismissed_batter_id) {
      dismissals++;
      const playerOut = batterNames[d.dismissed_batter_id] || `#${Math.abs(d.dismissed_batter_id)}`;

      // Look up dismissal detail (fielder/method) from pre-loaded map
      const used = dismissalUsed[d.dismissed_batter_id] || 0;
      const disInfo = dismissalMap?.[d.dismissed_batter_id]?.[used]
        ?? (d.bowler_id ? nullBatterByBowler[d.bowler_id] : null)
        ?? null;
      dismissalUsed[d.dismissed_batter_id] = used + 1;

      if (isPairs) {
        events.push({
          type: 'pairs_out', over: overDisplay, wickets: dismissals, score: teamRuns, player: playerOut, player_id: d.dismissed_batter_id,
          bowler: d.bowler_name || null,
          fielder: disInfo?.fielder ?? null,
          dismissalMethod: disInfo?.method ?? null,
        });
      } else {
        const batRuns  = batterRuns[d.dismissed_batter_id] || 0;
        const batBalls = batterBalls[d.batter_id] || 0;
        const partnership = teamRuns - partnershipStart;
        partnershipStart = teamRuns;
        events.push({
          type: 'wicket', over: overDisplay, wickets: dismissals, score: teamRuns,
          player: playerOut, player_id: d.dismissed_batter_id, runs: batRuns, balls: batBalls, partnership,
          bowler: d.bowler_name || null,
          fielder: disInfo?.fielder ?? null,
          dismissalMethod: disInfo?.method ?? null,
        });

        if (!isWhccBatting) {
          bowlerWickets[d.bowler_id] = (bowlerWickets[d.bowler_id] || 0) + 1;
          const bw = bowlerWickets[d.bowler_id];
          if (bw >= 3 && bw > (reportedBowlerHauls[d.bowler_id] || 2)) {
            reportedBowlerHauls[d.bowler_id] = bw;
            events.push({ type: 'bowler_haul', over: overDisplay, player: d.bowler_name || `#${Math.abs(d.bowler_id)}`, player_id: d.bowler_id, wickets: bw });
          }
        }
      }
    }
  }

  // Innings end
  const lastDel = deliveries[deliveries.length - 1];
  const lastLegal = deliveries.filter(d => d.over_no === lastDel.over_no && d.extras_type !== 1 && d.extras_type !== 2).length;
  const oversStr = lastLegal === 6 ? String(lastDel.over_no + 1) : `${lastDel.over_no}.${lastLegal}`;
  events.push({
    type: 'innings_end', score: teamRuns, wickets: dismissals, overs: oversStr,
    ...(isPairs ? { netScore: (startingScore || 0) + teamRuns - dismissals * 5 } : {}),
  });

  return events;
}

function buildManualMvp(db, fixtureId) {
  const bat = db.prepare(`
    SELECT mb.player_id, COALESCE(p.display_name, p.name) AS name,
      mb.runs * 0.1 AS bat_pts
    FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
  `).all(fixtureId);

  const bowl = db.prepare(`
    SELECT mbw.player_id, COALESCE(p.display_name, p.name) AS name,
      mbw.wickets * 1.8
      + CASE WHEN mbw.wickets >= 5 THEN 1.0 WHEN mbw.wickets >= 3 THEN 0.5 ELSE 0.0 END AS bowl_pts
    FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ?
  `).all(fixtureId);

  const scores = {};
  const entry = (pid, name) => { if (!scores[pid]) scores[pid] = { playerId: pid, name, bat: 0, bowl: 0, field: 0 }; return scores[pid]; };
  for (const r of bat)  entry(r.player_id, r.name).bat  += r.bat_pts;
  for (const r of bowl) entry(r.player_id, r.name).bowl += r.bowl_pts;

  return Object.values(scores)
    .map(s => ({ ...s, bat: +s.bat.toFixed(1), bowl: +s.bowl.toFixed(1), total: +(s.bat + s.bowl).toFixed(1) }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
}

function computeManualMvpForFixtures(db, fixtureIds) {
  const ph = fixtureIds.map(() => '?').join(',');

  const bat = db.prepare(`
    SELECT mb.fixture_id, mb.player_id, mb.runs * 0.1 AS pts
    FROM manual_batting mb WHERE mb.fixture_id IN (${ph}) AND mb.did_not_bat = 0
  `).all(...fixtureIds);

  const bowl = db.prepare(`
    SELECT mbw.fixture_id, mbw.player_id,
      mbw.wickets * 1.8
      + CASE WHEN mbw.wickets >= 5 THEN 1.0 WHEN mbw.wickets >= 3 THEN 0.5 ELSE 0.0 END AS pts
    FROM manual_bowling mbw WHERE mbw.fixture_id IN (${ph})
  `).all(...fixtureIds);

  const totals = {};
  for (const row of [...bat, ...bowl]) {
    if (!totals[row.fixture_id]) totals[row.fixture_id] = {};
    totals[row.fixture_id][row.player_id] = (totals[row.fixture_id][row.player_id] || 0) + row.pts;
  }

  const allIds = [...new Set([...bat, ...bowl].map(r => r.player_id))];
  const names = {};
  if (allIds.length) {
    const np = allIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${np})`).all(...allIds))
      names[r.player_id] = r.name;
  }

  const result = {};
  for (const [fid, players] of Object.entries(totals)) {
    const [topId, topPts] = Object.entries(players).sort((a, b) => b[1] - a[1])[0];
    result[fid] = { name: names[topId] || `#${topId}`, pts: +topPts.toFixed(1) };
  }
  return result;
}

function computeMvpForFixtures(db, fixtureIds) {
  const ph = fixtureIds.map(() => '?').join(',');
  const WHCC = `(lower(wp.team) LIKE '%woking%' OR lower(wp.team) LIKE '%horsell%' OR lower(wp.team) LIKE '%whirlwind%' OR lower(wp.team) LIKE '%whcc%')`;

  // CricHeroes formula: T20 params used for list view (WHCC matches are ≤20 overs)
  const WICKET_VAL = 1.8;
  const MAIDENS_PER_WICKET = 2;

  const bat = db.prepare(`
    SELECT i.fixture_id, d.batter_id AS player_id, SUM(d.runs_bat) * 0.1 AS pts
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players wp ON wp.player_id = d.batter_id AND ${WHCC}
    WHERE i.fixture_id IN (${ph})
    GROUP BY i.fixture_id, d.batter_id
  `).all(...fixtureIds);

  const bowl = db.prepare(`
    SELECT i.fixture_id, d.bowler_id AS player_id,
      COUNT(d.dismissed_batter_id) AS wickets
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players wp ON wp.player_id = d.bowler_id AND ${WHCC}
    WHERE i.fixture_id IN (${ph})
    GROUP BY i.fixture_id, d.bowler_id
  `).all(...fixtureIds);

  const maidens = db.prepare(`
    SELECT ov.fixture_id, ov.bowler_id AS player_id, COUNT(*) AS maiden_count
    FROM (
      SELECT i.fixture_id, d.bowler_id, d.over_no,
        SUM(d.runs_bat + d.runs_extra) AS over_runs,
        SUM(CASE WHEN d.extras_type IN (1,2) THEN 1 ELSE 0 END) AS illegal
      FROM deliveries d JOIN innings i ON i.result_id = d.result_id
      WHERE i.fixture_id IN (${ph})
      GROUP BY i.fixture_id, d.result_id, d.bowler_id, d.over_no
    ) ov
    JOIN players wp ON wp.player_id = ov.bowler_id AND ${WHCC}
    WHERE ov.over_runs = 0 AND ov.illegal = 0
    GROUP BY ov.fixture_id, ov.bowler_id
  `).all(...fixtureIds);

  const field = db.prepare(`
    SELECT dis.fixture_id, dis.fielder_id AS player_id, COUNT(*) AS catches
    FROM dismissals dis
    JOIN players wp ON wp.player_id = dis.fielder_id AND ${WHCC}
    WHERE dis.fixture_id IN (${ph}) AND dis.method IN ('Caught','CaughtAndBowled','Stumped')
    GROUP BY dis.fixture_id, dis.fielder_id
  `).all(...fixtureIds);

  const totals = {};
  for (const r of bat) {
    if (!totals[r.fixture_id]) totals[r.fixture_id] = {};
    totals[r.fixture_id][r.player_id] = (totals[r.fixture_id][r.player_id] || 0) + r.pts;
  }
  for (const r of bowl) {
    if (!totals[r.fixture_id]) totals[r.fixture_id] = {};
    let pts = r.wickets * WICKET_VAL;
    if (r.wickets >= 5) pts += 1.0;
    else if (r.wickets >= 3) pts += 0.5;
    totals[r.fixture_id][r.player_id] = (totals[r.fixture_id][r.player_id] || 0) + pts;
  }
  for (const r of maidens) {
    if (!totals[r.fixture_id]) totals[r.fixture_id] = {};
    totals[r.fixture_id][r.player_id] = (totals[r.fixture_id][r.player_id] || 0) + r.maiden_count * (WICKET_VAL / MAIDENS_PER_WICKET);
  }
  for (const r of field) {
    if (!totals[r.fixture_id]) totals[r.fixture_id] = {};
    totals[r.fixture_id][r.player_id] = (totals[r.fixture_id][r.player_id] || 0) + r.catches * (WICKET_VAL * 0.2);
  }

  const allIds = [...new Set([...bat, ...bowl, ...maidens, ...field].map(r => r.player_id))];
  const names = {};
  if (allIds.length) {
    const np = allIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${np})`).all(...allIds))
      names[r.player_id] = r.name;
  }

  const result = {};
  for (const [fid, players] of Object.entries(totals)) {
    const [topId, topPts] = Object.entries(players).sort((a, b) => b[1] - a[1])[0];
    result[fid] = { name: names[topId] || `#${topId}`, pts: +topPts.toFixed(1) };
  }
  return result;
}

function buildMvp(db, fixtureId, scorecards, maxOvers = DEFAULT_OVERS) {
  const whccPlayers = db.prepare(`
    SELECT player_id, COALESCE(display_name, name) AS name FROM players
    WHERE lower(team) LIKE '%woking%' OR lower(team) LIKE '%horsell%'
       OR lower(team) LIKE '%whirlwind%' OR lower(team) LIKE '%whcc%'
  `).all();
  const whccIds = new Set(whccPlayers.map(p => p.player_id));
  const nameMap = Object.fromEntries(whccPlayers.map(p => [p.player_id, p.name]));

  const scores = {};
  const entry = pid => {
    if (!scores[pid]) scores[pid] = {
      playerId: pid, name: nameMap[pid] || `#${pid}`,
      bat: 0, bowl: 0, field: 0,
      _batRuns: 0, _batBalls: 0, _batBase: 0, _batSRBonus: 0,
      _bowlBase: 0, _bowlHaulBonus: 0, _bowlMaidenBonus: 0,
    };
    return scores[pid];
  };

  // Determine match type from fixture.max_overs (falls back to 20 for legacy matches)
  const fmtCfg = getFormatConfig(maxOvers);
  const { wicketVal, maidensPerWicket, srPct } = fmtCfg;

  let whccTeamRuns = 0, whccTeamBalls = 0;

  for (const sc of scorecards) {
    if (sc.isManual) continue;

    const teamRuns  = sc.batting.reduce((s, b) => s + b.runs, 0);
    const teamBalls = sc.batting.reduce((s, b) => s + (b.balls || 0), 0);
    const teamSR    = teamBalls > 0 ? (teamRuns / teamBalls) * 100 : 0;

    // Track WHCC batting innings for the meta team SR
    if (sc.batting.some(b => whccIds.has(b.player_id))) {
      whccTeamRuns  += teamRuns;
      whccTeamBalls += teamBalls;
    }

    for (const b of sc.batting) {
      if (!whccIds.has(b.player_id)) continue;
      const basePts = b.runs * 0.1;
      let srBonus = 0;
      if (teamSR > 0 && b.balls > 0) {
        const playerSR = (b.runs / b.balls) * 100;
        if (playerSR > teamSR) srBonus = basePts * (playerSR / teamSR - 1) * srPct;
      }
      const e = entry(b.player_id);
      e.bat        += basePts + srBonus;
      e._batRuns   += b.runs;
      e._batBalls  += b.balls || 0;
      e._batBase   += basePts;
      e._batSRBonus += srBonus;
    }

    for (const b of sc.bowling) {
      if (!whccIds.has(b.player_id)) continue;
      const bowlBase  = b.wickets * wicketVal;
      const haulBonus = b.wickets >= 5 ? 1.0 : b.wickets >= 3 ? 0.5 : 0;
      const maidenBonus = (b.maidens || 0) * (wicketVal / maidensPerWicket);
      const e = entry(b.player_id);
      e.bowl              += bowlBase + haulBonus + maidenBonus;
      e._bowlBase         += bowlBase;
      e._bowlHaulBonus    += haulBonus;
      e._bowlMaidenBonus  += maidenBonus;
    }
  }

  const fieldPts = wicketVal * 0.2;
  const dis = db.prepare(`SELECT method, fielder_id FROM dismissals WHERE fixture_id = ?`).all(fixtureId);
  for (const d of dis) {
    if (!d.fielder_id || !whccIds.has(d.fielder_id)) continue;
    if (d.method === 'Caught' || d.method === 'CaughtAndBowled' || d.method === 'Stumped') entry(d.fielder_id).field += fieldPts;
  }

  const players = Object.values(scores)
    .map(s => ({
      playerId: s.playerId, name: s.name,
      bat:             +s.bat.toFixed(1),
      bowl:            +s.bowl.toFixed(1),
      field:           +s.field.toFixed(1),
      total:           +(s.bat + s.bowl + s.field).toFixed(1),
      batBase:         +s._batBase.toFixed(2),
      batSR:           s._batBalls > 0 ? Math.round((s._batRuns / s._batBalls) * 100) : null,
      batSRBonus:      +s._batSRBonus.toFixed(2),
      bowlHaulBonus:   +s._bowlHaulBonus.toFixed(2),
      bowlMaidenBonus: +s._bowlMaidenBonus.toFixed(2),
    }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total);

  const meta = {
    matchType: fmtCfg.name,
    wicketVal,
    maidensPerWicket,
    srPct,
    teamSR: whccTeamBalls > 0 ? Math.round((whccTeamRuns / whccTeamBalls) * 100) : null,
  };

  return { players, meta };
}

function formatDismissal(method, fielder, bowler) {
  const f = fielder, b = bowler;
  switch (method) {
    case 'Caught':          return (f && b) ? `ct ${f} b ${b}` : (b ? `caught b ${b}` : 'caught');
    case 'CaughtAndBowled': return b ? `c&b ${b}` : 'c&b';
    case 'Bowled':          return b ? `b ${b}` : 'bowled';
    case 'LBW':             return b ? `lbw b ${b}` : 'lbw';
    case 'Stumped':         return (f && b) ? `st ${f} b ${b}` : 'stumped';
    case 'RunOut':
    case 'Run out':         return f ? `run out (${f})` : 'run out';
    default:                return method || 'out';
  }
}


function parseCatcher(lDesc) {
  if (!lDesc) return null;
  const lo = lDesc.toLowerCase();
  // Caught and bowled: bowler IS the catcher — check before generic 'ct' pattern
  if (lo.includes('c&b') || lo.includes('ct and b') || lo.includes('caught and bowled')) {
    const m = lDesc.match(/(?:c&b|ct and b|caught and bowled)\s+([A-Za-z][A-Za-z\s]+?)(?:\s*$)/i);
    return m ? m[1].trim() : null;
  }
  // "ct Zayd Akhtar b Sebastian Mills" -> extract catcher name
  const m = lDesc.match(/\bct\s+([A-Za-z][A-Za-z\s]+?)\s+b\s/i);
  return m ? m[1].trim() : null;
}

function nameFromDesc(desc, role) {
  // " Bowler to Batter: description" — extract bowler or batter name
  const m = /^\s*(.+?)\s+to\s+(.+?)\s*:/.exec(desc || '');
  if (!m) return null;
  return role === 'bowler' ? m[1].trim() : m[2].trim();
}

// ── Roles endpoints ─────────────────────────────────────────────────────────

// GET /api/matches/:fixtureId/roles
router.get('/:fixtureId/roles', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;

  const inningsList = db.prepare(
    `SELECT i.result_id, i.innings_order FROM innings i WHERE i.fixture_id = ? ORDER BY i.innings_order`
  ).all(fixtureId);

  if (!inningsList.length) return res.json({});

  const captains = db.prepare(
    `SELECT innings_order, player_id FROM match_captains WHERE fixture_id = ?`
  ).all(fixtureId);
  const captainMap = Object.fromEntries(captains.map(c => [c.innings_order, c.player_id]));

  const wkRows = db.prepare(
    `SELECT id, innings_order, player_id, from_over, to_over FROM wk_assignments WHERE fixture_id = ? ORDER BY innings_order, from_over`
  ).all(fixtureId);

  const errorRows = db.prepare(
    `SELECT id, innings_order, player_id, error_type FROM wk_errors WHERE fixture_id = ?`
  ).all(fixtureId);

  // Use fixture's canonical team names to filter player_flags — avoids stale U10/U11 mismatches
  // in individual player.team fields when the same players cross age groups between seasons.
  const fixtureTeams = db.prepare('SELECT home_team, away_team FROM fixtures WHERE fixture_id = ?').get(fixtureId);
  const WHCC_KW = ['woking', 'horsell', 'whcc', 'whirlwind'];
  const isWhccName = t => WHCC_KW.some(k => (t || '').toLowerCase().includes(k));
  const whccFixtureTeam = fixtureTeams
    ? [fixtureTeams.home_team, fixtureTeams.away_team].find(isWhccName) ?? null
    : null;
  const oppFixtureTeam = fixtureTeams
    ? [fixtureTeams.home_team, fixtureTeams.away_team].find(t => !isWhccName(t)) ?? null
    : null;

  const isManualFixture = !!(
    db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId)
  );

  const result = {};

  for (const inn of inningsList) {
    const order = inn.innings_order;

    // Batting team: team of the first batter in this innings
    const btRow = db.prepare(
      `SELECT p.team FROM deliveries d JOIN players_dn p ON p.player_id = d.batter_id WHERE d.result_id = ? ORDER BY d.over_no, d.ball_no LIMIT 1`
    ).get(inn.result_id);
    // For manual matches (no deliveries), infer batting team from innings order: 1=WHCC bat, 2=opp bat
    const batting_team = btRow?.team ?? (isManualFixture ? (order === 1 ? whccFixtureTeam : oppFixtureTeam) : null);

    // Canonical team name from fixture (not from stale player.team) used for player_flags filter
    const pfTeam = isWhccName(batting_team) ? whccFixtureTeam : oppFixtureTeam;

    // Full squad: batters + bowlers from deliveries (or manual tables for manual matches), plus player_flags
    const otherResultId = inningsList.find(i => i.innings_order !== order)?.result_id ?? inn.result_id;
    let players;
    if (isManualFixture) {
      // For manual matches, pull players from manual_batting (order 1) or manual_bowling (order 2)
      players = order === 1
        ? db.prepare(`SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_batting mb ON mb.player_id = p.player_id WHERE mb.fixture_id = ? ORDER BY p.name`).all(fixtureId)
        : db.prepare(`SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_bowling mbw ON mbw.player_id = p.player_id WHERE mbw.fixture_id = ? ORDER BY p.name`).all(fixtureId);
    } else {
      const isWhccBatting = isWhccName(batting_team)
      const whccTeamFilter = `(p.team LIKE '%oking%' OR p.team LIKE '%orsell%' OR p.team LIKE '%WHCC%' OR p.team LIKE '%hirlwind%' OR p.team LIKE '%urricane%')`
      const teamFilter = batting_team == null ? '' : isWhccBatting ? `AND ${whccTeamFilter}` : `AND NOT ${whccTeamFilter}`
      players = db.prepare(`
        SELECT DISTINCT p.player_id, COALESCE(p.display_name, p.name) AS name FROM players p
        WHERE p.player_id IN (
          SELECT batter_id  FROM deliveries WHERE result_id = ?
          UNION
          SELECT bowler_id  FROM deliveries WHERE result_id = ?
          UNION
          SELECT pf.player_id FROM player_flags pf WHERE pf.fixture_id = ?
          UNION
          SELECT d.fielder_id FROM dismissals d WHERE d.fixture_id = ? AND d.fielder_id IS NOT NULL
          UNION
          SELECT wa.player_id FROM wk_assignments wa WHERE wa.fixture_id = ?
        )
        ${teamFilter}
        ORDER BY COALESCE(p.display_name, p.name)
      `).all(inn.result_id, otherResultId, fixtureId, fixtureId, fixtureId);
    }

    const stints = wkRows.filter(r => r.innings_order === order);
    const errors = errorRows.filter(r => r.innings_order === order);

    // Fetch all byes for this innings once, then slice per WK stint in memory
    const allByes = db.prepare(
      `SELECT over_no, runs_extra FROM deliveries WHERE result_id = ? AND extras_type = 3`
    ).all(inn.result_id);
    const byesInRange = (fromOver, toOver) => allByes
      .filter(r => r.over_no >= fromOver - 1 && (toOver == null || r.over_no <= toOver - 1))
      .reduce((s, r) => s + r.runs_extra, 0);

    const wk_stints = stints.map((stint, idx) => {
      const nextFrom = stints[idx + 1]?.from_over ?? null;
      const toOver   = stint.to_over ?? nextFrom ?? null;
      return { id: stint.id, player_id: stint.player_id, from_over: stint.from_over, to_over: stint.to_over ?? null, byes: byesInRange(stint.from_over, toOver) };
    });

    result[order] = {
      captain_player_id: captainMap[order] ?? null,
      batting_team: isWhccName(batting_team) ? (whccFixtureTeam ?? batting_team) : (oppFixtureTeam ?? batting_team),
      wk_stints,
      wk_errors: errors,
      players,
    };
  }

  res.json(result);
});

// PUT /api/matches/:fixtureId/captain  { innings_order, player_id }
router.put('/:fixtureId/captain', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id } = req.body;
  if (!innings_order || !player_id) return res.status(400).json({ error: 'innings_order and player_id required' });

  db.prepare(`
    INSERT INTO match_captains (fixture_id, innings_order, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT(fixture_id, innings_order) DO UPDATE SET player_id = excluded.player_id
  `).run(fixtureId, innings_order, player_id);
  res.json({ ok: true });
});

// POST /api/matches/:fixtureId/wk  { innings_order, player_id, from_over, to_over }
router.post('/:fixtureId/wk', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id, from_over, to_over } = req.body;
  if (!innings_order || !player_id || from_over == null || from_over < 1) return res.status(400).json({ error: 'innings_order, player_id and from_over required' });
  if (to_over != null && to_over < from_over) return res.status(400).json({ error: 'End over must be ≥ start over' });

  // Auto-close any open-ended stint that would overlap; reject closed-stint overlaps
  const existing = db.prepare(
    `SELECT id, from_over, to_over FROM wk_assignments WHERE fixture_id = ? AND innings_order = ?`
  ).all(fixtureId, innings_order);
  for (const e of existing) {
    const eTo = e.to_over ?? null;
    const overlaps = from_over >= e.from_over && (eTo == null || from_over <= eTo);
    if (!overlaps) continue;
    if (eTo == null) {
      db.prepare('UPDATE wk_assignments SET to_over = ? WHERE id = ?').run(from_over - 1, e.id);
    } else {
      return res.status(400).json({ error: `Overlaps with existing stint (overs ${e.from_over - 1}–${e.to_over - 1})` });
    }
  }

  try {
    const row = db.prepare(`
      INSERT INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over) VALUES (?, ?, ?, ?, ?)
    `).run(fixtureId, innings_order, player_id, from_over, to_over ?? null);
    res.json({ ok: true, id: row.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/matches/:fixtureId/wk/:wkId  { to_over }
router.patch('/:fixtureId/wk/:wkId', (req, res) => {
  const db = getDb();
  const { fixtureId, wkId } = req.params;
  const { to_over } = req.body;
  const stint = db.prepare('SELECT * FROM wk_assignments WHERE id = ? AND fixture_id = ?').get(wkId, fixtureId);
  if (!stint) return res.status(404).json({ error: 'Stint not found' });
  if (to_over != null && to_over < stint.from_over) return res.status(400).json({ error: 'End over must be ≥ start over' });
  db.prepare('UPDATE wk_assignments SET to_over = ? WHERE id = ?').run(to_over ?? null, wkId);
  res.json({ ok: true });
});

// DELETE /api/matches/:fixtureId/wk/:wkId
router.delete('/:fixtureId/wk/:wkId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM wk_assignments WHERE id = ? AND fixture_id = ?`)
    .run(req.params.wkId, req.params.fixtureId);
  res.json({ ok: true });
});

// POST /api/matches/:fixtureId/wk-error  { innings_order, player_id, error_type }
router.post('/:fixtureId/wk-error', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id, error_type } = req.body;
  if (!innings_order || !player_id || !error_type) return res.status(400).json({ error: 'innings_order, player_id and error_type required' });

  try {
    const row = db.prepare(`
      INSERT INTO wk_errors (fixture_id, innings_order, player_id, error_type) VALUES (?, ?, ?, ?)
    `).run(fixtureId, innings_order, player_id, error_type);
    res.json({ ok: true, id: row.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/matches/:fixtureId/wk-error/:errorId
router.delete('/:fixtureId/wk-error/:errorId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM wk_errors WHERE id = ? AND fixture_id = ?`)
    .run(req.params.errorId, req.params.fixtureId);
  res.json({ ok: true });
});

// PATCH /api/matches/:fixtureId/delivery/:deliveryId
// Editable fields: batter_id, bowler_id, runs_bat, runs_extra, extras_type,
//                  dismissed_batter_id, dismissal_method, dismissal_fielder_id, dismissal_bowler_id
router.patch('/:fixtureId/delivery/:deliveryId', (req, res) => {
  const db = getDb();
  const { fixtureId, deliveryId } = req.params;

  // Verify delivery belongs to this fixture
  const existing = db.prepare(`
    SELECT d.*, i.innings_order FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE d.id = ? AND i.fixture_id = ?
  `).get(deliveryId, fixtureId);
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });

  const {
    batter_id, batter_id_ns, bowler_id,
    runs_bat, runs_extra, extras_type,
    dismissed_batter_id,
    dismissal_method, dismissal_fielder_id, dismissal_bowler_id,
  } = req.body;

  db.transaction(() => {
    // Build SET clause from provided fields only
    const sets = [];
    const vals = [];
    const maybe = (key, val) => { if (val !== undefined) { sets.push(`${key} = ?`); vals.push(val); } }
    maybe('batter_id',           batter_id)
    maybe('batter_id_ns',        batter_id_ns !== undefined ? (batter_id_ns === null ? null : batter_id_ns) : undefined)
    maybe('bowler_id',           bowler_id)
    maybe('runs_bat',            runs_bat)
    maybe('runs_extra',          runs_extra)
    maybe('extras_type',         extras_type !== undefined ? (extras_type === null ? null : Number(extras_type)) : undefined)
    maybe('dismissed_batter_id', dismissed_batter_id !== undefined ? (dismissed_batter_id === null ? null : dismissed_batter_id) : undefined)

    if (sets.length) {
      db.prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, deliveryId);
    }

    // Update dismissals table when wicket data changes
    const prevDismissedId = existing.dismissed_batter_id;
    if (dismissed_batter_id !== undefined) {
      // Remove old dismissal record if batter changes or wicket is cleared
      if (prevDismissedId) {
        db.prepare(`DELETE FROM dismissals WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?`)
          .run(fixtureId, existing.innings_order, prevDismissedId);
      }
      if (dismissed_batter_id !== null && dismissal_method) {
        db.prepare(`
          INSERT INTO dismissals (fixture_id, innings_order, batter_id, bowler_id, fielder_id, method)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(fixtureId, existing.innings_order, dismissed_batter_id, dismissal_bowler_id ?? null, dismissal_fielder_id ?? null, dismissal_method);
      }
    } else if ((dismissal_method || dismissal_fielder_id !== undefined || dismissal_bowler_id !== undefined) && prevDismissedId) {
      // Wicket stays, update method/fielder/bowler on existing dismissal record
      db.prepare(`
        UPDATE dismissals SET
          method     = COALESCE(?, method),
          bowler_id  = ?,
          fielder_id = ?
        WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?
      `).run(dismissal_method ?? null, dismissal_bowler_id ?? null, dismissal_fielder_id ?? null, fixtureId, existing.innings_order, prevDismissedId);
    }
  })();

  // Invalidate caches
  try {
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(fixtureId);
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(fixtureId);
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(fixtureId);
    require('../utils/matchSummary').computeAndCacheStats(db, fixtureId);
  } catch (e) {
    console.error(`[delivery-edit] cache update failed for ${fixtureId}:`, e.message);
  }

  res.json({ ok: true });
});

// PATCH /api/matches/:fixtureId/pair-block
// Reassign the batting pair for a block of overs in a pairs innings.
// Body: { innings_order, over_start, over_end, batter1_id, batter2_id }
// over_start and over_end are 1-indexed (matching the 'over' field in the overs array, i.e. over_no + 1).
router.patch('/:fixtureId/pair-block', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, over_start, over_end, batter1_id, batter2_id } = req.body;

  if (!innings_order || !over_start || !over_end || !batter1_id || !batter2_id) {
    return res.status(400).json({ error: 'innings_order, over_start, over_end, batter1_id and batter2_id are required' });
  }

  const inn = db.prepare(`SELECT result_id FROM innings WHERE fixture_id = ? AND innings_order = ?`).get(fixtureId, innings_order);
  if (!inn) return res.status(404).json({ error: 'Innings not found' });

  // over_start/over_end are 1-indexed; deliveries.over_no is 0-indexed
  const overNoStart = Number(over_start) - 1;
  const overNoEnd   = Number(over_end)   - 1;

  const deliveries = db.prepare(`
    SELECT id, batter_id, batter_id_ns FROM deliveries
    WHERE result_id = ? AND over_no BETWEEN ? AND ?
  `).all(inn.result_id, overNoStart, overNoEnd);

  if (!deliveries.length) return res.status(404).json({ error: 'No deliveries found in that over range' });

  // Determine all current batting IDs in this block (may be 3+ due to broken reporting)
  const oldIds = [...new Set(
    deliveries.flatMap(d => [d.batter_id, d.batter_id_ns].filter(Boolean))
  )];

  const b1 = Number(batter1_id);
  const b2 = Number(batter2_id);

  // Build a remapping: cycle extras onto b1/b2 alternately to handle 3-player blocks
  const remap = {};
  for (let i = 0; i < oldIds.length; i++) {
    remap[oldIds[i]] = i % 2 === 0 ? b1 : b2;
  }
  const fallback1 = b1, fallback2 = b2;

  const updStmt = db.prepare(`UPDATE deliveries SET batter_id = ?, batter_id_ns = ? WHERE id = ?`);

  db.transaction(() => {
    for (const d of deliveries) {
      const newBatter   = remap[d.batter_id]    ?? (d.batter_id    ? fallback1 : null);
      const newBatterNs = remap[d.batter_id_ns] ?? (d.batter_id_ns ? fallback2 : null);
      updStmt.run(newBatter, newBatterNs, d.id);
    }
  })();

  // Invalidate caches
  try {
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(fixtureId);
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(fixtureId);
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(fixtureId);
    require('../utils/matchSummary').computeAndCacheStats(db, fixtureId);
  } catch (e) {
    console.error(`[pair-block] cache update failed for ${fixtureId}:`, e.message);
  }

  res.json({ ok: true });
});

// PATCH /api/matches/:fixtureId/result
// Override result fields on a fixture (for matches where Play Cricket data is incomplete).
// Body: { result, home_score, away_score, home_overs, away_overs, home_wickets, away_wickets,
//         toss_winner, toss_decision }
router.patch('/:fixtureId/result', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const fixture = db.prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?').get(fixtureId);
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' });

  const allowed = ['result','home_score','away_score','home_overs','away_overs','home_wickets','away_wickets','toss_winner','toss_decision'];
  const sets = [], vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key] ?? null); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

  db.prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE fixture_id = ?`).run(...vals, fixtureId);

  try {
    db.prepare('DELETE FROM match_stats_cache WHERE fixture_id = ?').run(fixtureId);
    db.prepare('DELETE FROM mvp_cache         WHERE fixture_id = ?').run(fixtureId);
    require('../utils/matchSummary').computeAndCacheStats(db, fixtureId);
  } catch (e) {
    console.error(`[result-edit] cache update failed for ${fixtureId}:`, e.message);
  }

  res.json({ ok: true });
});

module.exports = router;
module.exports._test = { parseHowOut, getPartnerships, buildMatchFlow, isWhccTeam, getFormatConfig, parseCatcher };

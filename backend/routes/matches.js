const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimit');
router.use(apiLimiter);
const { getDb } = require('../db/schema');
const { classifyDismissal } = require('../utils/cricket');
const { whccFixtureWhere, whccCol, whccTeamClause, isWhccTeam, yearExpr: _yearExpr } = require('../utils/db');
const { buildAccessFilter, buildGroupFilter } = require('../utils/access');
const { getPartnerships, getPhaseStats, getSpells, buildManualScorecard, buildScorecard,
        formatDismissal, parseCatcher, nameFromDesc } = require('../utils/scorecard');
const { buildMatchFlow, getFormatConfig } = require('../utils/matchFlow');
const { buildManualMvp, computeManualMvpForFixtures, computeMvpForFixtures, buildMvp } = require('../utils/mvp');

// Group filter narrowing fixtures to the user's selected team/season pairs, prefixed with AND
// for inline use in the list/season queries (delegates to the shared buildGroupFilter).
function groupFilterClause(req) {
  const f = buildGroupFilter(req)
  return f ? { sql: `AND ${f.sql}`, params: f.params } : null
}

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

function invalidateMatchCaches(db, fixtureId) {
  db.prepare('DELETE FROM match_stats_cache  WHERE fixture_id = ?').run(fixtureId);
  db.prepare('DELETE FROM match_detail_cache WHERE fixture_id = ?').run(fixtureId);
  db.prepare('DELETE FROM mvp_cache          WHERE fixture_id = ?').run(fixtureId);
  try { require('../utils/matchSummary').computeAndCacheStats(db, fixtureId); }
  catch (e) { console.error(`[cache] update failed for ${fixtureId}:`, e.message); }
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

  const accessFilter = buildAccessFilter(req);
  const groupFilter  = groupFilterClause(req);
  const whereClauses = [
    accessFilter ? `(${accessFilter.sql})` : null,
    groupFilter  ? groupFilter.sql.replace(/^AND /, '') : null,
  ].filter(Boolean);
  const accessWhere  = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const accessParams = [...(accessFilter?.params ?? []), ...(groupFilter?.params ?? [])];

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
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const VALID_COMPS = ['cup', 'friendly', 'league'];
  const comp = VALID_COMPS.includes((req.query.comp || '').toLowerCase()) ? req.query.comp.toLowerCase() : null;

  const _ye = _yearExpr();
  const yearClause = year ? `AND ${_ye} = ?` : '';
  const yearParams = year ? [year] : [];

  const whccWhere = whccFixtureWhere();

  // Narrow to a WHCC sub-team (whirlwind/hurricane) requiring a WHCC marker on the same
  // side, so opposition teams sharing the sub-name (e.g. Camberley Lightning) are excluded.
  const { clause: teamClause, params: teamParams } = whccTeamClause(team);
  const compClause = comp === 'cup'      ? `AND lower(f.competition) LIKE '%cup%'`
                   : comp === 'friendly' ? `AND lower(f.competition) = 'friendly'`
                   : comp === 'league'   ? `AND (f.competition IS NULL OR (lower(f.competition) NOT LIKE '%cup%' AND lower(f.competition) != 'friendly'))`
                   : '';

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];
  const groupFilter  = groupFilterClause(req);
  const groupClause  = groupFilter?.sql ?? '';
  const groupParams  = groupFilter?.params ?? [];
  const rfSub    = `SELECT f.fixture_id FROM fixtures f WHERE ${whccWhere} ${yearClause} ${teamClause} ${compClause} ${accessClause} ${groupClause}`;
  const rfParams = [...yearParams, ...teamParams, ...accessParams, ...groupParams];

  // Fixtures for match record
  const fixtures = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.home_score, f.away_score,
      f.home_wickets, f.away_wickets, f.toss_winner, f.toss_decision,
      f.format, f.starting_score,
      (SELECT COUNT(DISTINCT d.batter_id) FROM innings i JOIN deliveries d ON d.result_id = i.result_id
        WHERE i.fixture_id = f.fixture_id AND i.innings_order = 1) AS inn1_batters
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})
  `).all(...rfParams);

  const isWhcc = isWhccTeam;
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
        AND ${whccCol('pb.team')}
      GROUP BY d.batter_id, d.result_id
      UNION ALL
      SELECT mb.runs, CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END, mb.balls
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
    )
  `).get(...rfParams, ...rfParams);

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
        AND ${whccCol('pb.team')}
      GROUP BY d.bowler_id, d.result_id
      UNION ALL
      SELECT mbw.wickets, mbw.balls, mbw.runs
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
    )
  `).get(...rfParams, ...rfParams);

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
        AND ${whccCol('pb.team')}
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
  `).all(...rfParams, ...rfParams);

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
        AND ${whccCol('pb.team')}
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
  `).all(...rfParams, ...rfParams);

  // Match scores for form chart
  const matchScoreFixtures = db.prepare(`
    SELECT f.fixture_id, f.match_date_iso, f.home_team, f.away_team,
      f.home_score, f.away_score, f.home_wickets, f.away_wickets,
      f.format, f.starting_score
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})
    AND f.match_date_iso IS NOT NULL
    ORDER BY f.match_date_iso ASC
  `).all(...rfParams);

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

  const af = buildAccessFilter(req);
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
    WHERE ${whccCol('team')}
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

  // Default to empty — manual matches have no ball-by-ball partnerships. (Previously
  // `partnerships` was only assigned inside the hasDeliveries branch and never declared, so a
  // manual match crashed with a ReferenceError; `phases` is already declared above.)
  let partnerships = [];
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
  const isWhccName = isWhccTeam;
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
      const whccTeamFilter = whccCol('p.team')
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

  invalidateMatchCaches(db, fixtureId);

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

  invalidateMatchCaches(db, fixtureId);

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

  invalidateMatchCaches(db, fixtureId);

  res.json({ ok: true });
});

// POST /api/matches/:fixtureId/innings  { innings_order }
// Ensure an innings record exists for the given order. Only allowed on manual- fixtures.
router.post('/:fixtureId/innings', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order } = req.body;
  if (!fixtureId.startsWith('manual-')) return res.status(403).json({ error: 'Only allowed on manual fixtures' });
  if (![1, 2].includes(Number(innings_order))) return res.status(400).json({ error: 'innings_order must be 1 or 2' });

  const fixture = db.prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?').get(fixtureId);
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' });

  const order = Number(innings_order);
  let row = db.prepare('SELECT result_id, innings_order FROM innings WHERE fixture_id = ? AND innings_order = ?').get(fixtureId, order);
  let created = false;
  if (!row) {
    const r = db.prepare('INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)').run(fixtureId, order);
    row = { result_id: r.lastInsertRowid, innings_order: order };
    created = true;
  }
  res.json({ result_id: row.result_id, innings_order: row.innings_order, created });
});

// POST /api/matches/:fixtureId/innings/:inningsOrder/delivery
// Append a single delivery to the innings.  Auto-advances over/ball position.
// Body: { batter_id, batter_id_ns?, bowler_id, runs_bat, runs_extra?, extras_type?,
//          dismissed_batter_id?, dismissal_method?, dismissal_fielder_id?, dismissal_bowler_id? }
router.post('/:fixtureId/innings/:inningsOrder/delivery', (req, res) => {
  const db = getDb();
  const { fixtureId, inningsOrder } = req.params;
  if (!fixtureId.startsWith('manual-')) return res.status(403).json({ error: 'Only allowed on manual fixtures' });

  const order = Number(inningsOrder);
  if (![1, 2].includes(order)) return res.status(400).json({ error: 'inningsOrder must be 1 or 2' });

  const inn = db.prepare('SELECT result_id FROM innings WHERE fixture_id = ? AND innings_order = ?').get(fixtureId, order);
  if (!inn) return res.status(404).json({ error: 'Innings not found — create it first via POST /innings' });

  const {
    batter_id, batter_id_ns, bowler_id,
    runs_bat = 0, runs_extra = 0, extras_type = null,
    dismissed_batter_id, dismissal_method, dismissal_fielder_id, dismissal_bowler_id,
  } = req.body;

  if (!batter_id || !bowler_id) return res.status(400).json({ error: 'batter_id and bowler_id are required' });

  const resultId = inn.result_id;
  const extType = extras_type === null || extras_type === '' ? null : Number(extras_type);
  const isLegal = extType === null || extType === 3 || extType === 4; // normal, byes, leg-byes count as legal

  const FIELDER_METHODS = ['Caught', 'CaughtAndBowled', 'Stumped', 'RunOut'];

  let newId, over_no, ball_no;
  db.transaction(() => {
    // Determine next over/ball position inside the transaction to prevent races
    const last = db.prepare(
      'SELECT over_no, ball_no FROM deliveries WHERE result_id = ? ORDER BY over_no DESC, ball_no DESC LIMIT 1'
    ).get(resultId);

    if (!last) {
      over_no = 0; ball_no = 1;
    } else {
      const legalInOver = db.prepare(
        'SELECT COUNT(*) AS cnt FROM deliveries WHERE result_id = ? AND over_no = ? AND (extras_type IS NULL OR extras_type IN (3,4))'
      ).get(resultId, last.over_no).cnt;

      if (legalInOver >= 6) {
        over_no = last.over_no + 1; ball_no = 1;
      } else {
        over_no = last.over_no; ball_no = last.ball_no + 1;
      }
    }

    const r = db.prepare(`
      INSERT INTO deliveries
        (result_id, innings_number, over_no, ball_no, ball_no_disp,
         batter_id, batter_id_ns, bowler_id,
         runs_bat, runs_extra, extras_type, dismissed_batter_id)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(resultId, order, over_no, ball_no,
      Number(batter_id), batter_id_ns ? Number(batter_id_ns) : null, Number(bowler_id),
      Number(runs_bat), Number(runs_extra), extType,
      dismissed_batter_id ? Number(dismissed_batter_id) : null);
    newId = r.lastInsertRowid;

    if (dismissed_batter_id && dismissal_method) {
      db.prepare(`
        INSERT OR IGNORE INTO dismissals (fixture_id, innings_order, batter_id, bowler_id, fielder_id, method)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        fixtureId, order,
        Number(dismissed_batter_id),
        (dismissal_method !== 'RunOut' && dismissal_bowler_id) ? Number(dismissal_bowler_id) : null,
        (FIELDER_METHODS.includes(dismissal_method) && dismissal_fielder_id) ? Number(dismissal_fielder_id) : null,
        dismissal_method
      );
    }
  })();

  invalidateMatchCaches(db, fixtureId);

  res.json({ id: newId, over_no, ball_no, legal: isLegal });
});

// DELETE /api/matches/:fixtureId/delivery/:deliveryId
// Remove a delivery (and its dismissal record). Only allowed on manual- fixtures.
router.delete('/:fixtureId/delivery/:deliveryId', (req, res) => {
  const db = getDb();
  const { fixtureId, deliveryId } = req.params;
  if (!fixtureId.startsWith('manual-')) return res.status(403).json({ error: 'Only allowed on manual fixtures' });

  const existing = db.prepare(`
    SELECT d.*, i.innings_order FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE d.id = ? AND i.fixture_id = ?
  `).get(deliveryId, fixtureId);
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });

  db.transaction(() => {
    if (existing.dismissed_batter_id) {
      db.prepare('DELETE FROM dismissals WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?')
        .run(fixtureId, existing.innings_order, existing.dismissed_batter_id);
    }
    db.prepare('DELETE FROM deliveries WHERE id = ?').run(deliveryId);
  })();

  invalidateMatchCaches(db, fixtureId);

  res.json({ ok: true });
});

module.exports = router;
module.exports._test = { parseHowOut, getPartnerships, buildMatchFlow, isWhccTeam, getFormatConfig, parseCatcher };

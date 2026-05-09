const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// GET /api/players
router.get('/', (req, res) => {
  const db = getDb();
  const players = db.prepare(`SELECT * FROM players ORDER BY name`).all();
  res.json(players);
});

// GET /api/players/stats?year=2025&team=whirlwind
// team: 'whirlwind' | 'hurricane' | omit for all WHCC
// year: 4-digit year | omit for all years
router.get('/stats', (req, res) => {
  const db = getDb();

  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const VALID_TEAMS = ['whirlwind', 'hurricane'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;

  const yearExpr = `CASE WHEN f.match_date GLOB '[0-9][0-9][0-9][0-9]-*' THEN substr(f.match_date,1,4) ELSE substr(f.match_date,-4) END`;
  const yearClause = year ? `AND ${yearExpr} = '${year}'` : '';
  const teamClause = team ? `AND (lower(f.home_team) LIKE '%${team}%' OR lower(f.away_team) LIKE '%${team}%')` : '';

  const rows = db.prepare(`
    WITH
    relevant_fixtures AS (
      SELECT f.fixture_id FROM fixtures f
      WHERE (lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
          OR lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%'
          OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%'
          OR lower(f.away_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%hurricane%')
      ${yearClause}
      ${teamClause}
    ),
    batting_inn AS (
      SELECT d.batter_id, d.result_id, i.fixture_id,
        SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) != 2 THEN 1 ELSE 0 END) AS balls_faced,
        SUM(CASE WHEN d.runs_bat = 4 THEN 1 ELSE 0 END) AS fours,
        SUM(CASE WHEN d.runs_bat = 6 THEN 1 ELSE 0 END) AS sixes,
        MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.batter_id, d.result_id
      UNION ALL
      SELECT mb.player_id AS batter_id, i.result_id, mb.fixture_id,
        mb.runs, mb.balls AS balls_faced, mb.fours, mb.sixes,
        CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END AS dismissed
      FROM manual_batting mb
      JOIN innings i ON i.fixture_id = mb.fixture_id AND i.innings_order = mb.innings_order
      JOIN relevant_fixtures rf ON rf.fixture_id = mb.fixture_id
      WHERE mb.did_not_bat = 0
    ),
    batting AS (
      SELECT batter_id AS player_id,
        COUNT(*) AS innings,
        COUNT(DISTINCT fixture_id) AS games_batted,
        SUM(runs) AS runs,
        SUM(balls_faced) AS balls_faced,
        SUM(fours) AS fours,
        SUM(sixes) AS sixes,
        MAX(runs) AS high_score,
        SUM(dismissed) AS times_out
      FROM batting_inn
      GROUP BY batter_id
    ),
    dis_counts AS (
      SELECT dis.batter_id AS player_id,
        SUM(CASE WHEN method IN ('Bowled','CaughtAndBowled') THEN 1 ELSE 0 END) AS dis_bowled,
        SUM(CASE WHEN method IN ('Caught','CaughtAndBowled') THEN 1 ELSE 0 END) AS dis_caught,
        SUM(CASE WHEN method = 'LBW'     THEN 1 ELSE 0 END) AS dis_lbw,
        SUM(CASE WHEN method = 'RunOut'  THEN 1 ELSE 0 END) AS dis_runout,
        SUM(CASE WHEN method = 'Stumped' THEN 1 ELSE 0 END) AS dis_stumped
      FROM dismissals dis
      JOIN relevant_fixtures rf ON rf.fixture_id = dis.fixture_id
      GROUP BY dis.batter_id
    ),
    bowling_inn AS (
      SELECT d.bowler_id, d.result_id, i.fixture_id,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + d.runs_extra) AS runs,
        COUNT(d.dismissed_batter_id) AS wickets,
        SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) AS wides,
        SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) AS no_balls
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.bowler_id, d.result_id
      UNION ALL
      SELECT mbw.player_id AS bowler_id, i.result_id, mbw.fixture_id,
        mbw.balls AS legal_balls, mbw.runs, mbw.wickets, mbw.wides, mbw.no_balls
      FROM manual_bowling mbw
      JOIN innings i ON i.fixture_id = mbw.fixture_id AND i.innings_order = mbw.innings_order
      JOIN relevant_fixtures rf ON rf.fixture_id = mbw.fixture_id
    ),
    bowling_over AS (
      SELECT d.bowler_id, d.result_id, d.over_no,
        SUM(d.runs_bat + d.runs_extra) AS over_runs,
        COUNT(d.dismissed_batter_id) AS over_wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.bowler_id, d.result_id, d.over_no
    ),
    maidens_agg AS (
      SELECT player_id, SUM(maidens) AS maidens, SUM(wicket_maidens) AS wicket_maidens
      FROM (
        SELECT bowler_id AS player_id,
          SUM(CASE WHEN over_runs = 0 THEN 1 ELSE 0 END) AS maidens,
          SUM(CASE WHEN over_runs = 0 AND over_wickets > 0 THEN 1 ELSE 0 END) AS wicket_maidens
        FROM bowling_over GROUP BY bowler_id
        UNION ALL
        SELECT mbw.player_id, SUM(mbw.maidens) AS maidens, SUM(mbw.wicket_maidens) AS wicket_maidens
        FROM manual_bowling mbw
        JOIN relevant_fixtures rf ON rf.fixture_id = mbw.fixture_id
        GROUP BY mbw.player_id
      ) GROUP BY player_id
    ),
    hauls AS (
      SELECT bowler_id AS player_id,
        SUM(CASE WHEN wickets >= 3 THEN 1 ELSE 0 END) AS three_fers,
        SUM(CASE WHEN wickets >= 4 THEN 1 ELSE 0 END) AS four_fers,
        SUM(CASE WHEN wickets >= 5 THEN 1 ELSE 0 END) AS five_fers,
        SUM(CASE WHEN wickets >= 6 THEN 1 ELSE 0 END) AS six_fers
      FROM bowling_inn
      GROUP BY bowler_id
    ),
    bowling AS (
      SELECT bowler_id AS player_id,
        COUNT(DISTINCT fixture_id) AS games_bowled,
        SUM(legal_balls) AS balls_bowled,
        SUM(runs) AS runs_conceded,
        SUM(wickets) AS wickets,
        SUM(wides) AS wides,
        SUM(no_balls) AS no_balls
      FROM bowling_inn
      GROUP BY bowler_id
    ),
    bowl_dis AS (
      SELECT dis.bowler_id AS player_id,
        SUM(CASE WHEN method = 'Bowled'                      THEN 1 ELSE 0 END) AS wkt_bowled,
        SUM(CASE WHEN method IN ('Caught','CaughtAndBowled') THEN 1 ELSE 0 END) AS wkt_caught,
        SUM(CASE WHEN method = 'LBW'                         THEN 1 ELSE 0 END) AS wkt_lbw,
        SUM(CASE WHEN method = 'Stumped'                     THEN 1 ELSE 0 END) AS wkt_stumped
      FROM dismissals dis
      JOIN relevant_fixtures rf ON rf.fixture_id = dis.fixture_id
      WHERE dis.bowler_id IS NOT NULL
      GROUP BY dis.bowler_id
    ),
    fielding AS (
      SELECT dis.fielder_id AS player_id,
        SUM(CASE WHEN method IN ('Caught','CaughtAndBowled') THEN 1 ELSE 0 END) AS catches,
        SUM(CASE WHEN method = 'Stumped' THEN 1 ELSE 0 END) AS stumpings,
        SUM(CASE WHEN method = 'RunOut'  THEN 1 ELSE 0 END) AS run_outs
      FROM dismissals dis
      JOIN relevant_fixtures rf ON rf.fixture_id = dis.fixture_id
      WHERE dis.fielder_id IS NOT NULL
      GROUP BY dis.fielder_id
    ),
    flags AS (
      SELECT pf.player_id,
        SUM(pf.is_captain) AS captain_count
      FROM player_flags pf
      JOIN relevant_fixtures rf ON rf.fixture_id = pf.fixture_id
      GROUP BY pf.player_id
    ),
    wk_agg AS (
      SELECT wka.player_id, COUNT(DISTINCT wka.fixture_id) AS wk_count
      FROM wk_assignments wka
      JOIN relevant_fixtures rf ON rf.fixture_id = wka.fixture_id
      GROUP BY wka.player_id
    ),
    minutes_inn AS (
      -- Time at crease per innings: MIN to MAX timestamp across deliveries where the
      -- player appeared as either striker OR non-striker (so entering as non-striker is included)
      SELECT m.player_id, m.result_id,
        (MAX(strftime('%s', m.ts)) - MIN(strftime('%s', m.ts))) / 60 AS minutes
      FROM (
        SELECT batter_id    AS player_id, result_id, last_update_time AS ts
          FROM deliveries WHERE batter_id    IS NOT NULL AND last_update_time IS NOT NULL
        UNION ALL
        SELECT batter_id_ns AS player_id, result_id, last_update_time AS ts
          FROM deliveries WHERE batter_id_ns IS NOT NULL AND last_update_time IS NOT NULL
      ) m
      JOIN innings i ON i.result_id = m.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY m.player_id, m.result_id
      HAVING MAX(strftime('%s', m.ts)) > MIN(strftime('%s', m.ts))
    ),
    minutes_agg AS (
      SELECT player_id,
        SUM(minutes)  AS total_minutes,
        COUNT(*)      AS innings_timed
      FROM minutes_inn
      GROUP BY player_id
    ),
    dnb AS (
      SELECT mb.player_id, COUNT(*) AS dnb_count
      FROM manual_batting mb
      JOIN relevant_fixtures rf ON rf.fixture_id = mb.fixture_id
      WHERE mb.did_not_bat = 1
      GROUP BY mb.player_id
    ),
    attendance AS (
      SELECT player_id, COUNT(DISTINCT fixture_id) AS games_attended
      FROM (
        SELECT batter_id AS player_id, fixture_id FROM batting_inn
        UNION ALL
        SELECT bowler_id AS player_id, fixture_id FROM bowling_inn
        UNION ALL
        SELECT mb.player_id, mb.fixture_id FROM manual_batting mb
        JOIN relevant_fixtures rf ON rf.fixture_id = mb.fixture_id
        WHERE mb.did_not_bat = 1
      )
      GROUP BY player_id
    )
    SELECT
      p.player_id, p.name, p.team,
      COALESCE(a.games_attended, 0)   AS games_attended,
      COALESCE(b.games_batted, 0)     AS games_batted,
      COALESCE(b.innings, 0)          AS innings,
      COALESCE(b.runs, 0)             AS runs,
      COALESCE(b.balls_faced, 0)      AS balls_faced,
      COALESCE(b.fours, 0)            AS fours,
      COALESCE(b.sixes, 0)            AS sixes,
      COALESCE(b.high_score, 0)       AS high_score,
      COALESCE(b.times_out, 0)        AS times_out,
      COALESCE(fl.captain_count, 0)   AS captain_count,
      COALESCE(wa.wk_count, 0)        AS wk_count,
      COALESCE(dc.dis_bowled, 0)      AS dis_bowled,
      COALESCE(dc.dis_caught, 0)      AS dis_caught,
      COALESCE(dc.dis_lbw, 0)         AS dis_lbw,
      COALESCE(dc.dis_runout, 0)      AS dis_runout,
      COALESCE(dc.dis_stumped, 0)     AS dis_stumped,
      COALESCE(bow.games_bowled, 0)   AS games_bowled,
      COALESCE(bow.balls_bowled, 0)   AS balls_bowled,
      COALESCE(bow.runs_conceded, 0)  AS runs_conceded,
      COALESCE(bow.wickets, 0)        AS wickets,
      COALESCE(bow.wides, 0)          AS wides,
      COALESCE(bow.no_balls, 0)       AS no_balls,
      COALESCE(ma.maidens, 0)         AS maidens,
      COALESCE(ma.wicket_maidens, 0)  AS wicket_maidens,
      COALESCE(h.three_fers, 0)       AS three_fers,
      COALESCE(h.four_fers, 0)        AS four_fers,
      COALESCE(h.five_fers, 0)        AS five_fers,
      COALESCE(h.six_fers, 0)         AS six_fers,
      COALESCE(bd.wkt_bowled, 0)      AS wkt_bowled,
      COALESCE(bd.wkt_caught, 0)      AS wkt_caught,
      COALESCE(bd.wkt_lbw, 0)         AS wkt_lbw,
      COALESCE(bd.wkt_stumped, 0)     AS wkt_stumped,
      COALESCE(f.catches, 0)          AS catches,
      COALESCE(f.stumpings, 0)        AS stumpings,
      COALESCE(f.run_outs, 0)         AS run_outs,
      COALESCE(mt.total_minutes, 0)   AS total_minutes,
      COALESCE(mt.innings_timed, 0)   AS innings_timed,
      COALESCE(dn.dnb_count, 0)       AS dnb_count
    FROM players p
    LEFT JOIN attendance  a  ON a.player_id  = p.player_id
    LEFT JOIN batting     b  ON b.player_id  = p.player_id
    LEFT JOIN dis_counts  dc ON dc.player_id = p.player_id
    LEFT JOIN bowling     bow ON bow.player_id = p.player_id
    LEFT JOIN maidens_agg ma ON ma.player_id = p.player_id
    LEFT JOIN hauls       h  ON h.player_id  = p.player_id
    LEFT JOIN bowl_dis    bd ON bd.player_id = p.player_id
    LEFT JOIN fielding    f  ON f.player_id  = p.player_id
    LEFT JOIN flags       fl ON fl.player_id = p.player_id
    LEFT JOIN wk_agg      wa ON wa.player_id = p.player_id
    LEFT JOIN minutes_agg mt ON mt.player_id = p.player_id
    LEFT JOIN dnb          dn ON dn.player_id = p.player_id
    WHERE (lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
        OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%hurricane%')
    ORDER BY p.name
  `).all();

  const stats = rows.map(r => {
    const notOuts   = r.innings - r.times_out;
    const batAvg    = r.times_out > 0 ? (r.runs / r.times_out).toFixed(2) : null;
    const batSR     = r.balls_faced > 0 ? ((r.runs / r.balls_faced) * 100).toFixed(1) : null;
    const overs     = `${Math.floor(r.balls_bowled / 6)}.${r.balls_bowled % 6}`;
    const bowlAvg   = r.wickets > 0 ? (r.runs_conceded / r.wickets).toFixed(2) : null;
    const bowlEcon  = r.balls_bowled > 0 ? ((r.runs_conceded / r.balls_bowled) * 6).toFixed(2) : null;
    const bowlSR    = r.wickets > 0 ? (r.balls_bowled / r.wickets).toFixed(1) : null;
    const wktsPerOv  = r.balls_bowled > 0 ? (r.wickets / (r.balls_bowled / 6)).toFixed(2) : null;
    const avgMinutes = r.innings_timed > 0 ? Math.round(r.total_minutes / r.innings_timed) : null;
    return { ...r, not_outs: notOuts, bat_avg: batAvg, bat_sr: batSR,
             overs, bowl_avg: bowlAvg, bowl_econ: bowlEcon, bowl_sr: bowlSR, wkts_per_over: wktsPerOv,
             avg_minutes: avgMinutes };
  });

  const years = db.prepare(`
    SELECT DISTINCT
      CASE WHEN match_date GLOB '[0-9][0-9][0-9][0-9]-*' THEN substr(match_date,1,4) ELSE substr(match_date,-4) END AS year
    FROM fixtures
    WHERE (lower(home_team) LIKE '%woking%' OR lower(home_team) LIKE '%horsell%'
        OR lower(away_team) LIKE '%woking%' OR lower(away_team) LIKE '%horsell%'
        OR lower(home_team) LIKE '%whirlwind%' OR lower(home_team) LIKE '%hurricane%'
        OR lower(away_team) LIKE '%whirlwind%' OR lower(away_team) LIKE '%hurricane%')
      AND match_date IS NOT NULL AND length(match_date) >= 4
    ORDER BY year DESC
  `).all().map(r => r.year);

  res.json({ players: stats, years });
});

// GET /api/players/:id/batting
router.get('/:id/batting', (req, res) => {
  const db = getDb();
  const playerId = Number(req.params.id);
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId);

  const innings = db.prepare(`
    SELECT
      i.fixture_id,
      i.innings_order,
      f.match_date,
      f.home_team,
      f.away_team,
      SUM(d.runs_bat) as runs,
      COUNT(*) as balls,
      SUM(CASE WHEN d.runs_bat = 4 THEN 1 ELSE 0 END) as fours,
      SUM(CASE WHEN d.runs_bat = 6 THEN 1 ELSE 0 END) as sixes,
      MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) as dismissed
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.batter_id = ?
    GROUP BY d.result_id
    ORDER BY f.match_date DESC
  `).all(playerId);

  // Get dismissal details for this player
  const dismissals = db.prepare(`
    SELECT d.l_desc, d.s_desc,
      i.fixture_id, f.match_date, f.home_team, f.away_team
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.dismissed_batter_id = ?
    ORDER BY f.match_date DESC
  `).all(playerId);

  // Classify how they got out
  const dismissalCounts = {};
  for (const d of dismissals) {
    const type = classifyDismissal(d.l_desc);
    dismissalCounts[type] = (dismissalCounts[type] || 0) + 1;
  }

  const totals = innings.reduce((acc, r) => {
    acc.innings++;
    acc.runs   += r.runs;
    acc.balls  += r.balls;
    acc.fours  += r.fours;
    acc.sixes  += r.sixes;
    if (!r.dismissed) acc.notOuts++;
    if (r.runs > acc.highScore) acc.highScore = r.runs;
    return acc;
  }, { innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0, notOuts: 0, highScore: 0 });

  const outs = totals.innings - totals.notOuts;
  totals.average    = outs > 0 ? (totals.runs / outs).toFixed(2) : 'N/A';
  totals.strikeRate = totals.balls > 0 ? ((totals.runs / totals.balls) * 100).toFixed(1) : 'N/A';

  res.json({ player, innings, totals, dismissalCounts });
});

// GET /api/players/:id/bowling
router.get('/:id/bowling', (req, res) => {
  const db = getDb();
  const playerId = Number(req.params.id);
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId);

  const spells = db.prepare(`
    SELECT
      i.fixture_id,
      i.innings_order,
      f.match_date,
      f.home_team,
      f.away_team,
      COUNT(CASE WHEN d.extras_type NOT IN (1,2) OR d.extras_type IS NULL THEN 1 END) as legal_balls,
      SUM(d.runs_bat + d.runs_extra) as runs,
      COUNT(d.dismissed_batter_id) as wickets,
      COUNT(CASE WHEN d.extras_type = 2 THEN 1 END) as wides,
      COUNT(CASE WHEN d.extras_type = 1 THEN 1 END) as no_balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.bowler_id = ?
    GROUP BY d.result_id
    ORDER BY f.match_date DESC
  `).all(playerId);

  const totals = spells.reduce((acc, r) => {
    acc.balls   += r.legal_balls;
    acc.runs    += r.runs;
    acc.wickets += r.wickets;
    acc.wides   += r.wides;
    acc.noBalls += r.no_balls;
    if (r.wickets > acc.bestWickets || (r.wickets === acc.bestWickets && r.runs < acc.bestRuns)) {
      acc.bestWickets = r.wickets; acc.bestRuns = r.runs;
    }
    return acc;
  }, { balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, bestWickets: 0, bestRuns: 999 });

  totals.overs   = `${Math.floor(totals.balls/6)}.${totals.balls%6}`;
  totals.average = totals.wickets > 0 ? (totals.runs / totals.wickets).toFixed(2) : 'N/A';
  totals.economy = totals.balls > 0 ? ((totals.runs / totals.balls) * 6).toFixed(2) : 'N/A';
  totals.best    = totals.bestWickets > 0 ? `${totals.bestWickets}/${totals.bestRuns}` : '-';

  res.json({ player, spells, totals });
});

function classifyDismissal(lDesc) {
  const s = (lDesc || '').toLowerCase();
  if (s.includes('run out'))    return 'Run out';
  if (s.includes('lbw'))        return 'LBW';
  if (s.includes('ct ') || s.includes('caught') || s.includes('ct &')) return 'Caught';
  if (s.includes('stumped') || s.includes('st ')) return 'Stumped';
  if (s.includes('b ') || s.includes('bowled') || s.includes('dismissed')) return 'Bowled';
  return 'Other';
}

module.exports = router;

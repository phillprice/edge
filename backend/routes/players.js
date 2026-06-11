const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimit');
router.use(apiLimiter);
const { getDb } = require('../db/schema');
const { ballsToOvers, classifyDismissal } = require('../utils/cricket');
const { whccFixtureWhere, whccCol, yearExpr, whccTeamClause } = require('../utils/db');
const { buildAccessFilter, buildGroupFilter } = require('../utils/access');
const { getAuthContext } = require('../middleware/auth');


// GET /api/players/names — WHCC player display names for client-side disambiguation
router.get('/names', (req, res) => {
  const db = getDb();
  const names = db.prepare(`
    SELECT COALESCE(display_name, name) AS name FROM players
    WHERE ${whccCol('team')}
    ORDER BY name
  `).all().map(r => r.name);
  res.json(names);
});

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
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const VALID_COMPS = ['cup', 'friendly', 'league'];
  const comp = VALID_COMPS.includes((req.query.comp || '').toLowerCase()) ? req.query.comp.toLowerCase() : null;

  const _yearExpr = yearExpr();
  const yearClause = year ? `AND ${_yearExpr} = ?` : '';
  const yearParams = year ? [year] : [];
  const { clause: teamClause, params: teamParams } = whccTeamClause(team);
  const compClause = comp === 'cup'      ? `AND lower(f.competition) LIKE '%cup%'`
                   : comp === 'friendly' ? `AND lower(f.competition) = 'friendly'`
                   : comp === 'league'   ? `AND (f.competition IS NULL OR (lower(f.competition) NOT LIKE '%cup%' AND lower(f.competition) != 'friendly'))`
                   : '';

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];
  const groupFilter  = buildGroupFilter(req);
  const groupClause  = groupFilter ? `AND (${groupFilter.sql})` : '';
  const groupParams  = groupFilter?.params ?? [];

  const rows = db.prepare(`
    WITH
    relevant_fixtures AS (
      SELECT f.fixture_id FROM fixtures f
      WHERE ${whccFixtureWhere()}
      ${yearClause}
      ${teamClause}
      ${compClause}
      ${accessClause}
      ${groupClause}
    ),
    batting_inn AS (
      SELECT d.batter_id, d.result_id, i.fixture_id,
        SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) != 2 THEN 1 ELSE 0 END) AS balls_faced,
        SUM(CASE WHEN d.runs_bat = 4 THEN 1 ELSE 0 END) AS fours,
        SUM(CASE WHEN d.runs_bat = 6 THEN 1 ELSE 0 END) AS sixes,
        MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed,
        SUM(CASE WHEN d.runs_bat = 0 AND COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS dots
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.batter_id, d.result_id
      UNION ALL
      SELECT mb.player_id AS batter_id, i.result_id, mb.fixture_id,
        mb.runs, mb.balls AS balls_faced, mb.fours, mb.sixes,
        CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END AS dismissed,
        0 AS dots
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
        SUM(dismissed) AS times_out,
        SUM(dots) AS dot_balls
      FROM batting_inn
      GROUP BY batter_id
    ),
    bat_order_raw AS (
      SELECT d.batter_id, d.result_id,
        MIN(d.over_no * 1000 + d.ball_no) AS first_idx
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.batter_id, d.result_id
    ),
    bat_pos_win AS (
      SELECT batter_id, result_id,
        RANK() OVER (PARTITION BY result_id ORDER BY first_idx) AS pos
      FROM bat_order_raw
    ),
    bat_pos AS (
      SELECT batter_id AS player_id,
        ROUND(AVG(pos), 1) AS avg_bat_pos,
        COUNT(*) AS pos_innings
      FROM bat_pos_win
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
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
        COUNT(d.dismissed_batter_id) AS wickets,
        SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) AS wide_count,
        SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) AS nb_count,
        SUM(CASE WHEN d.extras_type = 2 THEN d.runs_extra ELSE 0 END) AS wides,
        SUM(CASE WHEN d.extras_type = 1 THEN d.runs_extra ELSE 0 END) AS no_balls,
        SUM(CASE WHEN d.runs_bat = 0 AND d.runs_extra = 0 AND COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS dots
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      GROUP BY d.bowler_id, d.result_id
      UNION ALL
      SELECT mbw.player_id AS bowler_id, i.result_id, mbw.fixture_id,
        mbw.balls AS legal_balls, mbw.runs, mbw.wickets,
        mbw.wides AS wide_count, mbw.no_balls AS nb_count,
        mbw.wides, mbw.no_balls, 0 AS dots
      FROM manual_bowling mbw
      JOIN innings i ON i.fixture_id = mbw.fixture_id AND i.innings_order = mbw.innings_order
      JOIN relevant_fixtures rf ON rf.fixture_id = mbw.fixture_id
    ),
    bowling_over AS (
      SELECT d.bowler_id, d.result_id, d.over_no,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS over_runs,
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
        SUM(legal_balls) AS legal_balls_bowled,
        SUM(legal_balls + wide_count + nb_count) AS balls_bowled,
        SUM(runs) AS runs_conceded,
        SUM(wickets) AS wickets,
        SUM(wides) AS wides,
        SUM(no_balls) AS no_balls,
        SUM(dots) AS bowl_dot_balls
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
      -- Use wk_assignments as the sole authoritative source for keeper counts.
      -- player_flags.is_wk is raw ingest data and may be stale after a scorecard
      -- correction; autoPopulateRoles writes and refreshes wk_assignments on re-ingest.
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
        UNION ALL
        SELECT wa.player_id, wa.fixture_id FROM wk_assignments wa
        JOIN relevant_fixtures rf ON rf.fixture_id = wa.fixture_id
        UNION ALL
        SELECT pf.player_id, pf.fixture_id FROM player_flags pf
        JOIN relevant_fixtures rf ON rf.fixture_id = pf.fixture_id
      )
      GROUP BY player_id
    )
    SELECT
      p.player_id, p.name, p.team, p.is_sub,
      COALESCE(a.games_attended, 0)   AS games_attended,
      COALESCE(b.games_batted, 0)     AS games_batted,
      COALESCE(b.innings, 0)          AS innings,
      COALESCE(b.runs, 0)             AS runs,
      COALESCE(b.balls_faced, 0)      AS balls_faced,
      COALESCE(b.fours, 0)            AS fours,
      COALESCE(b.sixes, 0)            AS sixes,
      COALESCE(b.high_score, 0)       AS high_score,
      COALESCE(b.times_out, 0)        AS times_out,
      COALESCE(b.dot_balls, 0)        AS dot_balls,
      COALESCE(fl.captain_count, 0)   AS captain_count,
      COALESCE(wa.wk_count, 0)        AS wk_count,
      COALESCE(dc.dis_bowled, 0)      AS dis_bowled,
      COALESCE(dc.dis_caught, 0)      AS dis_caught,
      COALESCE(dc.dis_lbw, 0)         AS dis_lbw,
      COALESCE(dc.dis_runout, 0)      AS dis_runout,
      COALESCE(dc.dis_stumped, 0)     AS dis_stumped,
      COALESCE(bow.games_bowled, 0)   AS games_bowled,
      COALESCE(bow.legal_balls_bowled, 0) AS legal_balls_bowled,
      COALESCE(bow.balls_bowled, 0)   AS balls_bowled,
      COALESCE(bow.runs_conceded, 0)  AS runs_conceded,
      COALESCE(bow.wickets, 0)        AS wickets,
      COALESCE(bow.wides, 0)          AS wides,
      COALESCE(bow.no_balls, 0)       AS no_balls,
      COALESCE(bow.bowl_dot_balls, 0) AS bowl_dot_balls,
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
      COALESCE(dn.dnb_count, 0)       AS dnb_count,
      bp.avg_bat_pos
    FROM players_dn p
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
    LEFT JOIN bat_pos      bp ON bp.player_id = p.player_id
    WHERE ${whccCol('p.team')}
    ORDER BY p.name
  `).all(...yearParams, ...teamParams, ...accessParams, ...groupParams);

  const stats = rows.map(r => {
    const notOuts   = r.innings - r.times_out;
    const batAvg    = r.times_out > 0 ? (r.runs / r.times_out).toFixed(2) : null;
    const batSR     = r.balls_faced > 0 ? ((r.runs / r.balls_faced) * 100).toFixed(1) : null;
    const overs     = ballsToOvers(r.legal_balls_bowled);
    const bowlAvg   = r.wickets > 0 ? (r.runs_conceded / r.wickets).toFixed(2) : null;
    const bowlEcon  = r.legal_balls_bowled > 0 ? ((r.runs_conceded / r.legal_balls_bowled) * 6).toFixed(2) : null;
    const bowlSR    = r.wickets > 0 ? (r.legal_balls_bowled / r.wickets).toFixed(1) : null;
    const wktsPerOv  = r.legal_balls_bowled > 0 ? (r.wickets / (r.legal_balls_bowled / 6)).toFixed(2) : null;
    const avgMinutes    = r.innings_timed > 0 ? Math.round(r.total_minutes / r.innings_timed) : null;
    const batAvgPerGame = r.games_batted > 0 ? (r.runs / r.games_batted).toFixed(2) : null;
    return { ...r, not_outs: notOuts, bat_avg: batAvg, bat_sr: batSR, bat_avg_per_game: batAvgPerGame,
             overs, bowl_avg: bowlAvg, bowl_econ: bowlEcon, bowl_sr: bowlSR, wkts_per_over: wktsPerOv,
             avg_minutes: avgMinutes };
  });

  const years = db.prepare(`
    SELECT DISTINCT substr(f.match_date_iso, 1, 4) AS year
    FROM fixtures f
    WHERE ${whccFixtureWhere()} AND f.match_date_iso IS NOT NULL
    ORDER BY year DESC
  `).all().map(r => r.year);

  res.json({ players: stats, years });
});

// GET /api/players/partnerships?year=2025&team=whirlwind
router.get('/partnerships', (req, res) => {
  const db = getDb();
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const VALID_COMPS = ['cup', 'friendly', 'league'];
  const comp = VALID_COMPS.includes((req.query.comp || '').toLowerCase()) ? req.query.comp.toLowerCase() : null;

  const _yearExpr = yearExpr();
  const yearClause = year ? `AND ${_yearExpr} = ?` : '';
  const yearParams = year ? [year] : [];
  const { clause: teamClause, params: teamParams } = whccTeamClause(team);
  const compClause = comp === 'cup'      ? `AND lower(f.competition) LIKE '%cup%'`
                   : comp === 'friendly' ? `AND lower(f.competition) = 'friendly'`
                   : comp === 'league'   ? `AND (f.competition IS NULL OR (lower(f.competition) NOT LIKE '%cup%' AND lower(f.competition) != 'friendly'))`
                   : '';

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];
  const groupFilter  = buildGroupFilter(req);
  const groupClause  = groupFilter ? `AND (${groupFilter.sql})` : '';
  const groupParams  = groupFilter?.params ?? [];

  const rows = db.prepare(`
    WITH relevant_fixtures AS (
      SELECT f.fixture_id FROM fixtures f
      WHERE ${whccFixtureWhere()}
      ${yearClause}
      ${teamClause}
      ${compClause}
      ${accessClause}
      ${groupClause}
    ),
    stands AS (
      SELECT
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id ELSE d.batter_id_ns END AS p1_id,
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id_ns ELSE d.batter_id END AS p2_id,
        d.result_id,
        SUM(d.runs_bat) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE d.batter_id_ns IS NOT NULL
        AND ${whccCol('pb.team')}
      GROUP BY p1_id, p2_id, d.result_id
    ),
    agg AS (
      SELECT p1_id, p2_id,
        COUNT(*) AS stands,
        SUM(runs) AS total_runs,
        MAX(runs) AS best_stand,
        ROUND(CAST(SUM(runs) AS REAL) / COUNT(*), 1) AS avg_stand
      FROM stands
      GROUP BY p1_id, p2_id
    )
    SELECT agg.p1_id, agg.p2_id, agg.stands, agg.total_runs, agg.best_stand, agg.avg_stand,
      p1.name AS p1_name, p2.name AS p2_name
    FROM agg
    JOIN players_dn p1 ON p1.player_id = agg.p1_id
    JOIN players_dn p2 ON p2.player_id = agg.p2_id
    WHERE agg.stands >= 2 OR agg.total_runs >= 20
    ORDER BY agg.total_runs DESC
    LIMIT 50
  `).all(...yearParams, ...teamParams, ...accessParams, ...groupParams);

  res.json(rows);
});

// GET /api/players/unnamed — players in WHCC matches with placeholder/bogus names
router.get('/unnamed', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.player_id, p.name, p.display_name, p.team,
      GROUP_CONCAT(DISTINCT i.fixture_id) AS fixture_ids,
      COUNT(DISTINCT i.fixture_id) AS match_count,
      MAX(f.match_date) AS last_match_date,
      MAX(f.home_team || ' vs ' || f.away_team) AS last_fixture_label
    FROM players p
    JOIN (
      SELECT bowler_id AS pid, result_id FROM deliveries WHERE bowler_id IS NOT NULL
      UNION ALL
      SELECT batter_id AS pid, result_id FROM deliveries WHERE batter_id IS NOT NULL
    ) d ON d.pid = p.player_id
    JOIN innings i ON i.result_id = d.result_id
    JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE ${whccFixtureWhere()}
      AND (p.name IS NULL OR p.name = '' OR lower(p.name) LIKE 'unknown #%' OR p.name LIKE ': %')
      AND p.display_name IS NULL
      AND COALESCE(p.ignore_flag, 0) = 0
      AND (p.team IS NULL OR ${whccCol('p.team')})
    GROUP BY p.player_id
    ORDER BY p.name
  `).all();
  res.json(rows.map(r => ({
    ...r,
    fixture_ids: r.fixture_ids ? r.fixture_ids.split(',').map(Number) : [],
  })));
});

// GET /api/players/preferences — get user preferences (columns + favourite groups)
router.get('/preferences', (req, res) => {
  const db = getDb();
  const userId = getAuthContext(req).userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const pref = db.prepare(`SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`).get(userId);
  const columns         = pref ? JSON.parse(pref.player_list_columns) : ['MAT', 'INN', 'RUNS', 'AVG'];
  const favourite_groups = pref ? JSON.parse(pref.favourite_groups || '[]') : [];
  res.json({ columns, favourite_groups });
});

// POST /api/players/preferences — save user preferences (columns and/or favourite groups)
router.post('/preferences', (req, res) => {
  const db = getDb();
  const userId = getAuthContext(req).userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { columns, favourite_groups } = req.body;
  if (columns !== undefined && (!Array.isArray(columns) || columns.length === 0)) {
    return res.status(400).json({ error: 'Columns must be a non-empty array' });
  }
  if (favourite_groups !== undefined && !Array.isArray(favourite_groups)) {
    return res.status(400).json({ error: 'favourite_groups must be an array' });
  }

  const existing = db.prepare(`SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`).get(userId);
  const colJson  = columns          ? JSON.stringify(columns)          : (existing?.player_list_columns ?? '["MAT","INN","RUNS","AVG"]');
  const favJson  = favourite_groups ? JSON.stringify(favourite_groups) : (existing?.favourite_groups    ?? '[]');

  db.prepare(`
    INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(clerk_user_id) DO UPDATE SET
      player_list_columns = excluded.player_list_columns,
      favourite_groups    = excluded.favourite_groups,
      updated_at          = datetime('now')
  `).run(userId, colJson, favJson);

  res.json({ ok: true });
});

// PATCH /api/players/:id/name — set display_name for a player (requires canUpload)
router.patch('/:id/name', (req, res) => {
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      if (!claims?.metadata?.canUpload) return res.status(403).json({ error: 'Upload access not permitted' });
    } catch {
      return res.status(403).json({ error: 'Upload access not permitted' });
    }
  }
  const db = getDb();
  const playerId = Number(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(name, playerId);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ ok: true });
});

// PATCH /api/players/:id/ignore — hide a player from the unnamed panel (requires canUpload)
router.patch('/:id/ignore', (req, res) => {
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      if (!claims?.metadata?.canUpload) return res.status(403).json({ error: 'Upload access not permitted' });
    } catch {
      return res.status(403).json({ error: 'Upload access not permitted' });
    }
  }
  const db = getDb();
  const playerId = Number(req.params.id);
  const result = db.prepare(`UPDATE players SET ignore_flag = 1 WHERE player_id = ?`).run(playerId);
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
  res.json({ ok: true });
});

// GET /api/players/:id/batting?year=2025&team=hurricane
router.get('/:id/batting', (req, res) => {
  const db = getDb();
  const playerId = Number(req.params.id);
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId);
  if (player) player.name = player.display_name || player.name;

  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const _yearExpr = yearExpr();
  const yearClause = year ? `AND ${_yearExpr} = ?` : '';
  const yearParams = year ? [year] : [];
  const { clause: teamClause, params: teamParams } = whccTeamClause(team);

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];

  const allInnings = db.prepare(`
    SELECT
      i.fixture_id, i.innings_order, f.match_date, f.home_team, f.away_team,
      SUM(d.runs_bat) as runs,
      COUNT(*) as balls,
      SUM(CASE WHEN d.runs_bat = 4 THEN 1 ELSE 0 END) as fours,
      SUM(CASE WHEN d.runs_bat = 6 THEN 1 ELSE 0 END) as sixes,
      SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) as times_out,
      MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) as dismissed
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
    GROUP BY d.result_id
    ORDER BY f.match_date_iso DESC
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams);

  const years = [...new Set(allInnings.map(r => {
    if (!r.match_date) return null;
    const m = r.match_date.match(/^\d{4}/) || r.match_date.match(/\d{4}$/);
    return m ? m[0] : null;
  }).filter(Boolean))].sort((a, b) => b - a);

  // Dismissal counts: prefer PDF-sourced dismissals table, fall back to l_desc
  const dismissalCounts = {};
  const pdfDis = db.prepare(`
    SELECT dis.method, COUNT(*) as cnt FROM dismissals dis
    LEFT JOIN fixtures f ON f.fixture_id = dis.fixture_id
    WHERE dis.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
    GROUP BY dis.method
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams);
  for (const d of pdfDis) {
    const type = d.method === 'RunOut' ? 'Run out' : d.method;
    dismissalCounts[type] = (dismissalCounts[type] || 0) + d.cnt;
  }
  const pdfFixtures = new Set(db.prepare(`
    SELECT DISTINCT dis.fixture_id FROM dismissals dis
    LEFT JOIN fixtures f ON f.fixture_id = dis.fixture_id
    WHERE dis.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams).map(r => r.fixture_id));
  const lDescDis = db.prepare(`
    SELECT d.l_desc, i.fixture_id FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.dismissed_batter_id = ? ${yearClause} ${teamClause} ${accessClause}
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams);
  for (const d of lDescDis) {
    if (pdfFixtures.has(d.fixture_id)) continue;
    const type = classifyDismissal(d.l_desc);
    dismissalCounts[type] = (dismissalCounts[type] || 0) + 1;
  }

  const totals = allInnings.reduce((acc, r) => {
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

  const batPosRow = db.prepare(`
    WITH player_inns AS (
      SELECT DISTINCT d.result_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.batter_id = ? ${yearClause} ${teamClause}
    ),
    all_first AS (
      SELECT d.batter_id, d.result_id, MIN(d.over_no * 1000 + d.ball_no) AS first_idx
      FROM deliveries d
      WHERE d.result_id IN (SELECT result_id FROM player_inns)
      GROUP BY d.batter_id, d.result_id
    ),
    ranked AS (
      SELECT batter_id, result_id,
        RANK() OVER (PARTITION BY result_id ORDER BY first_idx) AS pos
      FROM all_first
    )
    SELECT ROUND(AVG(pos), 1) AS avg_bat_pos FROM ranked WHERE batter_id = ?
  `).get(playerId, ...yearParams, ...teamParams, ...accessParams, playerId);

  const fieldingRow = db.prepare(`
    SELECT
      SUM(CASE WHEN d.method = 'Caught' THEN 1 ELSE 0 END) AS catches,
      SUM(CASE WHEN d.method = 'Stumped' THEN 1 ELSE 0 END) AS stumpings,
      SUM(CASE WHEN d.method IN ('Run out','RunOut') THEN 1 ELSE 0 END) AS run_outs
    FROM dismissals d
    LEFT JOIN fixtures f ON f.fixture_id = d.fixture_id
    WHERE d.fielder_id = ? ${yearClause} ${teamClause} ${accessClause}
  `).get(playerId, ...yearParams, ...teamParams, ...accessParams);
  const fielding = {
    catches:   fieldingRow?.catches   || 0,
    stumpings: fieldingRow?.stumpings || 0,
    run_outs:  fieldingRow?.run_outs  || 0,
  };

  const rolesRow = db.prepare(`
    SELECT SUM(pf.is_captain) AS captain_count, SUM(pf.is_wk) AS wk_count
    FROM player_flags pf
    LEFT JOIN fixtures f ON f.fixture_id = pf.fixture_id
    WHERE pf.player_id = ? ${yearClause} ${teamClause} ${accessClause}
  `).get(playerId, ...yearParams, ...teamParams, ...accessParams);

  // Keeping stats via wk_assignments (authoritative source)
  const keepingRow = db.prepare(`
    SELECT
      COUNT(DISTINCT wa.fixture_id) AS matches,
      COALESCE(SUM(CASE WHEN di.method = 'Caught' AND di.fielder_id = ? THEN 1 ELSE 0 END), 0) AS catches,
      COALESCE(SUM(CASE WHEN di.method = 'Stumped' AND di.fielder_id = ? THEN 1 ELSE 0 END), 0) AS stumpings,
      COALESCE((
        SELECT SUM(d2.runs_extra)
        FROM deliveries d2
        JOIN innings i2 ON i2.result_id = d2.result_id
        JOIN wk_assignments wa2 ON wa2.fixture_id = i2.fixture_id AND wa2.player_id = ?
        WHERE d2.extras_type = 4
      ), 0) AS byes
    FROM wk_assignments wa
    LEFT JOIN fixtures f ON f.fixture_id = wa.fixture_id
    LEFT JOIN dismissals di ON di.fixture_id = wa.fixture_id AND di.fielder_id = ?
    WHERE wa.player_id = ? ${yearClause} ${teamClause} ${accessClause}
  `).get(playerId, playerId, playerId, playerId, playerId, ...yearParams, ...teamParams, ...accessParams);

  const keeping = {
    matches:   keepingRow?.matches   || 0,
    catches:   keepingRow?.catches   || 0,
    stumpings: keepingRow?.stumpings || 0,
    byes:      keepingRow?.byes      || 0,
  };

  res.json({ player, innings: allInnings, totals, dismissalCounts, years, avg_bat_pos: batPosRow?.avg_bat_pos ?? null, fielding, keeping, roles: { captain: rolesRow?.captain_count || 0, wk: rolesRow?.wk_count || 0 } });
});

// GET /api/players/:id/bowling?year=2025&team=hurricane
router.get('/:id/bowling', (req, res) => {
  const db = getDb();
  const playerId = Number(req.params.id);
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId);
  if (player) player.name = player.display_name || player.name;

  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null;
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning'];
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase()) ? req.query.team.toLowerCase() : null;
  const _yearExpr = yearExpr();
  const yearClause = year ? `AND ${_yearExpr} = ?` : '';
  const yearParams = year ? [year] : [];
  const { clause: teamClause, params: teamParams } = whccTeamClause(team);

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];

  // Fetch per-over stats so we can detect spell breaks (gap > 2 overs = new spell)
  const overRows = db.prepare(`
    SELECT
      i.result_id, i.fixture_id, i.innings_order, f.match_date, f.home_team, f.away_team,
      d.over_no,
      COUNT(CASE WHEN d.extras_type NOT IN (1,2) OR d.extras_type IS NULL THEN 1 END) as legal_balls,
      SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) as runs,
      COUNT(d.dismissed_batter_id) as wickets,
      SUM(CASE WHEN d.extras_type = 2 THEN d.runs_extra ELSE 0 END) as wides,
      SUM(CASE WHEN d.extras_type = 1 THEN d.runs_extra ELSE 0 END) as no_balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.bowler_id = ? ${yearClause} ${teamClause} ${accessClause}
    GROUP BY i.result_id, d.over_no
    ORDER BY f.match_date_iso ASC, i.innings_order ASC, d.over_no ASC
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams);

  const manualRows = db.prepare(`
    SELECT mbw.fixture_id, mbw.innings_order, f.match_date, f.home_team, f.away_team,
      mbw.balls as legal_balls, mbw.runs, mbw.wickets, mbw.wides, mbw.no_balls
    FROM manual_bowling mbw
    LEFT JOIN fixtures f ON f.fixture_id = mbw.fixture_id
    WHERE mbw.player_id = ? ${yearClause} ${teamClause} ${accessClause}
    ORDER BY f.match_date_iso ASC
  `).all(playerId, ...yearParams, ...teamParams, ...accessParams);

  // Group over rows into spells: a new spell starts when the gap between consecutive overs > 2
  // (bowlers alternate overs, so a continuous spell has gaps of exactly 2)
  const spells = [];
  let cur = null;
  for (const row of overRows) {
    if (!cur || cur.result_id !== row.result_id || row.over_no - cur.lastOver > 2) {
      cur = {
        result_id: row.result_id, fixture_id: row.fixture_id,
        innings_order: row.innings_order, match_date: row.match_date,
        home_team: row.home_team, away_team: row.away_team,
        legal_balls: 0, runs: 0, wickets: 0, wides: 0, no_balls: 0, lastOver: null,
      };
      spells.push(cur);
    }
    cur.legal_balls += row.legal_balls;
    cur.runs        += row.runs;
    cur.wickets     += row.wickets;
    cur.wides       += row.wides;
    cur.no_balls    += row.no_balls;
    cur.lastOver     = row.over_no;
  }
  for (const r of manualRows) {
    spells.push({
      fixture_id: r.fixture_id, innings_order: r.innings_order,
      match_date: r.match_date, home_team: r.home_team, away_team: r.away_team,
      legal_balls: r.legal_balls, runs: r.runs, wickets: r.wickets,
      wides: r.wides, no_balls: r.no_balls,
    });
  }
  // Sort descending by date for the response (over rows were fetched ascending for spell detection)
  spells.sort((a, b) => (b.match_date || '').localeCompare(a.match_date || ''));
  // Strip internal helper fields
  spells.forEach(s => { delete s.result_id; delete s.lastOver; });

  const years = [...new Set(spells.map(r => {
    if (!r.match_date) return null;
    const m = r.match_date.match(/^\d{4}/) || r.match_date.match(/\d{4}$/);
    return m ? m[0] : null;
  }).filter(Boolean))].sort((a, b) => b - a);

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

  res.json({ player, spells, totals, years });
});

// GET /api/players/:id/h2h — batting and bowling stats grouped by opponent
router.get('/:id/h2h', (req, res) => {
  const db = getDb();
  const playerId = Number(req.params.id);

  const whccExpr = whccFixtureWhere();

  const oppExpr = `CASE WHEN ${whccCol('f.home_team')}
    THEN f.away_team ELSE f.home_team END`;

  const accessFilter = buildAccessFilter(req);
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : '';
  const accessParams = accessFilter?.params ?? [];

  const batting = db.prepare(`
    WITH bat AS (
      SELECT i.fixture_id, SUM(d.runs_bat) AS runs,
        MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      WHERE d.batter_id = ?
      GROUP BY i.result_id
      UNION ALL
      SELECT mb.fixture_id, mb.runs, CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END AS dismissed
      FROM manual_batting mb
      WHERE mb.player_id = ? AND mb.did_not_bat = 0
    )
    SELECT ${oppExpr} AS opponent,
      COUNT(*) AS innings,
      SUM(bat.runs) AS runs,
      MAX(bat.runs) AS high_score,
      SUM(bat.dismissed) AS outs
    FROM bat
    JOIN fixtures f ON f.fixture_id = bat.fixture_id
    WHERE ${whccExpr} ${accessClause}
    GROUP BY opponent
    ORDER BY runs DESC
  `).all(playerId, playerId, ...accessParams);

  const bowling = db.prepare(`
    WITH bowl AS (
      SELECT i.fixture_id,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
        COUNT(d.dismissed_batter_id) AS wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      WHERE d.bowler_id = ?
      GROUP BY i.result_id
      UNION ALL
      SELECT mb.fixture_id, mb.balls AS legal_balls, mb.runs, mb.wickets
      FROM manual_bowling mb
      WHERE mb.player_id = ?
    )
    SELECT ${oppExpr} AS opponent,
      COUNT(*) AS spells,
      SUM(bowl.legal_balls) AS legal_balls,
      SUM(bowl.runs) AS runs,
      SUM(bowl.wickets) AS wickets
    FROM bowl
    JOIN fixtures f ON f.fixture_id = bowl.fixture_id
    WHERE ${whccExpr} ${accessClause}
    GROUP BY opponent
    ORDER BY wickets DESC
  `).all(playerId, playerId, ...accessParams);

  res.json({ batting, bowling });
});

module.exports = router;

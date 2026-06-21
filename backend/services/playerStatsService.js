'use strict'

const { ballsToOvers } = require('../utils/cricket')
const { whccTeamClause, yearExpr, getClubFilters } = require('../utils/db')
const { buildAccessFilter, buildGroupFilter } = require('../utils/access')
const { getAuthContext } = require('../middleware/auth')
const { parseComp, compClause } = require('../utils/competitionFilter')

function buildAccessClauses(req) {
  const accessFilter = buildAccessFilter(req)
  const groupFilter = buildGroupFilter(req)
  return {
    accessClause: accessFilter ? `AND (${accessFilter.sql})` : '',
    accessParams: accessFilter ? accessFilter.params : [],
    groupClause: groupFilter ? `AND (${groupFilter.sql})` : '',
    groupParams: groupFilter ? groupFilter.params : []
  }
}

function formatFilterClause(formatParam) {
  if (formatParam === 'pairs') return "AND f.format = 'pairs'"
  if (formatParam === 'no-pairs') return "AND COALESCE(f.format,'') != 'pairs'"
  return ''
}

function buildFilterClauses(db, req) {
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const comp = parseComp(req.query.comp)
  const formatClause = formatFilterClause(req.query.format)

  const _yearExpr = yearExpr()
  const yearClause = year ? `AND ${_yearExpr} = ?` : ''
  const yearParams = year ? [year] : []
  const { clause: teamClause, params: teamParams } = whccTeamClause(team)
  const { clause: compFilter } = compClause(comp)

  const { accessClause, accessParams, groupClause, groupParams } = buildAccessClauses(req)

  const clubId = getAuthContext(req).clubId
  const clubFilters = getClubFilters(db, clubId != null ? clubId : null)

  return {
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
  }
}

function queryCombinedStats(db, req) {
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
  } = buildFilterClauses(db, req)

  const rows = db
    .prepare(
      `
    WITH
    relevant_fixtures AS (
      SELECT f.fixture_id FROM fixtures f
      WHERE ${clubFilters.fixtureWhere}
      ${yearClause}
      ${teamClause}
      ${compFilter}
      ${formatClause}
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
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS wickets,
        SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) AS wide_count,
        SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) AS nb_count,
        SUM(CASE WHEN d.extras_type = 2 THEN d.runs_extra ELSE 0 END) AS wides,
        SUM(CASE WHEN d.extras_type = 1 THEN d.runs_extra ELSE 0 END) AS no_balls,
        SUM(CASE WHEN d.runs_bat = 0 AND d.runs_extra = 0 AND COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS dots
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
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
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS over_wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN relevant_fixtures rf ON rf.fixture_id = i.fixture_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
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
      SELECT wka.player_id, COUNT(DISTINCT wka.fixture_id) AS wk_count
      FROM wk_assignments wka
      JOIN relevant_fixtures rf ON rf.fixture_id = wka.fixture_id
      GROUP BY wka.player_id
    ),
    minutes_inn AS (
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
      p.player_id, p.name, p.team, p.is_sub, p.jersey_number AS jerseyNumber,
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
    WHERE ${clubFilters.playerWhere('p')}
    ORDER BY p.name
  `
    )
    .all(
      ...clubFilters.fixtureParams,
      ...yearParams,
      ...teamParams,
      ...accessParams,
      ...groupParams
    )

  return rows.map((r) => {
    const notOuts = r.innings - r.times_out
    const batAvg = r.times_out > 0 ? (r.runs / r.times_out).toFixed(2) : null
    const batSR = r.balls_faced > 0 ? ((r.runs / r.balls_faced) * 100).toFixed(1) : null
    const overs = ballsToOvers(r.legal_balls_bowled)
    const bowlAvg = r.wickets > 0 ? (r.runs_conceded / r.wickets).toFixed(2) : null
    const bowlEcon =
      r.legal_balls_bowled > 0 ? ((r.runs_conceded / r.legal_balls_bowled) * 6).toFixed(2) : null
    const bowlSR = r.wickets > 0 ? (r.legal_balls_bowled / r.wickets).toFixed(1) : null
    const wktsPerOv =
      r.legal_balls_bowled > 0 ? (r.wickets / (r.legal_balls_bowled / 6)).toFixed(2) : null
    const avgMinutes = r.innings_timed > 0 ? Math.round(r.total_minutes / r.innings_timed) : null
    const batAvgPerGame = r.games_batted > 0 ? (r.runs / r.games_batted).toFixed(2) : null
    return {
      ...r,
      not_outs: notOuts,
      bat_avg: batAvg,
      bat_sr: batSR,
      bat_avg_per_game: batAvgPerGame,
      overs,
      bowl_avg: bowlAvg,
      bowl_econ: bowlEcon,
      bowl_sr: bowlSR,
      wkts_per_over: wktsPerOv,
      avg_minutes: avgMinutes
    }
  })
}

function getYears(db, clubId = null) {
  const { fixtureWhere, fixtureParams } = getClubFilters(db, clubId)
  return db
    .prepare(
      `SELECT DISTINCT substr(f.match_date_iso, 1, 4) AS year
    FROM fixtures f
    WHERE ${fixtureWhere} AND f.match_date_iso IS NOT NULL
    ORDER BY year DESC`
    )
    .all(...fixtureParams)
    .map((r) => r.year)
}

const BATTING_KEYS = [
  'player_id',
  'name',
  'team',
  'is_sub',
  'games_attended',
  'games_batted',
  'innings',
  'runs',
  'balls_faced',
  'fours',
  'sixes',
  'high_score',
  'times_out',
  'dot_balls',
  'captain_count',
  'wk_count',
  'dis_bowled',
  'dis_caught',
  'dis_lbw',
  'dis_runout',
  'dis_stumped',
  'not_outs',
  'bat_avg',
  'bat_sr',
  'bat_avg_per_game',
  'avg_bat_pos',
  'total_minutes',
  'innings_timed',
  'avg_minutes',
  'dnb_count'
]

const BOWLING_KEYS = [
  'player_id',
  'name',
  'team',
  'is_sub',
  'games_attended',
  'games_bowled',
  'legal_balls_bowled',
  'balls_bowled',
  'runs_conceded',
  'wickets',
  'wides',
  'no_balls',
  'bowl_dot_balls',
  'maidens',
  'wicket_maidens',
  'three_fers',
  'four_fers',
  'five_fers',
  'six_fers',
  'wkt_bowled',
  'wkt_caught',
  'wkt_lbw',
  'wkt_stumped',
  'overs',
  'bowl_avg',
  'bowl_econ',
  'bowl_sr',
  'wkts_per_over'
]

function pickKeys(row, keys) {
  return Object.fromEntries(keys.map((k) => [k, row[k]]))
}

module.exports = {
  queryCombinedStats,
  getYears,
  BATTING_KEYS,
  BOWLING_KEYS,
  pickKeys
}

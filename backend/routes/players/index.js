'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { classifyDismissal } = require('../../utils/cricket')
const { yearExpr, whccTeamClause, getClubFilters } = require('../../utils/db')
const { buildAccessFilter, buildGroupFilter } = require('../../utils/access')
const { getAuthContext, requireUpload } = require('../../middleware/auth')
const { withEtag } = require('../../middleware/cacheHeaders')
const playerStatsService = require('../../services/playerStatsService')

// GET /api/players/names
router.get('/names', (req, res) => {
  const db = getDb()
  const { playerWhere, playerParams } = getClubFilters(db, getAuthContext(req).clubId ?? null)
  const names = db
    .prepare(
      `SELECT COALESCE(display_name, name) AS name FROM players
      WHERE ${playerWhere('players')}
      ORDER BY name`
    )
    .all(...playerParams)
    .map((r) => r.name)
  res.json(names)
})

// GET /api/players
router.get('/', (req, res) => {
  const db = getDb()
  const players = db.prepare(`SELECT * FROM players ORDER BY name`).all()
  res.json(players)
})

// GET /api/players/stats — combined batting + bowling stats
router.get('/stats', withEtag('players-stats'), (req, res) => {
  const db = getDb()
  const clubId = getAuthContext(req).clubId ?? null
  const stats = playerStatsService.queryCombinedStats(db, req)
  const years = playerStatsService.getYears(db, clubId)
  res.json({ players: stats, years })
})

// GET /api/players/stats/batting — batting-only subset
router.get('/stats/batting', withEtag('players-stats'), (req, res) => {
  const db = getDb()
  const clubId = getAuthContext(req).clubId ?? null
  const all = playerStatsService.queryCombinedStats(db, req)
  const years = playerStatsService.getYears(db, clubId)
  const players = all.map((r) => playerStatsService.pickKeys(r, playerStatsService.BATTING_KEYS))
  res.json({ players, years })
})

// GET /api/players/stats/bowling — bowling-only subset
router.get('/stats/bowling', withEtag('players-stats'), (req, res) => {
  const db = getDb()
  const clubId = getAuthContext(req).clubId ?? null
  const all = playerStatsService.queryCombinedStats(db, req)
  const years = playerStatsService.getYears(db, clubId)
  const players = all.map((r) => playerStatsService.pickKeys(r, playerStatsService.BOWLING_KEYS))
  res.json({ players, years })
})

// GET /api/players/partnerships
router.get('/partnerships', (req, res) => {
  const db = getDb()
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const { parseComp, compClause } = require('../../utils/competitionFilter')
  const comp = parseComp(req.query.comp)

  const _yearExpr = yearExpr()
  const yearClause = year ? `AND ${_yearExpr} = ?` : ''
  const yearParams = year ? [year] : []
  const { clause: teamClause, params: teamParams } = whccTeamClause(team)
  const { clause: compFilter } = compClause(comp)

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []
  const groupFilter = buildGroupFilter(req)
  const groupClause = groupFilter ? `AND (${groupFilter.sql})` : ''
  const groupParams = groupFilter?.params ?? []

  const { fixtureWhere, fixtureParams, playerWhere } = getClubFilters(
    db,
    getAuthContext(req).clubId ?? null
  )

  const rows = db
    .prepare(
      `
    WITH relevant_fixtures AS (
      SELECT f.fixture_id FROM fixtures f
      WHERE ${fixtureWhere}
      ${yearClause}
      ${teamClause}
      ${compFilter}
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
        AND ${playerWhere('pb')}
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
  `
    )
    .all(...fixtureParams, ...yearParams, ...teamParams, ...accessParams, ...groupParams)

  res.json(rows)
})

// GET /api/players/unnamed
router.get('/unnamed', (req, res) => {
  const db = getDb()
  const { fixtureWhere, fixtureParams, playerWhere } = getClubFilters(
    db,
    getAuthContext(req).clubId ?? null
  )
  const rows = db
    .prepare(
      `
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
    WHERE ${fixtureWhere}
      AND (p.name IS NULL OR p.name = '' OR lower(p.name) LIKE 'unknown #%' OR p.name LIKE ': %')
      AND p.display_name IS NULL
      AND COALESCE(p.ignore_flag, 0) = 0
      AND (p.team IS NULL OR ${playerWhere('p')})
    GROUP BY p.player_id
    ORDER BY p.name
  `
    )
    .all(...fixtureParams)
  res.json(
    rows.map((r) => ({
      ...r,
      fixture_ids: r.fixture_ids ? r.fixture_ids.split(',').map(Number) : []
    }))
  )
})

// GET /api/players/preferences
router.get('/preferences', (req, res) => {
  const db = getDb()
  const userId = getAuthContext(req).userId
  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  const pref = db
    .prepare(
      `SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`
    )
    .get(userId)
  const columns = pref ? JSON.parse(pref.player_list_columns) : ['MAT', 'INN', 'RUNS', 'AVG']
  const favourite_groups = pref ? JSON.parse(pref.favourite_groups || '[]') : []
  res.json({ columns, favourite_groups })
})

// POST /api/players/preferences
router.post('/preferences', (req, res) => {
  const db = getDb()
  const userId = getAuthContext(req).userId
  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  const { columns, favourite_groups } = req.body
  if (columns !== undefined && (!Array.isArray(columns) || columns.length === 0)) {
    return res.status(400).json({ error: 'Columns must be a non-empty array' })
  }
  if (favourite_groups !== undefined && !Array.isArray(favourite_groups)) {
    return res.status(400).json({ error: 'favourite_groups must be an array' })
  }

  const existing = db
    .prepare(
      `SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`
    )
    .get(userId)
  const colJson = columns
    ? JSON.stringify(columns)
    : (existing?.player_list_columns ?? '["MAT","INN","RUNS","AVG"]')
  const favJson = favourite_groups
    ? JSON.stringify(favourite_groups)
    : (existing?.favourite_groups ?? '[]')

  db.prepare(
    `INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(clerk_user_id) DO UPDATE SET
      player_list_columns = excluded.player_list_columns,
      favourite_groups    = excluded.favourite_groups,
      updated_at          = datetime('now')`
  ).run(userId, colJson, favJson)

  res.json({ ok: true })
})

// PATCH /api/players/:id/name
router.patch('/:id/name', (req, res) => {
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '')
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
      if (!claims?.metadata?.canUpload)
        return res.status(403).json({ error: 'Upload access not permitted' })
    } catch {
      return res.status(403).json({ error: 'Upload access not permitted' })
    }
  }
  const db = getDb()
  const playerId = Number(req.params.id)
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name required' })
  const result = db
    .prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`)
    .run(name, playerId)
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' })
  res.json({ ok: true })
})

// PATCH /api/players/:id/jersey-number
router.patch('/:id/jersey-number', requireUpload, (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  const raw = req.body?.jersey_number
  const jerseyNumber = raw === null || raw === '' ? null : Number(raw)
  if (jerseyNumber !== null && (isNaN(jerseyNumber) || jerseyNumber < 0 || jerseyNumber > 999))
    return res.status(400).json({ error: 'Jersey number must be 0–999' })
  const result = db
    .prepare(`UPDATE players SET jersey_number = ? WHERE player_id = ?`)
    .run(jerseyNumber, playerId)
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' })
  res.json({ ok: true })
})

// PATCH /api/players/:id/ignore
router.patch('/:id/ignore', (req, res) => {
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '')
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
      if (!claims?.metadata?.canUpload)
        return res.status(403).json({ error: 'Upload access not permitted' })
    } catch {
      return res.status(403).json({ error: 'Upload access not permitted' })
    }
  }
  const db = getDb()
  const playerId = Number(req.params.id)
  const result = db.prepare(`UPDATE players SET ignore_flag = 1 WHERE player_id = ?`).run(playerId)
  if (result.changes === 0) return res.status(404).json({ error: 'Player not found' })
  res.json({ ok: true })
})

// GET /api/players/:id/batting
router.get('/:id/batting', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId)
  if (player) player.name = player.display_name || player.name

  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const _yearExpr = yearExpr()
  const yearClause = year ? `AND ${_yearExpr} = ?` : ''
  const yearParams = year ? [year] : []
  const { clause: teamClause, params: teamParams } = whccTeamClause(team)

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []

  const allInnings = db
    .prepare(
      `
    SELECT
      i.fixture_id, i.innings_order, f.match_date, f.match_date_iso, f.home_team, f.away_team,
      SUM(d.runs_bat) as runs,
      COUNT(*) as balls,
      SUM(CASE WHEN d.runs_bat = 4 THEN 1 ELSE 0 END) as fours,
      SUM(CASE WHEN d.runs_bat = 6 THEN 1 ELSE 0 END) as sixes,
      SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) as times_out,
      MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) as dismissed,
      0 as did_not_bat
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    WHERE d.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
    GROUP BY d.result_id
    UNION ALL
    SELECT
      mb.fixture_id, mb.innings_order, f.match_date, f.match_date_iso, f.home_team, f.away_team,
      mb.runs, mb.balls as balls, mb.fours, mb.sixes,
      CASE WHEN mb.not_out = 0 AND mb.did_not_bat = 0 THEN 1 ELSE 0 END as times_out,
      CASE WHEN mb.not_out = 0 AND mb.did_not_bat = 0 THEN 1 ELSE 0 END as dismissed,
      mb.did_not_bat
    FROM manual_batting mb
    LEFT JOIN fixtures f ON f.fixture_id = mb.fixture_id
    WHERE mb.player_id = ? ${yearClause} ${teamClause} ${accessClause}
    ORDER BY match_date_iso DESC
  `
    )
    .all(
      playerId,
      ...yearParams,
      ...teamParams,
      ...accessParams,
      playerId,
      ...yearParams,
      ...teamParams,
      ...accessParams
    )

  const years = [
    ...new Set(
      allInnings
        .map((r) => {
          if (!r.match_date) return null
          const m = r.match_date.match(/^\d{4}/) || r.match_date.match(/\d{4}$/)
          return m ? m[0] : null
        })
        .filter(Boolean)
    )
  ].sort((a, b) => b - a)

  const dismissalCounts = {}
  const pdfDis = db
    .prepare(
      `SELECT dis.method, COUNT(*) as cnt FROM dismissals dis
      LEFT JOIN fixtures f ON f.fixture_id = dis.fixture_id
      WHERE dis.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
      GROUP BY dis.method`
    )
    .all(playerId, ...yearParams, ...teamParams, ...accessParams)
  for (const d of pdfDis) {
    const type = d.method === 'RunOut' ? 'Run out' : d.method
    dismissalCounts[type] = (dismissalCounts[type] || 0) + d.cnt
  }
  const pdfFixtures = new Set(
    db
      .prepare(
        `SELECT DISTINCT dis.fixture_id FROM dismissals dis
        LEFT JOIN fixtures f ON f.fixture_id = dis.fixture_id
        WHERE dis.batter_id = ? ${yearClause} ${teamClause} ${accessClause}`
      )
      .all(playerId, ...yearParams, ...teamParams, ...accessParams)
      .map((r) => r.fixture_id)
  )
  const lDescDis = db
    .prepare(
      `SELECT d.l_desc, i.fixture_id FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.dismissed_batter_id = ? ${yearClause} ${teamClause} ${accessClause}`
    )
    .all(playerId, ...yearParams, ...teamParams, ...accessParams)
  for (const d of lDescDis) {
    if (pdfFixtures.has(d.fixture_id)) continue
    const type = classifyDismissal(d.l_desc)
    dismissalCounts[type] = (dismissalCounts[type] || 0) + 1
  }

  const totals = allInnings.reduce(
    (acc, r) => {
      if (r.did_not_bat) {
        acc.dnb++
        return acc
      }
      acc.innings++
      acc.runs += r.runs
      acc.balls += r.balls
      acc.fours += r.fours
      acc.sixes += r.sixes
      if (!r.dismissed) acc.notOuts++
      if (r.runs > acc.highScore) acc.highScore = r.runs
      return acc
    },
    { innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0, notOuts: 0, highScore: 0, dnb: 0 }
  )

  const outs = totals.innings - totals.notOuts
  totals.average = outs > 0 ? (totals.runs / outs).toFixed(2) : 'N/A'
  totals.strikeRate = totals.balls > 0 ? ((totals.runs / totals.balls) * 100).toFixed(1) : 'N/A'

  const batPosRow = db
    .prepare(
      `WITH player_inns AS (
        SELECT DISTINCT d.result_id
        FROM deliveries d
        JOIN innings i ON i.result_id = d.result_id
        LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
        WHERE d.batter_id = ? ${yearClause} ${teamClause} ${accessClause}
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
      SELECT ROUND(AVG(pos), 1) AS avg_bat_pos FROM ranked WHERE batter_id = ?`
    )
    .get(playerId, ...yearParams, ...teamParams, ...accessParams, playerId)

  const fieldingRow = db
    .prepare(
      `SELECT
        SUM(CASE WHEN d.method = 'Caught' THEN 1 ELSE 0 END) AS catches,
        SUM(CASE WHEN d.method = 'Stumped' THEN 1 ELSE 0 END) AS stumpings,
        SUM(CASE WHEN d.method IN ('Run out','RunOut') THEN 1 ELSE 0 END) AS run_outs
      FROM dismissals d
      LEFT JOIN fixtures f ON f.fixture_id = d.fixture_id
      WHERE d.fielder_id = ? ${yearClause} ${teamClause} ${accessClause}`
    )
    .get(playerId, ...yearParams, ...teamParams, ...accessParams)
  const fielding = {
    catches: fieldingRow?.catches || 0,
    stumpings: fieldingRow?.stumpings || 0,
    run_outs: fieldingRow?.run_outs || 0
  }

  const rolesRow = db
    .prepare(
      `SELECT SUM(pf.is_captain) AS captain_count, SUM(pf.is_wk) AS wk_count
      FROM player_flags pf
      LEFT JOIN fixtures f ON f.fixture_id = pf.fixture_id
      WHERE pf.player_id = ? ${yearClause} ${teamClause} ${accessClause}`
    )
    .get(playerId, ...yearParams, ...teamParams, ...accessParams)

  const keepingRow = db
    .prepare(
      `SELECT
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
      WHERE wa.player_id = ? ${yearClause} ${teamClause} ${accessClause}`
    )
    .get(
      playerId,
      playerId,
      playerId,
      playerId,
      playerId,
      ...yearParams,
      ...teamParams,
      ...accessParams
    )

  const keeping = {
    matches: keepingRow?.matches || 0,
    catches: keepingRow?.catches || 0,
    stumpings: keepingRow?.stumpings || 0,
    byes: keepingRow?.byes || 0
  }

  res.json({
    player,
    innings: allInnings,
    totals,
    dismissalCounts,
    years,
    avg_bat_pos: batPosRow?.avg_bat_pos ?? null,
    fielding,
    keeping,
    roles: { captain: rolesRow?.captain_count || 0, wk: rolesRow?.wk_count || 0 }
  })
})

// GET /api/players/:id/bowling
router.get('/:id/bowling', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  const player = db.prepare(`SELECT * FROM players WHERE player_id = ?`).get(playerId)
  if (player) player.name = player.display_name || player.name

  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const _yearExpr = yearExpr()
  const yearClause = year ? `AND ${_yearExpr} = ?` : ''
  const yearParams = year ? [year] : []
  const { clause: teamClause, params: teamParams } = whccTeamClause(team)

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []

  const overRows = db
    .prepare(
      `SELECT
        i.result_id, i.fixture_id, i.innings_order, f.match_date, f.match_date_iso, f.home_team, f.away_team,
        d.over_no,
        COUNT(CASE WHEN d.extras_type NOT IN (1,2) OR d.extras_type IS NULL THEN 1 END) as legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) as runs,
        COUNT(d.dismissed_batter_id) as wickets,
        SUM(CASE WHEN d.extras_type = 2 THEN d.runs_extra ELSE 0 END) as wides,
        SUM(CASE WHEN d.extras_type = 1 THEN d.runs_extra ELSE 0 END) as no_balls,
        SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) as wide_count,
        SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) as nb_count
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.bowler_id = ? ${yearClause} ${teamClause} ${accessClause}
      GROUP BY i.result_id, d.over_no
      ORDER BY f.match_date_iso ASC, i.innings_order ASC, d.over_no ASC`
    )
    .all(playerId, ...yearParams, ...teamParams, ...accessParams)

  const manualRows = db
    .prepare(
      `SELECT mbw.fixture_id, mbw.innings_order, f.match_date, f.match_date_iso, f.home_team, f.away_team,
        mbw.balls as legal_balls, mbw.runs, mbw.wickets, mbw.wides, mbw.no_balls
      FROM manual_bowling mbw
      LEFT JOIN fixtures f ON f.fixture_id = mbw.fixture_id
      WHERE mbw.player_id = ? ${yearClause} ${teamClause} ${accessClause}
      ORDER BY f.match_date_iso ASC`
    )
    .all(playerId, ...yearParams, ...teamParams, ...accessParams)

  const spells = []
  let cur = null
  for (const row of overRows) {
    if (!cur || cur.result_id !== row.result_id || row.over_no - cur.lastOver > 2) {
      cur = {
        result_id: row.result_id,
        fixture_id: row.fixture_id,
        innings_order: row.innings_order,
        match_date: row.match_date,
        match_date_iso: row.match_date_iso,
        home_team: row.home_team,
        away_team: row.away_team,
        legal_balls: 0,
        runs: 0,
        wickets: 0,
        wides: 0,
        no_balls: 0,
        wide_count: 0,
        nb_count: 0,
        lastOver: null
      }
      spells.push(cur)
    }
    cur.legal_balls += row.legal_balls
    cur.runs += row.runs
    cur.wickets += row.wickets
    cur.wides += row.wides
    cur.no_balls += row.no_balls
    cur.wide_count += row.wide_count
    cur.nb_count += row.nb_count
    cur.lastOver = row.over_no
  }
  for (const r of manualRows) {
    spells.push({
      fixture_id: r.fixture_id,
      innings_order: r.innings_order,
      match_date: r.match_date,
      match_date_iso: r.match_date_iso,
      home_team: r.home_team,
      away_team: r.away_team,
      legal_balls: r.legal_balls,
      runs: r.runs,
      wickets: r.wickets,
      wides: r.wides,
      no_balls: r.no_balls,
      wide_count: r.wides,
      nb_count: r.no_balls
    })
  }
  spells.sort((a, b) => (b.match_date_iso || '').localeCompare(a.match_date_iso || ''))
  spells.forEach((s) => {
    delete s.result_id
    delete s.lastOver
  })

  const years = [
    ...new Set(
      spells
        .map((r) => {
          if (!r.match_date) return null
          const m = r.match_date.match(/^\d{4}/) || r.match_date.match(/\d{4}$/)
          return m ? m[0] : null
        })
        .filter(Boolean)
    )
  ].sort((a, b) => b - a)

  const totals = spells.reduce(
    (acc, r) => {
      acc.balls += r.legal_balls
      acc.runs += r.runs
      acc.wickets += r.wickets
      acc.wides += r.wides
      acc.noBalls += r.no_balls
      if (r.wickets > acc.bestWickets || (r.wickets === acc.bestWickets && r.runs < acc.bestRuns)) {
        acc.bestWickets = r.wickets
        acc.bestRuns = r.runs
      }
      return acc
    },
    { balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, bestWickets: 0, bestRuns: 999 }
  )

  totals.overs = `${Math.floor(totals.balls / 6)}.${totals.balls % 6}`
  totals.average = totals.wickets > 0 ? (totals.runs / totals.wickets).toFixed(2) : 'N/A'
  totals.economy = totals.balls > 0 ? ((totals.runs / totals.balls) * 6).toFixed(2) : 'N/A'
  totals.best = totals.bestWickets > 0 ? `${totals.bestWickets}/${totals.bestRuns}` : '-'

  res.json({ player, spells, totals, years })
})

// GET /api/players/:id/h2h
router.get('/:id/h2h', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)

  const {
    fixtureWhere: whccExpr,
    fixtureParams: h2hClubParams,
    colWhere
  } = getClubFilters(db, getAuthContext(req).clubId ?? null)
  const oppExpr = `CASE WHEN ${colWhere('f.home_team')} THEN f.away_team ELSE f.home_team END`

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []

  const batting = db
    .prepare(
      `WITH bat AS (
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
      ORDER BY runs DESC`
    )
    .all(playerId, playerId, ...h2hClubParams, ...accessParams)

  const bowling = db
    .prepare(
      `WITH bowl AS (
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
      ORDER BY wickets DESC`
    )
    .all(playerId, playerId, ...h2hClubParams, ...accessParams)

  res.json({ batting, bowling })
})

// GET /api/players/:id/series
// Per-match batting and bowling data for performance charts. Includes highlight flags.
router.get('/:id/series', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)

  const player = db
    .prepare(
      `SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id = ?`
    )
    .get(playerId)

  // Batting per fixture (aggregate all innings in the same match)
  const batDeliveries = db
    .prepare(
      `SELECT
        i.fixture_id,
        f.match_date_iso, f.home_team, f.away_team, f.competition,
        SUM(d.runs_bat) AS runs,
        COUNT(*) AS balls,
        MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.batter_id = ?
      GROUP BY i.fixture_id`
    )
    .all(playerId)

  const batManual = db
    .prepare(
      `SELECT
        mb.fixture_id,
        f.match_date_iso, f.home_team, f.away_team, f.competition,
        SUM(mb.runs) AS runs,
        SUM(mb.balls) AS balls,
        MAX(CASE WHEN mb.not_out = 0 AND mb.did_not_bat = 0 THEN 1 ELSE 0 END) AS dismissed
      FROM manual_batting mb
      LEFT JOIN fixtures f ON f.fixture_id = mb.fixture_id
      WHERE mb.player_id = ? AND mb.did_not_bat = 0
      GROUP BY mb.fixture_id`
    )
    .all(playerId)

  // Bowling per fixture
  const bowlDeliveries = db
    .prepare(
      `SELECT
        i.fixture_id,
        f.match_date_iso, f.home_team, f.away_team, f.competition,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
        COUNT(d.dismissed_batter_id) AS wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.bowler_id = ?
      GROUP BY i.fixture_id`
    )
    .all(playerId)

  const bowlManual = db
    .prepare(
      `SELECT
        mbw.fixture_id,
        f.match_date_iso, f.home_team, f.away_team, f.competition,
        SUM(mbw.balls) AS legal_balls,
        SUM(mbw.runs) AS runs,
        SUM(mbw.wickets) AS wickets
      FROM manual_bowling mbw
      LEFT JOIN fixtures f ON f.fixture_id = mbw.fixture_id
      WHERE mbw.player_id = ?
      GROUP BY mbw.fixture_id`
    )
    .all(playerId)

  // Keeping (byes) per fixture when player was wicket-keeper
  const keepingRows = db
    .prepare(
      `SELECT
        wa.fixture_id,
        f.match_date_iso, f.home_team, f.away_team, f.competition,
        COALESCE(SUM(CASE WHEN d.extras_type = 3 THEN d.runs_extra ELSE 0 END), 0) AS byes
      FROM wk_assignments wa
      JOIN innings i ON i.fixture_id = wa.fixture_id AND i.innings_order = wa.innings_order
      JOIN deliveries d ON d.result_id = i.result_id
      LEFT JOIN fixtures f ON f.fixture_id = wa.fixture_id
      WHERE wa.player_id = ?
        AND d.over_no BETWEEN COALESCE(wa.from_over - 1, 0) AND COALESCE(wa.to_over - 1, 999999)
      GROUP BY wa.fixture_id`
    )
    .all(playerId)

  const highlights = db
    .prepare(`SELECT fixture_id, note FROM player_match_highlights WHERE player_id = ?`)
    .all(playerId)
  const highlightMap = new Map(highlights.map((h) => [h.fixture_id, h.note ?? null]))

  // Merge all data keyed by fixture_id
  const matchMap = new Map()

  function getOrCreate(row) {
    if (!matchMap.has(row.fixture_id)) {
      matchMap.set(row.fixture_id, {
        fixture_id: row.fixture_id,
        match_date_iso: row.match_date_iso,
        home_team: row.home_team,
        away_team: row.away_team,
        competition: row.competition,
        bat_runs: null,
        bat_balls: null,
        bat_dismissed: null,
        bowl_legal_balls: null,
        bowl_runs: null,
        bowl_wickets: null,
        keep_byes: null,
        highlighted: false,
        highlight_note: null
      })
    }
    return matchMap.get(row.fixture_id)
  }

  for (const r of [...batDeliveries, ...batManual]) {
    const m = getOrCreate(r)
    if (m.bat_runs === null) {
      m.bat_runs = r.runs
      m.bat_balls = r.balls
      m.bat_dismissed = r.dismissed === 1
    } else {
      m.bat_runs += r.runs
      m.bat_balls += r.balls
      m.bat_dismissed = m.bat_dismissed || r.dismissed === 1
    }
  }

  for (const r of [...bowlDeliveries, ...bowlManual]) {
    const m = getOrCreate(r)
    if (m.bowl_legal_balls === null) {
      m.bowl_legal_balls = r.legal_balls
      m.bowl_runs = r.runs
      m.bowl_wickets = r.wickets
    } else {
      m.bowl_legal_balls += r.legal_balls
      m.bowl_runs += r.runs
      m.bowl_wickets += r.wickets
    }
  }

  for (const r of keepingRows) {
    const m = getOrCreate(r)
    m.keep_byes = (m.keep_byes ?? 0) + r.byes
  }

  for (const [fixtureId, note] of highlightMap) {
    const m = matchMap.get(fixtureId)
    if (m) {
      m.highlighted = true
      m.highlight_note = note
    }
  }

  const matches = [...matchMap.values()].sort((a, b) =>
    (a.match_date_iso || '').localeCompare(b.match_date_iso || '')
  )

  res.json({ player, matches })
})

// POST /api/players/:id/highlights
router.post('/:id/highlights', (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.canUpload && !ctx.isSuperAdmin && !ctx.isClubAdmin)
    return res.status(403).json({ error: 'Upload permission required' })

  const db = getDb()
  const playerId = Number(req.params.id)
  const { fixture_id, note } = req.body || {}
  if (!fixture_id) return res.status(400).json({ error: 'fixture_id required' })

  db.prepare(
    `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, fixture_id) DO UPDATE SET note = excluded.note, clerk_user_id = excluded.clerk_user_id, tagged_at = datetime('now')`
  ).run(playerId, fixture_id, note || null, ctx.userId || null)

  res.json({ ok: true })
})

// DELETE /api/players/:id/highlights/:fixtureId
router.delete('/:id/highlights/:fixtureId', (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.canUpload && !ctx.isSuperAdmin && !ctx.isClubAdmin)
    return res.status(403).json({ error: 'Upload permission required' })

  const db = getDb()
  const playerId = Number(req.params.id)
  const fixtureId = req.params.fixtureId

  db.prepare(`DELETE FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`).run(
    playerId,
    fixtureId
  )
  res.json({ ok: true })
})

module.exports = router

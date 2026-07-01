'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { getClubFilters } = require('../../utils/db')
const { getAuthContext, requireUpload } = require('../../middleware/auth')
const { withEtag } = require('../../middleware/cacheHeaders')
const playerStatsService = require('../../services/playerStatsService')
const playerDetailService = require('../../services/playerDetailService')
const topTrumpsService = require('../../services/topTrumpsService')

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

// GET /api/players/top-trumps — all-player Top Trumps ratings
router.get('/top-trumps', withEtag('players-top-trumps'), (req, res) => {
  const db = getDb()
  const clubId = getAuthContext(req).clubId ?? null
  const players = topTrumpsService.computeTopTrumps(db, req)
  const years = playerStatsService.getYears(db, clubId)
  res.json({ players, years })
})

// GET /api/players/partnerships
router.get('/partnerships', (req, res) => {
  const db = getDb()
  const rows = playerDetailService.queryPartnerships(db, req)
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
  const result = playerDetailService.queryBatting(db, req)
  res.json(result)
})

// GET /api/players/:id/bowling
router.get('/:id/bowling', (req, res) => {
  const db = getDb()
  const result = playerDetailService.queryBowling(db, req)
  res.json(result)
})

// GET /api/players/:id/fielding — per-match fielding contributions
router.get('/:id/fielding', (req, res) => {
  const db = getDb()
  const result = playerDetailService.queryFielding(db, req)
  res.json(result)
})

// GET /api/players/:id/h2h
router.get('/:id/h2h', (req, res) => {
  const db = getDb()
  const result = playerDetailService.queryH2h(db, req)
  res.json(result)
})

// GET /api/players/:id/top-trumps — single-player Top Trumps card
router.get('/:id/top-trumps', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  const all = topTrumpsService.computeTopTrumps(db, req)
  const player = all.find((p) => p.player_id === playerId)
  if (!player) return res.status(404).json({ error: 'Player not found or no data' })
  res.json(player)
})

// GET /api/players/:id/series
// Per-match batting and bowling data for performance charts. Includes highlight flags.
router.get('/:id/series', (req, res) => {
  const db = getDb()
  const result = playerDetailService.querySeries(db, req)
  res.json(result)
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

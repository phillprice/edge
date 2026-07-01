'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { isOurTeam, ourCol } = require('../../utils/db')
const { validateBody, validateParams, z } = require('../../utils/validate')
const { canManageUsers } = require('./shared')

const playerIdParams = z.object({ id: z.coerce.number().int() })
const patchPlayerSchema = z
  .object({
    display_name: z.string().optional(),
    is_sub: z.boolean().optional(),
    ignore_flag: z.boolean().optional()
  })
  .refine((b) => 'display_name' in b || 'is_sub' in b || 'ignore_flag' in b, {
    message: 'At least one of display_name, is_sub, or ignore_flag is required'
  })

// PATCH /api/admin/player/:id
router.patch(
  '/player/:id',
  validateParams(playerIdParams),
  validateBody(patchPlayerSchema),
  (req, res) => {
    const db = getDb()
    const playerId = req.params.id

    const exists = db.prepare('SELECT 1 FROM players WHERE player_id = ?').get(playerId)
    if (!exists) {
      const fixture = db
        .prepare(
          `SELECT f.home_team, f.away_team FROM deliveries d
          JOIN innings i ON i.result_id = d.result_id
          JOIN fixtures f ON f.fixture_id = i.fixture_id
          WHERE d.batter_id = ? OR d.bowler_id = ?
          LIMIT 1`
        )
        .get(playerId, playerId)
      const team = fixture
        ? isOurTeam(fixture.home_team)
          ? fixture.home_team
          : isOurTeam(fixture.away_team)
            ? fixture.away_team
            : null
        : null
      db.prepare(`INSERT OR IGNORE INTO players (player_id, name, team) VALUES (?, ?, ?)`).run(
        playerId,
        `Player #${playerId}`,
        team
      )
    }

    if ('display_name' in req.body) {
      const val =
        typeof req.body.display_name === 'string' ? req.body.display_name.trim() || null : null
      db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(val, playerId)
    }
    if ('is_sub' in req.body) {
      db.prepare(`UPDATE players SET is_sub = ? WHERE player_id = ?`).run(
        req.body.is_sub ? 1 : 0,
        playerId
      )
    }
    if ('ignore_flag' in req.body) {
      db.prepare(`UPDATE players SET ignore_flag = ? WHERE player_id = ?`).run(
        req.body.ignore_flag ? 1 : 0,
        playerId
      )
    }
    res.json({ ok: true })
  }
)

// GET /api/admin/duplicate-players
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
  const isOurs = `(p.team IS NULL OR ${ourCol('p.team')})`
  const rows = db
    .prepare(
      `SELECT p.player_id, COALESCE(p.display_name, p.name) AS effective_name,
        p.name, p.display_name, p.team,
        COUNT(DISTINCT d.pid) AS appearances
      FROM players p
      LEFT JOIN (
        SELECT batter_id AS pid, result_id FROM deliveries WHERE batter_id IS NOT NULL
        UNION ALL
        SELECT bowler_id AS pid, result_id FROM deliveries WHERE bowler_id IS NOT NULL
      ) d ON d.pid = p.player_id
      WHERE lower(COALESCE(p.display_name, p.name)) IN (
        SELECT lower(COALESCE(display_name, name))
        FROM players
        WHERE COALESCE(display_name, name) IS NOT NULL AND COALESCE(display_name, name) != ''
          AND COALESCE(ignore_flag, 0) = 0
          AND (team IS NULL OR ${ourCol('team')})
        GROUP BY lower(COALESCE(display_name, name))
        HAVING COUNT(*) > 1
      )
      AND COALESCE(p.ignore_flag, 0) = 0
      AND ${isOurs}
      GROUP BY p.player_id
      ORDER BY lower(effective_name), appearances DESC`
    )
    .all()

  const groups = {}
  for (const r of rows) {
    const key = r.effective_name.toLowerCase()
    if (!groups[key]) groups[key] = { name: r.effective_name, players: [] }
    groups[key].players.push({
      player_id: r.player_id,
      name: r.name,
      display_name: r.display_name,
      team: r.team,
      appearances: r.appearances
    })
  }
  res.json(Object.values(groups))
})

const mergePlayersSchema = z.object({
  keepId: z.number().int(),
  dropId: z.number().int()
})

// POST /api/admin/merge-players
router.post('/merge-players', validateBody(mergePlayersSchema), (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const keep = req.body.keepId
  const drop = req.body.dropId
  if (keep === drop) return res.status(400).json({ error: 'Invalid player IDs' })

  const db = getDb()
  try {
    db.transaction(() => {
      db.prepare(`UPDATE deliveries SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET batter_id_ns = ? WHERE batter_id_ns = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET dismissed_batter_id = ? WHERE dismissed_batter_id = ?`).run(
        keep,
        drop
      )
      db.prepare(`UPDATE dismissals SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET fielder_id = ? WHERE fielder_id = ?`).run(keep, drop)
      for (const tbl of ['player_flags', 'manual_batting', 'manual_bowling']) {
        db.prepare(`UPDATE OR IGNORE ${tbl} SET player_id = ? WHERE player_id = ?`).run(keep, drop)
        db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(drop)
      }
      db.prepare(`UPDATE wk_assignments SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE wk_errors SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE match_captains SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`DELETE FROM players WHERE player_id = ?`).run(drop)
    })()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router

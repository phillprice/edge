'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { getAuthContext } = require('../../middleware/auth')
const { canManageUsers } = require('./shared')

// Resolve the club name for a given team_id (super admin) or club_id (club admin).
// Returns null if the club cannot be found.
function resolveClubName(db, ctx, teamId) {
  if (ctx.isSuperAdmin) {
    const row = db
      .prepare(
        'SELECT c.name FROM watched_teams wt JOIN clubs c ON c.club_id = wt.club_id WHERE wt.team_id = ? LIMIT 1'
      )
      .get(teamId)
    return row ? row.name : null
  }
  const row = db.prepare('SELECT name FROM clubs WHERE club_id = ?').get(ctx.clubId)
  return row ? row.name : null
}

// Parse the first team_id:season_id pair from ?groups= (jersey editing is single-team).
function parseFirstGroupPair(groupsRaw) {
  const tok = groupsRaw ? groupsRaw.split(',')[0] : ''
  const [t, s] = (tok || '').split(':').map(Number)
  const teamId = Number.isFinite(t) && t > 0 ? t : 0
  const seasonId = Number.isFinite(s) && s > 0 ? s : 0
  return { teamId, seasonId }
}

// GET /api/admin/players — list club players with jersey numbers, filtered by team+season.
// Uses fixture_seasons to scope to the selected season; club-name prefix excludes opposition.
function adminGetPlayers(req, res) {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const ctx = getAuthContext(req)
  const db = getDb()
  const { teamId, seasonId } = parseFirstGroupPair(req.query.groups)
  if (!teamId || !seasonId) return res.json([])

  const clubName = resolveClubName(db, ctx, teamId)
  if (!clubName) return res.json([])

  const rows = db
    .prepare(
      `SELECT DISTINCT p.player_id AS playerId,
              COALESCE(p.display_name, p.name) AS name,
              p.jersey_number AS jerseyNumber
       FROM players p
       WHERE p.team LIKE ?
         AND p.player_id IN (
           SELECT d.batter_id FROM deliveries d
           JOIN innings i ON i.result_id = d.result_id
           JOIN fixture_seasons fs ON fs.fixture_id = i.fixture_id
           WHERE fs.team_id = ? AND fs.season_id = ?
           UNION
           SELECT d.bowler_id FROM deliveries d
           JOIN innings i ON i.result_id = d.result_id
           JOIN fixture_seasons fs ON fs.fixture_id = i.fixture_id
           WHERE fs.team_id = ? AND fs.season_id = ?
         )
       ORDER BY COALESCE(p.display_name, p.name) COLLATE NOCASE`
    )
    .all(`${clubName} - %`, teamId, seasonId, teamId, seasonId)
  res.json(rows)
}
router.get('/players', adminGetPlayers)

// PATCH /api/admin/players/jerseys — bulk-update jersey numbers [{playerId, jerseyNumber}]
router.patch('/players/jerseys', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const updates = req.body
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'Body must be an array' })

  const db = getDb()
  const stmt = db.prepare(`UPDATE players SET jersey_number = ? WHERE player_id = ?`)
  const run = db.transaction(() => {
    for (const { playerId, jerseyNumber } of updates) {
      const num = jerseyNumber === null || jerseyNumber === '' ? null : Number(jerseyNumber)
      if (num !== null && (isNaN(num) || num < 0 || num > 999)) continue
      stmt.run(num, playerId)
    }
  })
  run()
  res.json({ ok: true })
})

module.exports = router

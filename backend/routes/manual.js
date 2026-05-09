const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')

function oversToLegalBalls(oversStr) {
  const parts = String(oversStr || '0').split('.')
  const full = parseInt(parts[0]) || 0
  const rem  = Math.min(parseInt(parts[1]) || 0, 5)
  return full * 6 + rem
}

function findOrCreatePlayer(db, name, team) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const existing = db.prepare(`SELECT player_id FROM players WHERE name = ? COLLATE NOCASE`).get(trimmed)
  if (existing) return existing.player_id
  const result = db.prepare(`INSERT INTO players (name, team) VALUES (?, ?)`).run(trimmed, team || '')
  return result.lastInsertRowid
}

// GET /api/manual/players
router.get('/players', (req, res) => {
  const db = getDb()
  const players = db.prepare(`
    SELECT player_id, name, team FROM players
    WHERE lower(team) LIKE '%woking%' OR lower(team) LIKE '%horsell%'
       OR lower(team) LIKE '%whirlwind%' OR lower(team) LIKE '%hurricane%'
    ORDER BY name
  `).all()
  res.json(players)
})

// GET /api/manual/fixtures — WHCC fixtures with manual-entry status
router.get('/fixtures', (req, res) => {
  const db = getDb()
  const fixtures = db.prepare(`
    SELECT f.fixture_id, f.match_date, f.home_team, f.away_team, f.format,
      (SELECT COUNT(*) FROM innings i JOIN deliveries d ON d.result_id = i.result_id
       WHERE i.fixture_id = f.fixture_id) AS delivery_count,
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id) AS manual_bat_count,
      (SELECT COUNT(*) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) AS manual_bowl_count
    FROM fixtures f
    WHERE (lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
        OR lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%'
        OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%'
        OR lower(f.away_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%hurricane%')
    ORDER BY f.match_date DESC
  `).all()
  res.json(fixtures)
})

// POST /api/manual/fixture — create a new manual fixture
router.post('/fixture', (req, res) => {
  const db = getDb()
  const { match_date, home_team, away_team, ground, format, starting_score } = req.body
  if (!match_date || !home_team || !away_team) {
    return res.status(400).json({ error: 'match_date, home_team and away_team are required' })
  }
  const fixture_id = `manual-${Date.now()}`
  db.prepare(`
    INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(fixture_id, match_date, home_team, away_team, ground || '', format || 'standard', starting_score || 0)
  res.json({ fixture_id })
})

// GET /api/manual/entry/:fixtureId
router.get('/entry/:fixtureId', (req, res) => {
  const db = getDb()
  const { fixtureId } = req.params
  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Not found' })

  const batting = db.prepare(`
    SELECT mb.*, p.name FROM manual_batting mb
    JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `).all(fixtureId)

  const bowling = db.prepare(`
    SELECT mb.*, p.name FROM manual_bowling mb
    JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `).all(fixtureId)

  res.json({ fixture, batting, bowling })
})

// PUT /api/manual/entry/:fixtureId — save/replace manual stats
router.put('/entry/:fixtureId', (req, res) => {
  const db = getDb()
  const { fixtureId } = req.params
  const { batting, bowling } = req.body

  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  const hasDeliveries = db.prepare(`
    SELECT 1 FROM innings i JOIN deliveries d ON d.result_id = i.result_id
    WHERE i.fixture_id = ? LIMIT 1
  `).get(fixtureId)
  if (hasDeliveries) {
    return res.status(409).json({ error: 'This fixture already has scorecard data — manual entry blocked to prevent duplication' })
  }

  const defaultTeam = [fixture.home_team, fixture.away_team]
    .find(t => /woking|horsell|whirlwind|hurricane/i.test(t)) || ''

  db.transaction(() => {
    // Ensure innings records exist for batting (order 1) and bowling (order 2)
    for (const order of [1, 2]) {
      const exists = db.prepare(`SELECT 1 FROM innings WHERE fixture_id = ? AND innings_order = ?`).get(fixtureId, order)
      if (!exists) db.prepare(`INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)`).run(fixtureId, order)
    }

    // Replace batting
    db.prepare(`DELETE FROM manual_batting WHERE fixture_id = ?`).run(fixtureId)
    const insertBat = db.prepare(`
      INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, fours, sixes, not_out, how_out)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of (batting || [])) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      insertBat.run(fixtureId, pid, row.runs || 0, row.balls || 0, row.fours || 0, row.sixes || 0, row.not_out ? 1 : 0, row.how_out || null)
    }

    // Replace bowling
    db.prepare(`DELETE FROM manual_bowling WHERE fixture_id = ?`).run(fixtureId)
    const insertBowl = db.prepare(`
      INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
      VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of (bowling || [])) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      const balls = oversToLegalBalls(row.overs)
      insertBowl.run(fixtureId, pid, balls, row.maidens || 0, row.wicket_maidens || 0, row.runs || 0, row.wickets || 0, row.wides || 0, row.no_balls || 0)
    }
  })()

  res.json({ ok: true })
})

module.exports = router

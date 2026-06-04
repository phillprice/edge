const express = require('express')
const router = express.Router()
const { apiLimiter } = require('../middleware/rateLimit')
router.use(apiLimiter)
const { getDb } = require('../db/schema')
const { oversToLegalBalls } = require('../utils/cricket')
const { isWhccTeam, whccCol } = require('../utils/db')

function findOrCreatePlayer(db, name, team) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const existing = db.prepare(`SELECT player_id FROM players WHERE name = ? COLLATE NOCASE`).get(trimmed)
  if (existing) return existing.player_id
  const result = db.prepare(`INSERT INTO players (name, team) VALUES (?, ?)`).run(trimmed, team || '')
  return result.lastInsertRowid
}

// POST /api/manual/player  { name }  — create or find a player by name
router.post('/player', (req, res) => {
  const db = getDb()
  const { name } = req.body
  const trimmed = (name || '').trim()
  if (!trimmed) return res.status(400).json({ error: 'name is required' })
  const player_id = findOrCreatePlayer(db, trimmed, '')
  res.json({ player_id, name: trimmed })
})

// GET /api/manual/players
router.get('/players', (req, res) => {
  const db = getDb()
  const players = db.prepare(`
    SELECT player_id, COALESCE(display_name, name) AS name, team FROM players
    WHERE ${whccCol('team')}
    ORDER BY COALESCE(display_name, name)
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
    WHERE f.fixture_id LIKE 'manual-%'
    ORDER BY f.match_date DESC
  `).all()
  res.json(fixtures)
})

// POST /api/manual/fixture — create a new manual fixture
router.post('/fixture', (req, res) => {
  const db = getDb()
  const { match_date, home_team, away_team, ground, format, starting_score, competition, team_id, season_id } = req.body
  if (!match_date || !home_team || !away_team) {
    return res.status(400).json({ error: 'match_date, home_team and away_team are required' })
  }
  const fixture_id = `manual-${Date.now()}`
  db.prepare(`
    INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fixture_id, match_date, home_team, away_team, ground || '', format || 'standard', starting_score || 0, competition || '')
  // Associate to a watched team+season so scoped (non-super-admin) users can see it.
  if (team_id !== null && season_id !== null) {
    db.prepare('INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)')
      .run(fixture_id, Number(team_id), Number(season_id))
  }
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
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `).all(fixtureId)

  const bowling = db.prepare(`
    SELECT mb.*, p.name FROM manual_bowling mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `).all(fixtureId)

  const extras = db.prepare(`SELECT batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs FROM manual_extras WHERE fixture_id = ?`).get(fixtureId)

  const captainRow = db.prepare(`SELECT p.name FROM match_captains mc JOIN players_dn p ON p.player_id = mc.player_id WHERE mc.fixture_id = ? AND mc.innings_order = 1`).get(fixtureId)
  const wkRow      = db.prepare(`SELECT p.name FROM wk_assignments wa JOIN players_dn p ON p.player_id = wa.player_id WHERE wa.fixture_id = ? AND wa.innings_order = 2 ORDER BY wa.from_over LIMIT 1`).get(fixtureId)

  const fielding = db.prepare(`
    SELECT mf.*, p.name FROM manual_fielding mf
    JOIN players_dn p ON p.player_id = mf.player_id
    WHERE mf.fixture_id = ? ORDER BY mf.id
  `).all(fixtureId)

  // Current team+season association (drives the access filter; lets the UI pre-fill the picker)
  const association = db.prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ? LIMIT 1').get(fixtureId) ?? null

  res.json({ fixture, association, batting, bowling, fielding, batting_extras: extras?.batting_extras ?? 0, bowling_byes: extras?.bowling_byes ?? 0, bowling_leg_byes: extras?.bowling_leg_byes ?? 0, whcc_overs: extras?.whcc_overs ?? null, opp_overs: extras?.opp_overs ?? null, captain_name: captainRow?.name ?? null, wk_name: wkRow?.name ?? null })
})

// PUT /api/manual/entry/:fixtureId — save/replace manual stats
router.put('/entry/:fixtureId', (req, res) => {
  const db = getDb()
  const { fixtureId } = req.params
  const { batting, bowling, fielding, batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs, captain_name, wk_name, team_id, season_id, competition, format, ground } = req.body

  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  // Update editable fixture metadata when included in the save payload.
  if (competition !== undefined || format !== undefined || ground !== undefined) {
    const sets = []
    const vals = []
    if (competition !== undefined) { sets.push('competition = ?'); vals.push(competition || null) }
    if (format      !== undefined) { sets.push('format = ?');      vals.push(format      || null) }
    if (ground      !== undefined) { sets.push('ground = ?');      vals.push(ground      || null) }
    db.prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE fixture_id = ?`).run(...vals, fixtureId)
  }

  // Set/replace the team+season association (drives access for scoped users).
  if (team_id !== null && season_id !== null) {
    db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(fixtureId)
    db.prepare('INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)')
      .run(fixtureId, Number(team_id), Number(season_id))
  }

  const hasDeliveries = db.prepare(`
    SELECT 1 FROM innings i JOIN deliveries d ON d.result_id = i.result_id
    WHERE i.fixture_id = ? LIMIT 1
  `).get(fixtureId)
  if (hasDeliveries) {
    return res.status(409).json({ error: 'This fixture already has scorecard data — manual entry blocked to prevent duplication' })
  }

  const defaultTeam = [fixture.home_team, fixture.away_team]
    .find(isWhccTeam) || ''

  db.transaction(() => {
    // Ensure innings records exist for batting (order 1) and bowling (order 2)
    for (const order of [1, 2]) {
      const exists = db.prepare(`SELECT 1 FROM innings WHERE fixture_id = ? AND innings_order = ?`).get(fixtureId, order)
      if (!exists) db.prepare(`INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)`).run(fixtureId, order)
    }

    // Captain (innings 1 = WHCC batting)
    const captainPid = captain_name ? findOrCreatePlayer(db, captain_name, defaultTeam) : null
    if (captainPid) {
      db.prepare(`INSERT INTO match_captains (fixture_id, innings_order, player_id) VALUES (?, 1, ?)
        ON CONFLICT(fixture_id, innings_order) DO UPDATE SET player_id = excluded.player_id`).run(fixtureId, captainPid)
    } else {
      db.prepare(`DELETE FROM match_captains WHERE fixture_id = ? AND innings_order = 1`).run(fixtureId)
    }

    // WK (innings 2 = WHCC fielding)
    const wkPid = wk_name ? findOrCreatePlayer(db, wk_name, defaultTeam) : null
    db.prepare(`DELETE FROM wk_assignments WHERE fixture_id = ? AND innings_order = 2`).run(fixtureId)
    if (wkPid) {
      db.prepare(`INSERT INTO wk_assignments (fixture_id, innings_order, player_id, from_over) VALUES (?, 2, ?, 1)`).run(fixtureId, wkPid)
    }

    // Replace batting
    db.prepare(`DELETE FROM manual_batting WHERE fixture_id = ?`).run(fixtureId)
    const insertBat = db.prepare(`
      INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, fours, sixes, not_out, how_out, did_not_bat, times_out)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of (batting || [])) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      const dnb = row.did_not_bat ? 1 : 0
      insertBat.run(fixtureId, pid, dnb ? 0 : (row.runs || 0), dnb ? 0 : (row.balls || 0), dnb ? 0 : (row.fours || 0), dnb ? 0 : (row.sixes || 0), dnb ? 0 : (row.not_out ? 1 : 0), dnb ? null : (row.how_out || null), dnb, row.times_out || 0)
    }

    // Save extras
    db.prepare(`INSERT INTO manual_extras (fixture_id, batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET batting_extras = excluded.batting_extras, bowling_byes = excluded.bowling_byes, bowling_leg_byes = excluded.bowling_leg_byes, whcc_overs = excluded.whcc_overs, opp_overs = excluded.opp_overs`
    ).run(fixtureId, batting_extras || 0, bowling_byes || 0, bowling_leg_byes || 0, whcc_overs || null, opp_overs || null)

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

    // Replace fielding
    db.prepare(`DELETE FROM manual_fielding WHERE fixture_id = ?`).run(fixtureId)
    const insertField = db.prepare(`
      INSERT INTO manual_fielding (fixture_id, innings_order, player_id, catches, stumpings, run_outs)
      VALUES (?, 2, ?, ?, ?, ?)
    `)
    for (const row of (fielding || [])) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      insertField.run(fixtureId, pid, row.catches || 0, row.stumpings || 0, row.run_outs || 0)
    }
  })()

  // Invalidate and recompute caches for this fixture
  try {
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(fixtureId)
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(fixtureId)
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(fixtureId)
    require('../utils/matchSummary').computeAndCacheManualStats(db, fixtureId)
  } catch (e) {
    console.error(`[manual] cache update failed for ${fixtureId}:`, e.message)
  }

  res.json({ ok: true })
})

module.exports = router

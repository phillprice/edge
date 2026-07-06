const crypto = require('crypto')
const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')
const { oversToLegalBalls, toIsoDate } = require('../utils/cricket')
const { isOurTeam, ourCol } = require('../utils/db')
const { invalidateFixtureCaches } = require('../utils/cacheInvalidation')
const { validateBody, validateParams, z } = require('../utils/validate')
const { getAuthContext } = require('../middleware/auth')
const { VALID_TAGS, syncFixtureTags, tagsFromCompetition } = require('../utils/tags')

function findOrCreatePlayer(db, name, team) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const existing = db
    .prepare(`SELECT player_id FROM players WHERE name = ? COLLATE NOCASE`)
    .get(trimmed)
  if (existing) return existing.player_id
  const result = db
    .prepare(`INSERT INTO players (name, team) VALUES (?, ?)`)
    .run(trimmed, team || '')
  return result.lastInsertRowid
}

// POST /api/manual/player  { name }  — create or find a player by name
const playerSchema = z.object({ name: z.string().min(1, 'name is required') })

router.post('/player', validateBody(playerSchema), (req, res) => {
  const db = getDb()
  const { name } = req.body
  const trimmed = name.trim()
  const player_id = findOrCreatePlayer(db, trimmed, '')
  res.json({ player_id, name: trimmed })
})

// GET /api/manual/players
router.get('/players', (req, res) => {
  const db = getDb()
  const players = db
    .prepare(
      `
    SELECT player_id, COALESCE(display_name, name) AS name, team FROM players
    WHERE ${ourCol('team')}
    ORDER BY COALESCE(display_name, name)
  `
    )
    .all()
  res.json(players)
})

// GET /api/manual/fixtures — manual fixtures scoped to the caller's club
router.get('/fixtures', (req, res) => {
  const { isSuperAdmin, clubId } = getAuthContext(req)
  const db = getDb()

  const scoped = !isSuperAdmin && clubId != null
  const clubFilter = scoped
    ? `AND (
        EXISTS (
          SELECT 1 FROM fixture_seasons fs
          JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
          WHERE fs.fixture_id = f.fixture_id AND wt.club_id = ?
        )
        OR NOT EXISTS (SELECT 1 FROM fixture_seasons WHERE fixture_id = f.fixture_id)
      )`
    : ''

  const fixtures = db
    .prepare(
      `
    SELECT f.fixture_id, f.match_date, f.home_team, f.away_team, f.format,
      f.starting_score, f.balls_per_over, f.wide_runs, f.wide_rebowl,
      f.no_ball_runs, f.no_ball_rebowl, f.overs_per_pair, f.pairs_wicket_penalty,
      (SELECT COUNT(*) FROM innings i JOIN deliveries d ON d.result_id = i.result_id
       WHERE i.fixture_id = f.fixture_id) AS delivery_count,
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id) AS manual_bat_count,
      (SELECT COUNT(*) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) AS manual_bowl_count
    FROM fixtures f
    WHERE f.fixture_id LIKE 'manual-%'
    ${clubFilter}
    ORDER BY f.match_date DESC
  `
    )
    .all(...(scoped ? [Number(clubId)] : []))
  res.json(fixtures)
})

const REBOWL_OPTIONS = ['always', 'last_over', 'last_ball', 'never']

const fixtureSchema = z.object({
  match_date: z.string().min(1, 'match_date is required'),
  home_team: z.string().min(1, 'home_team is required'),
  away_team: z.string().min(1, 'away_team is required'),
  ground: z.string().optional().default(''),
  format: z.enum(['standard', 'pairs', 't20', 'declaration']).optional().default('standard'),
  starting_score: z.number().int().min(0).optional().default(0),
  balls_per_over: z.number().int().min(1).max(12).optional().default(6),
  wide_runs: z.number().int().min(0).max(10).optional().default(1),
  wide_rebowl: z.enum(REBOWL_OPTIONS).optional().default('always'),
  no_ball_runs: z.number().int().min(0).max(10).optional().default(1),
  no_ball_rebowl: z.enum(REBOWL_OPTIONS).optional().default('always'),
  overs_per_pair: z.number().int().min(1).nullable().optional().default(null),
  pairs_wicket_penalty: z.number().int().min(0).optional().default(5),
  retire_on_runs: z.number().int().min(1).nullable().optional().default(null),
  retire_on_balls: z.number().int().min(1).nullable().optional().default(null),
  competition: z.string().optional().default(''),
  match_type: z
    .enum(['league', 'cup', 'internal', 'indoor', 'friendly'])
    .optional()
    .default('league'),
  tags: z.array(z.enum(['league', 'cup', 'internal', 'indoor', 'friendly'])).optional(),
  team_id: z.number().int().nullable().optional(),
  season_id: z.number().int().nullable().optional()
})

// POST /api/manual/fixture — create a new manual fixture
router.post('/fixture', validateBody(fixtureSchema), (req, res) => {
  const db = getDb()
  const {
    match_date,
    home_team,
    away_team,
    ground,
    format,
    starting_score,
    balls_per_over,
    wide_runs,
    wide_rebowl,
    no_ball_runs,
    no_ball_rebowl,
    overs_per_pair,
    pairs_wicket_penalty,
    retire_on_runs,
    retire_on_balls,
    competition,
    match_type,
    tags,
    team_id,
    season_id
  } = req.body
  const fixture_id = `manual-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const match_date_iso = toIsoDate(match_date) || null
  // Derive tags: explicit tags[] take priority, else single match_type, else competition name
  const resolvedTags =
    tags ??
    (match_type && match_type !== 'league' ? [match_type] : null) ??
    tagsFromCompetition(competition)
  const primaryTag = resolvedTags.find((t) => t !== 'league') ?? 'league'
  db.prepare(
    `
    INSERT INTO fixtures (fixture_id, match_date, match_date_iso, home_team, away_team, ground,
      format, starting_score, balls_per_over, wide_runs, wide_rebowl,
      no_ball_runs, no_ball_rebowl, overs_per_pair, pairs_wicket_penalty,
      retire_on_runs, retire_on_balls, competition, match_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    fixture_id,
    match_date,
    match_date_iso,
    home_team,
    away_team,
    ground || '',
    format || 'standard',
    starting_score ?? 0,
    balls_per_over ?? 6,
    wide_runs ?? 1,
    wide_rebowl ?? 'always',
    no_ball_runs ?? 1,
    no_ball_rebowl ?? 'always',
    overs_per_pair ?? null,
    pairs_wicket_penalty ?? 5,
    retire_on_runs ?? null,
    retire_on_balls ?? null,
    competition || '',
    primaryTag
  )
  syncFixtureTags(db, fixture_id, resolvedTags)
  // Associate to a watched team+season so scoped (non-super-admin) users can see it.
  if (team_id !== null && season_id !== null) {
    db.prepare(
      'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
    ).run(fixture_id, Number(team_id), Number(season_id))
  }
  res.json({ fixture_id })
})

// GET /api/manual/entry/:fixtureId
router.get('/entry/:fixtureId', (req, res) => {
  const db = getDb()
  const { fixtureId } = req.params
  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Not found' })

  const batting = db
    .prepare(
      `
    SELECT mb.*, p.name FROM manual_batting mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `
    )
    .all(fixtureId)

  const bowling = db
    .prepare(
      `
    SELECT mb.*, p.name FROM manual_bowling mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? ORDER BY mb.id
  `
    )
    .all(fixtureId)

  const extras = db
    .prepare(
      `SELECT batting_extras, bowling_byes, bowling_leg_byes, our_overs, opp_overs FROM manual_extras WHERE fixture_id = ?`
    )
    .get(fixtureId)

  const captainRow = db
    .prepare(
      `SELECT p.name FROM match_captains mc JOIN players_dn p ON p.player_id = mc.player_id WHERE mc.fixture_id = ? AND mc.innings_order = 1`
    )
    .get(fixtureId)
  const wkRow = db
    .prepare(
      `SELECT p.name FROM wk_assignments wa JOIN players_dn p ON p.player_id = wa.player_id WHERE wa.fixture_id = ? AND wa.innings_order = 2 ORDER BY wa.from_over LIMIT 1`
    )
    .get(fixtureId)

  const fielding = db
    .prepare(
      `
    SELECT mf.*, p.name FROM manual_fielding mf
    JOIN players_dn p ON p.player_id = mf.player_id
    WHERE mf.fixture_id = ? ORDER BY mf.id
  `
    )
    .all(fixtureId)

  // Current team+season association (drives the access filter; lets the UI pre-fill the picker)
  const association =
    db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ? LIMIT 1')
      .get(fixtureId) ?? null

  res.json({
    fixture,
    association,
    batting,
    bowling,
    fielding,
    batting_extras: extras?.batting_extras ?? 0,
    bowling_byes: extras?.bowling_byes ?? 0,
    bowling_leg_byes: extras?.bowling_leg_byes ?? 0,
    our_overs: extras?.our_overs ?? null,
    opp_overs: extras?.opp_overs ?? null,
    captain_name: captainRow?.name ?? null,
    wk_name: wkRow?.name ?? null
  })
})

const battingRowSchema = z.object({
  player_name: z.string(),
  runs: z.coerce.number().optional(),
  balls: z.coerce.number().optional(),
  fours: z.coerce.number().optional(),
  sixes: z.coerce.number().optional(),
  not_out: z.union([z.boolean(), z.number()]).optional(),
  how_out: z.string().nullable().optional(),
  did_not_bat: z.union([z.boolean(), z.number()]).optional(),
  times_out: z.coerce.number().optional()
})

const bowlingRowSchema = z.object({
  player_name: z.string(),
  overs: z.union([z.string(), z.number()]).optional(),
  maidens: z.coerce.number().optional(),
  wicket_maidens: z.coerce.number().optional(),
  runs: z.coerce.number().optional(),
  wickets: z.coerce.number().optional(),
  wides: z.coerce.number().optional(),
  no_balls: z.coerce.number().optional()
})

const fieldingRowSchema = z.object({
  player_name: z.string(),
  catches: z.coerce.number().optional(),
  stumpings: z.coerce.number().optional(),
  run_outs: z.coerce.number().optional()
})

// Partial-update body: every field is optional (undefined = "don't touch"), so no
// .default(...) here — that would make every field "present" and break the
// `!== undefined` checks the handler below uses to decide what to update.
const entrySchema = z.object({
  batting: z.array(battingRowSchema).optional(),
  bowling: z.array(bowlingRowSchema).optional(),
  fielding: z.array(fieldingRowSchema).optional(),
  batting_extras: z.coerce.number().optional(),
  bowling_byes: z.coerce.number().optional(),
  bowling_leg_byes: z.coerce.number().optional(),
  our_overs: z.union([z.string(), z.number()]).nullable().optional(),
  opp_overs: z.union([z.string(), z.number()]).nullable().optional(),
  captain_name: z.string().nullable().optional(),
  wk_name: z.string().nullable().optional(),
  team_id: z.coerce.number().int().nullable().optional(),
  season_id: z.coerce.number().int().nullable().optional(),
  competition: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  ground: z.string().nullable().optional(),
  match_type: z.enum(VALID_TAGS).nullable().optional(),
  tags: z.array(z.enum(VALID_TAGS)).optional(),
  balls_per_over: z.coerce.number().int().min(1).max(12).optional(),
  wide_runs: z.coerce.number().int().min(0).max(10).optional(),
  wide_rebowl: z.enum(REBOWL_OPTIONS).optional(),
  no_ball_runs: z.coerce.number().int().min(0).max(10).optional(),
  no_ball_rebowl: z.enum(REBOWL_OPTIONS).optional(),
  overs_per_pair: z.coerce.number().int().min(1).nullable().optional(),
  pairs_wicket_penalty: z.coerce.number().int().min(0).optional(),
  retire_on_runs: z.coerce
    .number()
    .int()
    .min(1, 'retire_on_runs must be at least 1')
    .nullable()
    .optional(),
  retire_on_balls: z.coerce
    .number()
    .int()
    .min(1, 'retire_on_balls must be at least 1')
    .nullable()
    .optional()
})

// PUT /api/manual/entry/:fixtureId — save/replace manual stats
router.put('/entry/:fixtureId', validateBody(entrySchema), (req, res) => {
  const db = getDb()
  const { fixtureId } = req.params
  const {
    batting,
    bowling,
    fielding,
    batting_extras,
    bowling_byes,
    bowling_leg_byes,
    our_overs,
    opp_overs,
    captain_name,
    wk_name,
    team_id,
    season_id,
    competition,
    format,
    ground,
    match_type,
    tags,
    balls_per_over,
    wide_runs,
    wide_rebowl,
    no_ball_runs,
    no_ball_rebowl,
    overs_per_pair,
    pairs_wicket_penalty,
    retire_on_runs,
    retire_on_balls,
    notify
  } = req.body

  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  // Update editable fixture metadata when included in the save payload.
  if (
    competition !== undefined ||
    format !== undefined ||
    ground !== undefined ||
    match_type !== undefined ||
    tags !== undefined ||
    balls_per_over !== undefined ||
    wide_runs !== undefined ||
    wide_rebowl !== undefined ||
    no_ball_runs !== undefined ||
    no_ball_rebowl !== undefined ||
    overs_per_pair !== undefined ||
    pairs_wicket_penalty !== undefined ||
    retire_on_runs !== undefined ||
    retire_on_balls !== undefined
  ) {
    const sets = []
    const vals = []
    if (competition !== undefined) {
      sets.push('competition = ?')
      vals.push(competition || null)
    }
    if (format !== undefined) {
      sets.push('format = ?')
      vals.push(format || null)
    }
    if (ground !== undefined) {
      sets.push('ground = ?')
      vals.push(ground || null)
    }
    if (balls_per_over !== undefined) {
      sets.push('balls_per_over = ?')
      vals.push(Number(balls_per_over))
    }
    if (wide_runs !== undefined) {
      sets.push('wide_runs = ?')
      vals.push(Number(wide_runs))
    }
    if (wide_rebowl !== undefined) {
      sets.push('wide_rebowl = ?')
      vals.push(wide_rebowl)
    }
    if (no_ball_runs !== undefined) {
      sets.push('no_ball_runs = ?')
      vals.push(Number(no_ball_runs))
    }
    if (no_ball_rebowl !== undefined) {
      sets.push('no_ball_rebowl = ?')
      vals.push(no_ball_rebowl)
    }
    if (overs_per_pair !== undefined) {
      sets.push('overs_per_pair = ?')
      vals.push(overs_per_pair ?? null)
    }
    if (pairs_wicket_penalty !== undefined) {
      sets.push('pairs_wicket_penalty = ?')
      vals.push(Number(pairs_wicket_penalty))
    }
    if (retire_on_runs !== undefined) {
      sets.push('retire_on_runs = ?')
      vals.push(retire_on_runs)
    }
    if (retire_on_balls !== undefined) {
      sets.push('retire_on_balls = ?')
      vals.push(retire_on_balls)
    }
    // Derive resolved tags; keep match_type in sync for backwards compat.
    const resolvedTags =
      tags ?? (match_type && VALID_TAGS.includes(match_type) ? [match_type] : null)
    if (resolvedTags) {
      syncFixtureTags(db, fixtureId, resolvedTags)
    } else if (match_type !== undefined && VALID_TAGS.includes(match_type)) {
      sets.push('match_type = ?')
      vals.push(match_type)
    }
    if (sets.length)
      db.prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE fixture_id = ?`).run(
        ...vals,
        fixtureId
      )
  }

  // Set/replace the team+season association (drives access for scoped users).
  if (team_id !== null && season_id !== null) {
    db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(fixtureId)
    db.prepare(
      'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
    ).run(fixtureId, Number(team_id), Number(season_id))
  }

  const hasDeliveries = db
    .prepare(
      `
    SELECT 1 FROM innings i JOIN deliveries d ON d.result_id = i.result_id
    WHERE i.fixture_id = ? LIMIT 1
  `
    )
    .get(fixtureId)
  if (hasDeliveries) {
    // Metadata and team/season association were already saved above.
    // Batting/bowling stats cannot be overwritten when ball-by-ball data exists.
    return res.status(200).json({ ok: true, stats_locked: true })
  }

  const defaultTeam = [fixture.home_team, fixture.away_team].find(isOurTeam) || ''

  db.transaction(() => {
    // Ensure innings records exist for batting (order 1) and bowling (order 2)
    for (const order of [1, 2]) {
      const exists = db
        .prepare(`SELECT 1 FROM innings WHERE fixture_id = ? AND innings_order = ?`)
        .get(fixtureId, order)
      if (!exists)
        db.prepare(`INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)`).run(
          fixtureId,
          order
        )
    }

    // Captain (innings 1 = WHCC batting)
    const captainPid = captain_name ? findOrCreatePlayer(db, captain_name, defaultTeam) : null
    if (captainPid) {
      db.prepare(
        `INSERT INTO match_captains (fixture_id, innings_order, player_id) VALUES (?, 1, ?)
        ON CONFLICT(fixture_id, innings_order) DO UPDATE SET player_id = excluded.player_id`
      ).run(fixtureId, captainPid)
    } else {
      db.prepare(`DELETE FROM match_captains WHERE fixture_id = ? AND innings_order = 1`).run(
        fixtureId
      )
    }

    // WK (innings 2 = WHCC fielding)
    const wkPid = wk_name ? findOrCreatePlayer(db, wk_name, defaultTeam) : null
    db.prepare(`DELETE FROM wk_assignments WHERE fixture_id = ? AND innings_order = 2`).run(
      fixtureId
    )
    if (wkPid) {
      db.prepare(
        `INSERT INTO wk_assignments (fixture_id, innings_order, player_id, from_over) VALUES (?, 2, ?, 1)`
      ).run(fixtureId, wkPid)
    }

    // Replace batting
    db.prepare(`DELETE FROM manual_batting WHERE fixture_id = ?`).run(fixtureId)
    const insertBat = db.prepare(`
      INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, fours, sixes, not_out, how_out, did_not_bat, times_out)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of batting || []) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      const dnb = row.did_not_bat ? 1 : 0
      insertBat.run(
        fixtureId,
        pid,
        dnb ? 0 : row.runs || 0,
        dnb ? 0 : row.balls || 0,
        dnb ? 0 : row.fours || 0,
        dnb ? 0 : row.sixes || 0,
        dnb ? 0 : row.not_out ? 1 : 0,
        dnb ? null : row.how_out || null,
        dnb,
        row.times_out || 0
      )
    }

    // Save extras
    db.prepare(
      `INSERT INTO manual_extras (fixture_id, batting_extras, bowling_byes, bowling_leg_byes, our_overs, opp_overs) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET batting_extras = excluded.batting_extras, bowling_byes = excluded.bowling_byes, bowling_leg_byes = excluded.bowling_leg_byes, our_overs = excluded.our_overs, opp_overs = excluded.opp_overs`
    ).run(
      fixtureId,
      batting_extras || 0,
      bowling_byes || 0,
      bowling_leg_byes || 0,
      our_overs || null,
      opp_overs || null
    )

    // Replace bowling
    db.prepare(`DELETE FROM manual_bowling WHERE fixture_id = ?`).run(fixtureId)
    const insertBowl = db.prepare(`
      INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
      VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of bowling || []) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      const balls = oversToLegalBalls(row.overs)
      insertBowl.run(
        fixtureId,
        pid,
        balls,
        row.maidens || 0,
        row.wicket_maidens || 0,
        row.runs || 0,
        row.wickets || 0,
        row.wides || 0,
        row.no_balls || 0
      )
    }

    // Replace fielding
    db.prepare(`DELETE FROM manual_fielding WHERE fixture_id = ?`).run(fixtureId)
    const insertField = db.prepare(`
      INSERT INTO manual_fielding (fixture_id, innings_order, player_id, catches, stumpings, run_outs)
      VALUES (?, 2, ?, ?, ?, ?)
    `)
    for (const row of fielding || []) {
      const pid = findOrCreatePlayer(db, row.player_name, defaultTeam)
      if (!pid) continue
      insertField.run(fixtureId, pid, row.catches || 0, row.stumpings || 0, row.run_outs || 0)
    }
  })()

  // Invalidate and recompute caches for this fixture
  const matchSummary = require('../utils/matchSummary')
  try {
    invalidateFixtureCaches(db, fixtureId)
    matchSummary.computeAndCacheManualStats(db, fixtureId)
  } catch (e) {
    console.error(`[manual] cache update failed for ${fixtureId}:`, e.message)
  }

  // Notify club (Telegram summary + milestone alerts) — opt-in, since manual
  // entry is often used to backfill historical matches.
  if (notify === true) {
    matchSummary
      .notifyMatchIngested(fixtureId)
      .catch((e) => console.error('[manual] notify error:', e.message))
  }

  res.json({ ok: true })
})

module.exports = router

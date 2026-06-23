'use strict'
// Set DB_PATH before any module that touches better-sqlite3 is loaded
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')

beforeAll(() => {
  seed(process.env.DB_PATH)
})

let db
beforeEach(() => {
  const { getDb } = require('../db/schema')
  db = getDb()
})

// ─── Manual fixture creation ───────────────────────────────────────────────────
// Mirrors the DB operations in POST /api/manual/fixture

describe('manual fixture creation', () => {
  let fixtureId

  afterEach(() => {
    if (fixtureId) {
      db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM fixtures WHERE fixture_id = ?`).run(fixtureId)
      fixtureId = null
    }
  })

  it('inserts a fixture with required fields', () => {
    fixtureId = `manual-test-${Date.now()}`
    db.prepare(
      `INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fixtureId, '2026-06-01', 'WHCC Whirlwinds', 'Test CC', '', 'standard', 0, '')

    const f = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId)
    expect(f).toBeDefined()
    expect(f.home_team).toBe('WHCC Whirlwinds')
    expect(f.away_team).toBe('Test CC')
    expect(f.format).toBe('standard')
  })

  it('associates fixture to a team+season when provided', () => {
    fixtureId = `manual-test-${Date.now()}`
    db.prepare(
      `INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fixtureId, '2026-06-01', 'WHCC Whirlwinds', 'Test CC', '', 'standard', 0, '')

    // Get a known team_id+season_id from watched_teams (may not exist in test DB, so insert one)
    db.prepare(
      `INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, 1, 1)`
    ).run(fixtureId)

    const fs = db.prepare(`SELECT * FROM fixture_seasons WHERE fixture_id = ?`).get(fixtureId)
    expect(fs).toBeDefined()
    expect(fs.team_id).toBe(1)
    expect(fs.season_id).toBe(1)
  })

  it('pairs format sets starting_score > 0', () => {
    fixtureId = `manual-test-${Date.now()}`
    db.prepare(
      `INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fixtureId, '2026-06-01', 'WHCC Whirlwinds', 'Test CC', '', 'pairs', 200, '')

    const f = db
      .prepare(`SELECT format, starting_score FROM fixtures WHERE fixture_id = ?`)
      .get(fixtureId)
    expect(f.format).toBe('pairs')
    expect(f.starting_score).toBe(200)
  })

  it('new format config columns exist and default correctly', () => {
    fixtureId = `manual-test-${Date.now()}`
    db.prepare(
      `INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fixtureId, '2026-06-01', 'WHCC Whirlwinds', 'Test CC', '', 'pairs', 200, '')

    const f = db
      .prepare(
        `SELECT balls_per_over, wide_runs, wide_rebowl, no_ball_runs, no_ball_rebowl,
                overs_per_pair, pairs_wicket_penalty FROM fixtures WHERE fixture_id = ?`
      )
      .get(fixtureId)
    expect(f.balls_per_over).toBe(6)
    expect(f.wide_runs).toBe(1)
    expect(f.wide_rebowl).toBe('always')
    expect(f.no_ball_runs).toBe(1)
    expect(f.no_ball_rebowl).toBe('always')
    expect(f.overs_per_pair).toBeNull()
    expect(f.pairs_wicket_penalty).toBe(5)
  })

  it('new format config columns persist custom values', () => {
    fixtureId = `manual-test-${Date.now()}`
    db.prepare(
      `INSERT INTO fixtures (fixture_id, match_date, home_team, away_team, ground, format, starting_score, competition,
         balls_per_over, wide_runs, wide_rebowl, no_ball_runs, no_ball_rebowl, overs_per_pair, pairs_wicket_penalty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fixtureId,
      '2026-06-01',
      'WHCC Whirlwinds',
      'Test CC',
      '',
      'pairs',
      200,
      '',
      8,
      2,
      'never',
      2,
      'last_over',
      4,
      3
    )

    const f = db
      .prepare(
        `SELECT balls_per_over, wide_runs, wide_rebowl, no_ball_runs, no_ball_rebowl,
                overs_per_pair, pairs_wicket_penalty FROM fixtures WHERE fixture_id = ?`
      )
      .get(fixtureId)
    expect(f.balls_per_over).toBe(8)
    expect(f.wide_runs).toBe(2)
    expect(f.wide_rebowl).toBe('never')
    expect(f.no_ball_runs).toBe(2)
    expect(f.no_ball_rebowl).toBe('last_over')
    expect(f.overs_per_pair).toBe(4)
    expect(f.pairs_wicket_penalty).toBe(3)
  })
})

// ─── Cache invalidation pattern ────────────────────────────────────────────────
// This pattern (DELETE from match_stats_cache, mvp_cache, match_detail_cache) is duplicated
// between manual.js and matches.js. Tests here protect against it being broken during Phase 5.

describe('cache invalidation after save', () => {
  const FIXTURE = '25577112'

  beforeEach(() => {
    // Populate cache rows so we can verify they get deleted
    db.prepare(
      `INSERT OR IGNORE INTO match_stats_cache
         (fixture_id, top_bat_name, top_bat_runs, top_bat_balls, top_bowl_name,
          top_bowl_wickets, top_bowl_runs, mvp_name, mvp_pts, computed_at)
       VALUES (?, 'Test', 0, 0, 'Test', 0, 0, 'Test', 0, datetime('now'))`
    ).run(FIXTURE)
    db.prepare(
      `INSERT OR IGNORE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at)
       VALUES (?, '[]', '{}', datetime('now'))`
    ).run(FIXTURE)
    db.prepare(
      `INSERT OR IGNORE INTO match_detail_cache (fixture_id, partnerships_json, phases_json, computed_at)
       VALUES (?, '[]', '{}', datetime('now'))`
    ).run(FIXTURE)
  })

  it('deletes all three cache rows for the fixture', () => {
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(FIXTURE)
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(FIXTURE)
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(FIXTURE)

    const stats = db.prepare(`SELECT 1 FROM match_stats_cache WHERE fixture_id = ?`).get(FIXTURE)
    const mvp = db.prepare(`SELECT 1 FROM mvp_cache WHERE fixture_id = ?`).get(FIXTURE)
    const detail = db.prepare(`SELECT 1 FROM match_detail_cache WHERE fixture_id = ?`).get(FIXTURE)

    expect(stats).toBeUndefined()
    expect(mvp).toBeUndefined()
    expect(detail).toBeUndefined()
  })

  it('cache rows exist for other fixtures after targeted invalidation', () => {
    const OTHER = 'TEST_001'
    db.prepare(
      `INSERT OR IGNORE INTO match_stats_cache
         (fixture_id, top_bat_name, top_bat_runs, top_bat_balls, top_bowl_name,
          top_bowl_wickets, top_bowl_runs, mvp_name, mvp_pts, computed_at)
       VALUES (?, 'Test', 0, 0, 'Test', 0, 0, 'Test', 0, datetime('now'))`
    ).run(OTHER)

    db.prepare(`DELETE FROM match_stats_cache WHERE fixture_id = ?`).run(FIXTURE)

    const other = db.prepare(`SELECT 1 FROM match_stats_cache WHERE fixture_id = ?`).get(OTHER)
    expect(other).toBeDefined()

    db.prepare(`DELETE FROM match_stats_cache WHERE fixture_id = ?`).run(OTHER)
  })
})

// ─── Manual batting/bowling row structure ──────────────────────────────────────
// Verifies the schema expected by the PUT /api/manual/entry/:id handler

describe('manual_batting schema', () => {
  const FIXTURE = 'TEST_002'
  const PLAYER = 103

  afterEach(() => {
    db.prepare(`DELETE FROM manual_batting WHERE fixture_id = ?`).run(FIXTURE)
  })

  it('inserts and retrieves a manual batting row', () => {
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, fours, sixes, not_out, how_out)
       VALUES (?, 1, ?, 45, 60, 4, 1, 0, 'Caught Jones b Smith')`
    ).run(FIXTURE, PLAYER)

    const row = db
      .prepare(`SELECT * FROM manual_batting WHERE fixture_id = ? AND player_id = ?`)
      .get(FIXTURE, PLAYER)
    expect(row.runs).toBe(45)
    expect(row.balls).toBe(60)
    expect(row.how_out).toBe('Caught Jones b Smith')
    expect(row.not_out).toBe(0)
  })
})

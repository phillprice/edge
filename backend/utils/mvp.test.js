'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { buildManualMvp, computeManualMvpForFixtures, bowlerMvpPoints } = require('./mvp')

let db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()
})

// ─── bowlerMvpPoints ──────────────────────────────────────────────────────────

describe('bowlerMvpPoints', () => {
  it('scores 0 wickets as 0', () => {
    expect(bowlerMvpPoints(0)).toBe(0)
  })

  it('scores below the haul bonus thresholds as wickets * 1.8', () => {
    expect(bowlerMvpPoints(1)).toBeCloseTo(1.8)
    expect(bowlerMvpPoints(2)).toBeCloseTo(3.6)
  })

  it('adds a 0.5 bonus for a 3-4 wicket haul', () => {
    expect(bowlerMvpPoints(3)).toBeCloseTo(3 * 1.8 + 0.5)
    expect(bowlerMvpPoints(4)).toBeCloseTo(4 * 1.8 + 0.5)
  })

  it('adds a 1.0 bonus for a 5+ wicket haul', () => {
    expect(bowlerMvpPoints(5)).toBeCloseTo(5 * 1.8 + 1.0)
    expect(bowlerMvpPoints(6)).toBeCloseTo(6 * 1.8 + 1.0)
  })
})

// ─── buildManualMvp ───────────────────────────────────────────────────────────

describe('buildManualMvp', () => {
  const FIXTURE = 'mvp-test-1'

  beforeAll(() => {
    // Insert a manual fixture
    db.prepare(
      `INSERT OR IGNORE INTO fixtures (fixture_id, home_team, away_team, match_date)
       VALUES (?, 'WHCC U11 Whirlwinds', 'Epsom CC', '2026-05-01')`
    ).run(FIXTURE)
  })

  afterAll(() => {
    db.prepare('DELETE FROM manual_bowling WHERE fixture_id = ?').run(FIXTURE)
    db.prepare('DELETE FROM manual_batting WHERE fixture_id = ?').run(FIXTURE)
    db.prepare('DELETE FROM fixtures WHERE fixture_id = ?').run(FIXTURE)
  })

  beforeEach(() => {
    db.prepare('DELETE FROM manual_bowling WHERE fixture_id = ?').run(FIXTURE)
    db.prepare('DELETE FROM manual_batting WHERE fixture_id = ?').run(FIXTURE)
  })

  it('returns empty array when no stats exist', () => {
    const result = buildManualMvp(db, FIXTURE)
    expect(result).toEqual([])
  })

  it('gives batting points: runs * 0.1', () => {
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 103, 40, 50, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toHaveLength(1)
    expect(result[0].bat).toBe(4.0)
    expect(result[0].total).toBe(4.0)
    expect(result[0].name).toBe('Leo Brown')
  })

  it('excludes did_not_bat rows from batting points', () => {
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 103, 20, 30, 1)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toEqual([])
  })

  it('gives bowling points: wickets * 1.8', () => {
    db.prepare(
      `INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
       VALUES (?, 2, 105, 18, 0, 0, 12, 2, 0, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toHaveLength(1)
    expect(result[0].bowl).toBe(3.6)
  })

  it('gives haul bonus: +0.5 for 3 wickets, +1.0 for 5 wickets', () => {
    // 3 wickets → 3*1.8 + 0.5 = 5.9
    db.prepare(
      `INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
       VALUES (?, 2, 105, 18, 0, 0, 20, 3, 0, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result[0].bowl).toBe(5.9)

    db.prepare('DELETE FROM manual_bowling WHERE fixture_id = ?').run(FIXTURE)

    // 5 wickets → 5*1.8 + 1.0 = 10.0
    db.prepare(
      `INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
       VALUES (?, 2, 105, 30, 0, 0, 15, 5, 0, 0)`
    ).run(FIXTURE)

    const result2 = buildManualMvp(db, FIXTURE)
    expect(result2[0].bowl).toBe(10.0)
  })

  it('combines bat and bowl points for the same player', () => {
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 103, 30, 40, 0)`
    ).run(FIXTURE)
    db.prepare(
      `INSERT INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
       VALUES (?, 2, 103, 12, 0, 0, 10, 2, 0, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toHaveLength(1)
    expect(result[0].bat).toBe(3.0)
    expect(result[0].bowl).toBe(3.6)
    expect(result[0].total).toBe(6.6)
  })

  it('sorts by total descending and returns top 3', () => {
    // Insert 4 batters with different scores
    const bats = [
      [101, 50], // 5.0 pts
      [102, 40], // 4.0 pts
      [103, 30], // 3.0 pts
      [104, 20] // 2.0 pts
    ]
    for (const [pid, runs] of bats) {
      db.prepare(
        `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
         VALUES (?, 1, ?, ?, 30, 0)`
      ).run(FIXTURE, pid, runs)
    }

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toHaveLength(3)
    expect(result[0].total).toBe(5.0)
    expect(result[1].total).toBe(4.0)
    expect(result[2].total).toBe(3.0)
  })

  it('filters out players with 0 total points', () => {
    // 0 runs and 0 wickets
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 103, 0, 10, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result).toEqual([])
  })

  it('uses display_name when set', () => {
    db.prepare('UPDATE players SET display_name = ? WHERE player_id = ?').run('Sammy L', 101)
    db.prepare(
      `INSERT INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 101, 25, 30, 0)`
    ).run(FIXTURE)

    const result = buildManualMvp(db, FIXTURE)
    expect(result[0].name).toBe('Sammy L')

    db.prepare('UPDATE players SET display_name = ? WHERE player_id = ?').run(null, 101)
  })
})

// ─── computeManualMvpForFixtures ──────────────────────────────────────────────

describe('computeManualMvpForFixtures', () => {
  const F1 = 'mvp-multi-1'
  const F2 = 'mvp-multi-2'

  beforeAll(() => {
    db.prepare(
      `INSERT OR IGNORE INTO fixtures (fixture_id, home_team, away_team, match_date)
       VALUES (?, 'WHCC Whirlwinds', 'Opp A', '2026-05-10')`
    ).run(F1)
    db.prepare(
      `INSERT OR IGNORE INTO fixtures (fixture_id, home_team, away_team, match_date)
       VALUES (?, 'WHCC Whirlwinds', 'Opp B', '2026-05-17')`
    ).run(F2)

    // F1: player 103 bats 50 runs (5.0 pts), player 105 takes 2 wickets (3.6 pts)
    db.prepare(
      `INSERT OR IGNORE INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 103, 50, 60, 0)`
    ).run(F1)
    db.prepare(
      `INSERT OR IGNORE INTO manual_bowling (fixture_id, innings_order, player_id, balls, maidens, wicket_maidens, runs, wickets, wides, no_balls)
       VALUES (?, 2, 105, 18, 0, 0, 12, 2, 0, 0)`
    ).run(F1)

    // F2: player 106 bats 30 runs (3.0 pts)
    db.prepare(
      `INSERT OR IGNORE INTO manual_batting (fixture_id, innings_order, player_id, runs, balls, did_not_bat)
       VALUES (?, 1, 106, 30, 40, 0)`
    ).run(F2)
  })

  afterAll(() => {
    for (const f of [F1, F2]) {
      db.prepare('DELETE FROM manual_bowling WHERE fixture_id = ?').run(f)
      db.prepare('DELETE FROM manual_batting WHERE fixture_id = ?').run(f)
      db.prepare('DELETE FROM fixtures WHERE fixture_id = ?').run(f)
    }
  })

  it('returns top scorer per fixture', () => {
    const result = computeManualMvpForFixtures(db, [F1, F2])
    expect(result[F1]).toBeDefined()
    expect(result[F2]).toBeDefined()
    // F1 top is Leo Brown (103) with 5.0 pts
    expect(result[F1].name).toBe('Leo Brown')
    expect(result[F1].pts).toBe(5.0)
    // F2 top is Archie Jones (106) with 3.0 pts
    expect(result[F2].name).toBe('Archie Jones')
    expect(result[F2].pts).toBe(3.0)
  })

  it('returns empty object for fixtures with no stats', () => {
    const EMPTY = 'mvp-empty-fix'
    db.prepare(
      `INSERT OR IGNORE INTO fixtures (fixture_id, home_team, away_team, match_date)
       VALUES (?, 'WHCC', 'Opp', '2026-05-20')`
    ).run(EMPTY)

    const result = computeManualMvpForFixtures(db, [EMPTY])
    expect(result[EMPTY]).toBeUndefined()

    db.prepare('DELETE FROM fixtures WHERE fixture_id = ?').run(EMPTY)
  })
})

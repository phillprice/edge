'use strict'
// Set DB_PATH before any module that touches better-sqlite3 is loaded
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')

// Seed the test DB before running tests
beforeAll(() => {
  seed(process.env.DB_PATH)
})

// Re-open DB after each describe block since seed-test-db closes it
let db
beforeEach(() => {
  const { getDb } = require('../db/schema')
  db = getDb()
})

describe('partnerships SQL', () => {
  it('returns partnerships for seeded data', () => {
    const rows = db.prepare(`
      WITH relevant AS (SELECT fixture_id FROM fixtures),
      stands AS (
        SELECT
          CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id ELSE d.batter_id_ns END AS p1_id,
          CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id_ns ELSE d.batter_id END AS p2_id,
          d.result_id, SUM(d.runs_bat) AS runs
        FROM deliveries d
        JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
        JOIN relevant rf ON rf.fixture_id = i.fixture_id
        WHERE d.batter_id_ns IS NOT NULL
        GROUP BY p1_id, p2_id, d.result_id
      ),
      agg AS (
        SELECT p1_id, p2_id, COUNT(*) AS stands, SUM(runs) AS total_runs, MAX(runs) AS best_stand
        FROM stands GROUP BY p1_id, p2_id
      )
      SELECT agg.*, p1.name AS p1_name, p2.name AS p2_name
      FROM agg
      JOIN players_dn p1 ON p1.player_id = agg.p1_id
      JOIN players_dn p2 ON p2.player_id = agg.p2_id
      ORDER BY agg.total_runs DESC
    `).all()

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('total_runs')
    expect(rows[0]).toHaveProperty('p1_name')
    expect(rows[0]).toHaveProperty('p2_name')
    expect(rows[0]).toHaveProperty('stands')
    expect(rows[0]).toHaveProperty('best_stand')
    // Leo (103) + Tom (104): over 0 = 13 runs
    // Leo (103) + Jack (105): over 1 = 10 runs
    expect(rows[0].total_runs).toBe(13)
    expect(rows[1].total_runs).toBe(10)
  })

  it('partnership normalises player order (lower id = p1)', () => {
    const rows = db.prepare(`
      SELECT
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id ELSE d.batter_id_ns END AS p1_id,
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id_ns ELSE d.batter_id END AS p2_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      WHERE d.batter_id_ns IS NOT NULL
      LIMIT 5
    `).all()
    for (const r of rows) {
      expect(r.p1_id).toBeLessThanOrEqual(r.p2_id)
    }
  })
})

describe('player stats SQL', () => {
  it('batting CTE returns runs for Leo and Jack', () => {
    const rows = db.prepare(`
      SELECT d.batter_id, SUM(d.runs_bat) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      GROUP BY d.batter_id
    `).all()

    const leo = rows.find(r => r.batter_id === 103)
    const jack = rows.find(r => r.batter_id === 105)
    expect(leo).toBeDefined()
    expect(jack).toBeDefined()
    // Over 0: Leo scores 2+1+6 = 9; Over 1: Leo scores 1+4 = 5; total = 14
    expect(leo.runs).toBe(14)
    // Jack scores 3+0+2 = 5 in over 1
    expect(jack.runs).toBe(5)
  })

  it('bowling CTE returns wickets for opposition bowlers', () => {
    const rows = db.prepare(`
      SELECT d.bowler_id, COUNT(d.dismissed_batter_id) AS wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      GROUP BY d.bowler_id
    `).all()

    // Alex Taylor (301) takes 1 wicket (Tom), Ben Martin (302) takes 1 wicket (Leo)
    const alex = rows.find(r => r.bowler_id === 301)
    const ben  = rows.find(r => r.bowler_id === 302)
    expect(alex.wickets).toBe(1)
    expect(ben.wickets).toBe(1)
  })
})

describe('h2h SQL', () => {
  const playerId = 103 // Leo Brown

  it('returns batting h2h grouped by opponent', () => {
    const whccExpr = `(lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
      OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%'
      OR lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%'
      OR lower(f.away_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%hurricane%')`
    const oppExpr = `CASE WHEN (lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
      OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%')
      THEN f.away_team ELSE f.home_team END`

    const rows = db.prepare(`
      WITH bat AS (
        SELECT i.fixture_id, SUM(d.runs_bat) AS runs,
          MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed
        FROM deliveries d JOIN innings i ON i.result_id = d.result_id
        WHERE d.batter_id = ?
        GROUP BY i.result_id
      )
      SELECT ${oppExpr} AS opponent, COUNT(*) AS innings, SUM(bat.runs) AS runs,
        MAX(bat.runs) AS high_score, SUM(bat.dismissed) AS outs
      FROM bat
      JOIN fixtures f ON f.fixture_id = bat.fixture_id
      WHERE ${whccExpr}
      GROUP BY opponent ORDER BY runs DESC
    `).all(playerId)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('opponent')
    expect(rows[0]).toHaveProperty('innings')
    expect(rows[0]).toHaveProperty('runs')
    expect(rows[0].runs).toBe(14) // Leo's total runs vs Weybridge
  })
})

describe('season SQL', () => {
  it('aggregates batting totals for WHCC innings', () => {
    const row = db.prepare(`
      SELECT SUM(d.runs_bat) AS total_runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
    `).get()
    // WHCC batting innings: Leo 14 + Tom (0+4=4) + Jack (3+0+2=5) = 23
    expect(row.total_runs).toBe(23)
  })

  it('aggregates bowling wickets for WHCC bowling innings', () => {
    const row = db.prepare(`
      SELECT COUNT(d.dismissed_batter_id) AS total_wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 2
    `).get()
    // WHCC bowling: Jack (105) takes 1 (Ben) + Archie (106) takes 1 (Chris) = 2
    expect(row.total_wickets).toBe(2)
  })
})

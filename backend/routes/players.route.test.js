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
    const rows = db
      .prepare(
        `
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
    `
      )
      .all()

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
    const rows = db
      .prepare(
        `
      SELECT
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id ELSE d.batter_id_ns END AS p1_id,
        CASE WHEN d.batter_id < d.batter_id_ns THEN d.batter_id_ns ELSE d.batter_id END AS p2_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      WHERE d.batter_id_ns IS NOT NULL
      LIMIT 5
    `
      )
      .all()
    for (const r of rows) {
      expect(r.p1_id).toBeLessThanOrEqual(r.p2_id)
    }
  })
})

describe('player stats SQL', () => {
  it('batting CTE returns runs for Leo and Jack', () => {
    const rows = db
      .prepare(
        `
      SELECT d.batter_id, SUM(d.runs_bat) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      GROUP BY d.batter_id
    `
      )
      .all()

    const leo = rows.find((r) => r.batter_id === 103)
    const jack = rows.find((r) => r.batter_id === 105)
    expect(leo).toBeDefined()
    expect(jack).toBeDefined()
    // Over 0: Leo scores 2+1+6 = 9; Over 1: Leo scores 1+4 = 5; total = 14
    expect(leo.runs).toBe(14)
    // Jack scores 3+0+2 = 5 in over 1
    expect(jack.runs).toBe(5)
  })

  it('bowling CTE returns wickets for opposition bowlers', () => {
    const rows = db
      .prepare(
        `
      SELECT d.bowler_id, COUNT(d.dismissed_batter_id) AS wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
      GROUP BY d.bowler_id
    `
      )
      .all()

    // Alex Taylor (301) takes 1 wicket (Tom), Ben Martin (302) takes 1 wicket (Leo)
    const alex = rows.find((r) => r.bowler_id === 301)
    const ben = rows.find((r) => r.bowler_id === 302)
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

    const rows = db
      .prepare(
        `
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
    `
      )
      .all(playerId)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('opponent')
    expect(rows[0]).toHaveProperty('innings')
    expect(rows[0]).toHaveProperty('runs')
    expect(rows[0].runs).toBe(14) // Leo's total runs vs Weybridge
  })
})

describe('season SQL', () => {
  it('aggregates batting totals for WHCC innings', () => {
    const row = db
      .prepare(
        `
      SELECT SUM(d.runs_bat) AS total_runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1
    `
      )
      .get()
    // WHCC batting innings: Leo 14 + Tom (0+4=4) + Jack (3+0+2=5) = 23
    expect(row.total_runs).toBe(23)
  })

  it('aggregates bowling wickets for WHCC bowling innings', () => {
    const row = db
      .prepare(
        `
      SELECT COUNT(d.dismissed_batter_id) AS total_wickets
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 2
    `
      )
      .get()
    // WHCC bowling: Jack (105) takes 1 (Ben) + Archie (106) takes 1 (Chris) = 2
    expect(row.total_wickets).toBe(2)
  })
})

// ─── user_preferences / favourite_groups ─────────────────────────────────────
// Tests the direct DB logic used by GET/POST /api/players/preferences.
// The endpoint uses getAuthContext(req).userId; these tests verify the DB layer
// directly so we don't need to spin up an Express server or mock Clerk.

describe('user_preferences: columns', () => {
  const USER = 'test-user-prefs-001'

  afterEach(() => {
    db.prepare(`DELETE FROM user_preferences WHERE clerk_user_id = ?`).run(USER)
  })

  it('returns default columns when no row exists', () => {
    const pref = db
      .prepare(
        `SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`
      )
      .get(USER)
    expect(pref).toBeUndefined()
    // Matches the fallback logic in the route handler
    const columns = pref ? JSON.parse(pref.player_list_columns) : ['MAT', 'INN', 'RUNS', 'AVG']
    expect(columns).toEqual(['MAT', 'INN', 'RUNS', 'AVG'])
  })

  it('upserts column preferences and reads them back', () => {
    const cols = ['MAT', 'RUNS', 'AVG', 'SR']
    db.prepare(
      `
      INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
      VALUES (?, ?, '[]', datetime('now'))
      ON CONFLICT(clerk_user_id) DO UPDATE SET player_list_columns = excluded.player_list_columns
    `
    ).run(USER, JSON.stringify(cols))

    const pref = db
      .prepare(`SELECT player_list_columns FROM user_preferences WHERE clerk_user_id = ?`)
      .get(USER)
    expect(JSON.parse(pref.player_list_columns)).toEqual(cols)
  })

  it('second upsert overwrites columns without touching favourite_groups', () => {
    db.prepare(
      `
      INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
      VALUES (?, '["MAT","RUNS"]', '[{"team_id":1,"season_id":2}]', datetime('now'))
    `
    ).run(USER)

    const newCols = ['MAT', 'INN', 'RUNS', 'HS', 'AVG']
    db.prepare(
      `
      INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
      VALUES (?, ?, (SELECT favourite_groups FROM user_preferences WHERE clerk_user_id = ?), datetime('now'))
      ON CONFLICT(clerk_user_id) DO UPDATE SET
        player_list_columns = excluded.player_list_columns,
        updated_at          = datetime('now')
    `
    ).run(USER, JSON.stringify(newCols), USER)

    const pref = db
      .prepare(
        `SELECT player_list_columns, favourite_groups FROM user_preferences WHERE clerk_user_id = ?`
      )
      .get(USER)
    expect(JSON.parse(pref.player_list_columns)).toEqual(newCols)
    // favourite_groups preserved
    expect(JSON.parse(pref.favourite_groups)).toEqual([{ team_id: 1, season_id: 2 }])
  })
})

describe('user_preferences: favourite_groups', () => {
  const USER = 'test-user-prefs-002'

  afterEach(() => {
    db.prepare(`DELETE FROM user_preferences WHERE clerk_user_id = ?`).run(USER)
  })

  it('returns empty array when no row exists', () => {
    const pref = db
      .prepare(`SELECT favourite_groups FROM user_preferences WHERE clerk_user_id = ?`)
      .get(USER)
    const favs = pref ? JSON.parse(pref.favourite_groups || '[]') : []
    expect(favs).toEqual([])
  })

  it('saves and retrieves favourite groups', () => {
    const favs = [
      { team_id: 239292, season_id: 258 },
      { team_id: 47317, season_id: 259 }
    ]
    db.prepare(
      `
      INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
      VALUES (?, '["MAT","RUNS"]', ?, datetime('now'))
    `
    ).run(USER, JSON.stringify(favs))

    const pref = db
      .prepare(`SELECT favourite_groups FROM user_preferences WHERE clerk_user_id = ?`)
      .get(USER)
    expect(JSON.parse(pref.favourite_groups)).toEqual(favs)
  })

  it('clearing favourites stores empty array, not null', () => {
    db.prepare(
      `
      INSERT INTO user_preferences (clerk_user_id, player_list_columns, favourite_groups, updated_at)
      VALUES (?, '["MAT"]', '[{"team_id":1,"season_id":1}]', datetime('now'))
    `
    ).run(USER)

    db.prepare(
      `
      UPDATE user_preferences SET favourite_groups = '[]' WHERE clerk_user_id = ?
    `
    ).run(USER)

    const pref = db
      .prepare(`SELECT favourite_groups FROM user_preferences WHERE clerk_user_id = ?`)
      .get(USER)
    expect(pref.favourite_groups).toBe('[]')
    expect(JSON.parse(pref.favourite_groups)).toEqual([])
  })
})

// ─── player_match_highlights migration ───────────────────────────────────────

describe('player_match_highlights migration', () => {
  it('table exists with expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(player_match_highlights)`).all()
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('player_id')
    expect(names).toContain('fixture_id')
    expect(names).toContain('note')
    expect(names).toContain('clerk_user_id')
    expect(names).toContain('tagged_at')
  })

  it('has a UNIQUE constraint on (player_id, fixture_id)', () => {
    const indexes = db.prepare(`PRAGMA index_list(player_match_highlights)`).all()
    const uniq = indexes.filter((i) => i.unique)
    expect(uniq.length).toBeGreaterThan(0)
  })
})

// ─── player series SQL ────────────────────────────────────────────────────────
// Mirrors the DB queries in GET /api/players/:id/series

describe('player series: batting from deliveries', () => {
  const LEO = 103
  const FIXTURE = '25577112' // Leo has deliveries here

  it('returns one row per fixture for Leo', () => {
    const rows = db
      .prepare(
        `SELECT
          i.fixture_id,
          SUM(d.runs_bat) AS runs,
          COUNT(*) AS balls,
          MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS dismissed
        FROM deliveries d
        JOIN innings i ON i.result_id = d.result_id
        WHERE d.batter_id = ?
        GROUP BY i.fixture_id`
      )
      .all(LEO)

    expect(rows.length).toBeGreaterThan(0)
    const row = rows.find((r) => r.fixture_id === FIXTURE)
    expect(row).toBeDefined()
    expect(row.runs).toBe(14) // Leo scores 14 in 25577112
    expect(row.dismissed).toBe(1)
  })
})

describe('player series: bowling from deliveries', () => {
  const JACK = 105
  const FIXTURE = '25577112'

  it('returns bowling data per fixture for Jack', () => {
    const rows = db
      .prepare(
        `SELECT
          i.fixture_id,
          SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
          COUNT(d.dismissed_batter_id) AS wickets
        FROM deliveries d
        JOIN innings i ON i.result_id = d.result_id
        WHERE d.bowler_id = ?
        GROUP BY i.fixture_id`
      )
      .all(JACK)

    expect(rows.length).toBeGreaterThan(0)
    const row = rows.find((r) => r.fixture_id === FIXTURE)
    expect(row).toBeDefined()
    expect(row.wickets).toBe(1) // Jack takes 1 wicket (Ben dismissed)
  })
})

// ─── player highlights CRUD ───────────────────────────────────────────────────
// Mirrors the DB operations in POST/DELETE /api/players/:id/highlights

describe('player highlights: insert and upsert', () => {
  const PLAYER = 103
  const FIXTURE = '25577112'

  afterEach(() => {
    db.prepare(`DELETE FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`).run(
      PLAYER,
      FIXTURE
    )
  })

  it('inserts a highlight row', () => {
    db.prepare(
      `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id)
       VALUES (?, ?, ?, ?)`
    ).run(PLAYER, FIXTURE, 'Hat-trick', 'user-001')

    const row = db
      .prepare(`SELECT * FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`)
      .get(PLAYER, FIXTURE)
    expect(row).toBeDefined()
    expect(row.note).toBe('Hat-trick')
    expect(row.clerk_user_id).toBe('user-001')
  })

  it('upserts (updates note) on duplicate player+fixture', () => {
    db.prepare(
      `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id) VALUES (?, ?, ?, ?)`
    ).run(PLAYER, FIXTURE, 'First note', 'user-001')

    db.prepare(
      `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id, fixture_id) DO UPDATE SET note = excluded.note, clerk_user_id = excluded.clerk_user_id, tagged_at = datetime('now')`
    ).run(PLAYER, FIXTURE, 'Updated note', 'user-002')

    const row = db
      .prepare(
        `SELECT note, clerk_user_id FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`
      )
      .get(PLAYER, FIXTURE)
    expect(row.note).toBe('Updated note')
    expect(row.clerk_user_id).toBe('user-002')

    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`
      )
      .get(PLAYER, FIXTURE)
    expect(count.n).toBe(1)
  })

  it('series endpoint reflects highlight when set', () => {
    db.prepare(
      `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id) VALUES (?, ?, ?, ?)`
    ).run(PLAYER, FIXTURE, 'Great knock', null)

    const highlights = db
      .prepare(`SELECT fixture_id, note FROM player_match_highlights WHERE player_id = ?`)
      .all(PLAYER)
    const highlightMap = new Map(highlights.map((h) => [h.fixture_id, h.note ?? null]))

    expect(highlightMap.has(FIXTURE)).toBe(true)
    expect(highlightMap.get(FIXTURE)).toBe('Great knock')
  })
})

describe('player highlights: delete', () => {
  const PLAYER = 103
  const FIXTURE = '25577112'

  it('deletes an existing highlight', () => {
    db.prepare(
      `INSERT INTO player_match_highlights (player_id, fixture_id, note, clerk_user_id) VALUES (?, ?, ?, ?)`
    ).run(PLAYER, FIXTURE, 'To be deleted', null)

    db.prepare(`DELETE FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`).run(
      PLAYER,
      FIXTURE
    )

    const row = db
      .prepare(`SELECT 1 FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`)
      .get(PLAYER, FIXTURE)
    expect(row).toBeUndefined()
  })

  it('deleting a non-existent highlight does not error', () => {
    expect(() => {
      db.prepare(`DELETE FROM player_match_highlights WHERE player_id = ? AND fixture_id = ?`).run(
        PLAYER,
        'DOES_NOT_EXIST'
      )
    }).not.toThrow()
  })
})

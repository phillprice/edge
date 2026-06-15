'use strict'
// Set DB_PATH before any module that touches better-sqlite3 is loaded
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const {
  _test: { parseClubTeams }
} = require('../utils/resultsvault')
const { _expandFromScorecard } = require('./admin')

beforeAll(() => {
  seed(process.env.DB_PATH)
})

let db
beforeEach(() => {
  const { getDb } = require('../db/schema')
  db = getDb()
})

// ─── Player PATCH logic ────────────────────────────────────────────────────────
// Mirrors the DB operations in PATCH /api/admin/player/:id

describe('player display_name update', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET display_name = NULL WHERE player_id = ?`).run(101)
  })

  it('sets display_name for a known player', () => {
    db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run('Sam Lawrence', 101)
    const p = db.prepare(`SELECT display_name FROM players WHERE player_id = ?`).get(101)
    expect(p.display_name).toBe('Sam Lawrence')
  })

  it('clears display_name (null/trim empty)', () => {
    db.prepare(`UPDATE players SET display_name = 'Sam L' WHERE player_id = ?`).run(101)
    db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(null, 101)
    const p = db.prepare(`SELECT display_name FROM players WHERE player_id = ?`).get(101)
    expect(p.display_name).toBeNull()
  })

  it('players_dn view returns display_name when set, else name', () => {
    db.prepare(`UPDATE players SET display_name = 'The Great Leo' WHERE player_id = ?`).run(103)
    const p = db.prepare(`SELECT name FROM players_dn WHERE player_id = ?`).get(103)
    expect(p.name).toBe('The Great Leo')
    db.prepare(`UPDATE players SET display_name = NULL WHERE player_id = ?`).run(103)
    const p2 = db.prepare(`SELECT name FROM players_dn WHERE player_id = ?`).get(103)
    expect(p2.name).toBe('Leo Brown')
  })
})

describe('player is_sub toggle', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET is_sub = 0 WHERE player_id = ?`).run(103)
  })

  it('marks a player as sub', () => {
    db.prepare(`UPDATE players SET is_sub = 1 WHERE player_id = ?`).run(103)
    const p = db.prepare(`SELECT is_sub FROM players WHERE player_id = ?`).get(103)
    expect(p.is_sub).toBe(1)
  })

  it('unmarks a player as sub', () => {
    db.prepare(`UPDATE players SET is_sub = 1 WHERE player_id = ?`).run(103)
    db.prepare(`UPDATE players SET is_sub = 0 WHERE player_id = ?`).run(103)
    const p = db.prepare(`SELECT is_sub FROM players WHERE player_id = ?`).get(103)
    expect(p.is_sub).toBe(0)
  })
})

describe('player ignore_flag', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET ignore_flag = 0 WHERE player_id = ?`).run(303)
  })

  it('sets ignore_flag on a player', () => {
    db.prepare(`UPDATE players SET ignore_flag = 1 WHERE player_id = ?`).run(303)
    const p = db.prepare(`SELECT ignore_flag FROM players WHERE player_id = ?`).get(303)
    expect(p.ignore_flag).toBe(1)
  })

  it('ignored players are excluded from duplicate-players query', () => {
    // Need 3 players: two non-ignored + one ignored, all same name.
    // The inner query counts non-ignored players; only the 2 non-ignored ones qualify.
    db.prepare(`DELETE FROM players WHERE player_id IN (999, 998, 997)`).run()
    db.prepare(`INSERT INTO players (player_id, name, team) VALUES (999, 'Dup A', NULL)`).run()
    db.prepare(`INSERT INTO players (player_id, name, team) VALUES (997, 'Dup A', NULL)`).run()
    db.prepare(`INSERT INTO players (player_id, name, team) VALUES (998, 'Dup A', NULL)`).run()
    db.prepare(`UPDATE players SET ignore_flag = 1 WHERE player_id = 998`).run()

    const rows = db
      .prepare(
        `SELECT player_id FROM players WHERE lower(COALESCE(display_name, name)) IN (
          SELECT lower(COALESCE(display_name, name)) FROM players
          WHERE COALESCE(display_name, name) IS NOT NULL
            AND COALESCE(ignore_flag, 0) = 0
          GROUP BY lower(COALESCE(display_name, name))
          HAVING COUNT(*) > 1
        )
        AND COALESCE(ignore_flag, 0) = 0`
      )
      .all()

    const ids = rows.map((r) => r.player_id)
    expect(ids).toContain(999)
    expect(ids).toContain(997)
    expect(ids).not.toContain(998) // ignored — excluded

    db.prepare(`DELETE FROM players WHERE player_id IN (999, 998, 997)`).run()
  })
})

// ─── Player merge ──────────────────────────────────────────────────────────────
// Mirrors the transaction in POST /api/admin/merge-players

describe('player merge', () => {
  const KEEP = 103 // Leo Brown
  const DROP = 104 // Tom Wilson (has deliveries in seed data)

  afterAll(() => {
    // Re-seed to restore drop player's rows after the merge tests
    seed(process.env.DB_PATH)
  })

  it('reassigns deliveries from drop to keep player', () => {
    const dropBefore = db
      .prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`)
      .get(DROP).n
    expect(dropBefore).toBeGreaterThan(0)

    db.transaction(() => {
      // deliveries — four columns reference player IDs
      db.prepare(`UPDATE deliveries SET batter_id = ? WHERE batter_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE deliveries SET batter_id_ns = ? WHERE batter_id_ns = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE deliveries SET bowler_id = ? WHERE bowler_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE deliveries SET dismissed_batter_id = ? WHERE dismissed_batter_id = ?`).run(
        KEEP,
        DROP
      )
      // dismissals
      db.prepare(`UPDATE dismissals SET batter_id = ? WHERE batter_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE dismissals SET bowler_id = ? WHERE bowler_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE dismissals SET fielder_id = ? WHERE fielder_id = ?`).run(KEEP, DROP)
      // tables with unique constraints on (fixture, player)
      for (const tbl of ['player_flags', 'manual_batting', 'manual_bowling']) {
        db.prepare(`UPDATE OR IGNORE ${tbl} SET player_id = ? WHERE player_id = ?`).run(KEEP, DROP)
        db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(DROP)
      }
      // no unique constraint on player_id alone
      db.prepare(`UPDATE wk_assignments SET player_id = ? WHERE player_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE wk_errors SET player_id = ? WHERE player_id = ?`).run(KEEP, DROP)
      db.prepare(`UPDATE match_captains SET player_id = ? WHERE player_id = ?`).run(KEEP, DROP)
      db.prepare(`DELETE FROM players WHERE player_id = ?`).run(DROP)
    })()

    const dropAfter = db
      .prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`)
      .get(DROP).n
    expect(dropAfter).toBe(0)

    const keepAfter = db
      .prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`)
      .get(KEEP).n
    expect(keepAfter).toBeGreaterThan(dropBefore) // gained drop's deliveries

    const dropPlayer = db.prepare(`SELECT 1 FROM players WHERE player_id = ?`).get(DROP)
    expect(dropPlayer).toBeUndefined()
  })
})

// ─── Matches missing roles ─────────────────────────────────────────────────────
// Mirrors GET /api/admin/matches-missing-roles

describe('matches-missing-roles query', () => {
  it('returns all seeded fixtures as missing roles (no captains set)', () => {
    const rows = db
      .prepare(
        `SELECT f.fixture_id, f.home_team, f.away_team
         FROM fixtures f
         WHERE NOT EXISTS (
           SELECT 1 FROM match_captains mc
           WHERE mc.fixture_id = f.fixture_id
         )
         ORDER BY f.match_date DESC`
      )
      .all()
    // All seeded fixtures have no captains
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toHaveProperty('fixture_id')
      expect(row).toHaveProperty('home_team')
    }
  })
})

// ─── match_type update (PATCH /api/admin/match/:id/type) ─────────────────────

const VALID_MATCH_TYPES = ['league', 'cup', 'internal', 'indoor', 'friendly']

describe('match_type migration', () => {
  it('fixtures table has a match_type column', () => {
    const cols = db.prepare(`PRAGMA table_info(fixtures)`).all()
    const col = cols.find((c) => c.name === 'match_type')
    expect(col).toBeDefined()
    expect(col.dflt_value).toBe("'league'")
  })

  it('seeded fixtures default to league', () => {
    const row = db.prepare(`SELECT match_type FROM fixtures WHERE fixture_id = ?`).get('TEST_001')
    expect(row.match_type).toBe('league')
  })
})

describe('match_type PATCH logic', () => {
  afterEach(() => {
    db.prepare(`UPDATE fixtures SET match_type = 'league' WHERE fixture_id = ?`).run('TEST_001')
  })

  it('updates match_type to a valid value', () => {
    db.prepare(`UPDATE fixtures SET match_type = ? WHERE fixture_id = ?`).run('cup', 'TEST_001')
    const row = db.prepare(`SELECT match_type FROM fixtures WHERE fixture_id = ?`).get('TEST_001')
    expect(row.match_type).toBe('cup')
  })

  it('accepts all valid match_type values', () => {
    for (const t of VALID_MATCH_TYPES) {
      db.prepare(`UPDATE fixtures SET match_type = ? WHERE fixture_id = ?`).run(t, 'TEST_001')
      const row = db.prepare(`SELECT match_type FROM fixtures WHERE fixture_id = ?`).get('TEST_001')
      expect(row.match_type).toBe(t)
    }
  })

  it('returns 0 changes for a non-existent fixture_id', () => {
    const info = db
      .prepare(`UPDATE fixtures SET match_type = ? WHERE fixture_id = ?`)
      .run('cup', 'DOES_NOT_EXIST')
    expect(info.changes).toBe(0)
  })

  it('GET /api/admin/match/:id includes match_type in fixture object', () => {
    db.prepare(`UPDATE fixtures SET match_type = 'indoor' WHERE fixture_id = ?`).run('TEST_001')
    const row = db
      .prepare(`SELECT fixture_id, match_type FROM fixtures WHERE fixture_id = ?`)
      .get('TEST_001')
    expect(row.match_type).toBe('indoor')
  })
})

// ─── Duplicate-players query ───────────────────────────────────────────────────

describe('duplicate-players query', () => {
  it('returns empty when no duplicates exist in seeded data', () => {
    // Seed data has unique player names
    const rows = db
      .prepare(
        `SELECT player_id FROM players
         WHERE lower(COALESCE(display_name, name)) IN (
           SELECT lower(COALESCE(display_name, name)) FROM players
           WHERE COALESCE(display_name, name) IS NOT NULL
             AND COALESCE(ignore_flag, 0) = 0
           GROUP BY lower(COALESCE(display_name, name))
           HAVING COUNT(*) > 1
         )
         AND COALESCE(ignore_flag, 0) = 0`
      )
      .all()
    expect(rows).toEqual([])
  })
})

// ─── GET /api/admin/scheduler/browse-teams — annotation logic ─────────────────
// Mirrors the DB + annotation step in the route handler (no HTTP call needed).

describe('browse-teams watched annotation', () => {
  const TEAM_A = 10001
  const TEAM_B = 10002
  const TEAM_C = 10003

  const mockHtml = [
    '<option value="' + TEAM_A + '">Alpha XI</option>',
    '<option value="' + TEAM_B + '">Beta XI</option>',
    '<option value="' + TEAM_C + '">Gamma XI</option>'
  ].join('\n')

  beforeEach(() => {
    db.prepare('DELETE FROM watched_teams').run()
  })

  afterAll(() => {
    db.prepare('DELETE FROM watched_teams').run()
  })

  function annotate(teams, db) {
    const watchedIds = new Set(
      db
        .prepare('SELECT DISTINCT team_id FROM watched_teams')
        .all()
        .map((r) => r.team_id)
    )
    return teams.map((t) => ({ ...t, watched: watchedIds.has(t.team_id) }))
  }

  it('marks no teams as watched when watched_teams is empty', () => {
    const teams = parseClubTeams(mockHtml)
    const result = annotate(teams, db)
    expect(result.every((t) => !t.watched)).toBe(true)
  })

  it('marks only the watched team as watched', () => {
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_A, 259, 'Alpha XI 2025', 2025, new Date().toISOString())

    const teams = parseClubTeams(mockHtml)
    const result = annotate(teams, db)
    expect(result.find((t) => t.team_id === TEAM_A).watched).toBe(true)
    expect(result.find((t) => t.team_id === TEAM_B).watched).toBe(false)
    expect(result.find((t) => t.team_id === TEAM_C).watched).toBe(false)
  })

  it('marks all teams as watched when all are in watched_teams', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_A, 259, 'Alpha XI 2025', 2025, now)
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_B, 259, 'Beta XI 2025', 2025, now)
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_C, 259, 'Gamma XI 2025', 2025, now)

    const teams = parseClubTeams(mockHtml)
    const result = annotate(teams, db)
    expect(result.every((t) => t.watched)).toBe(true)
  })

  it('a team watched across multiple seasons is still marked watched once', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_A, 259, 'Alpha XI 2025', 2025, now)
    db.prepare(
      `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)`
    ).run(TEAM_A, 260, 'Alpha XI 2024', 2024, now)

    const teams = parseClubTeams(mockHtml)
    const result = annotate(teams, db)
    const alphaMatches = result.filter((t) => t.team_id === TEAM_A)
    expect(alphaMatches.length).toBe(1)
    expect(alphaMatches[0].watched).toBe(true)
  })
})

describe('expandFromScorecard — PDF name cross-reference', () => {
  it('expands an abbreviated name when exactly one full name matches', () => {
    const names = ['Leo Price', 'Tom Smith']
    expect(_expandFromScorecard('L Price', names)).toBe('Leo Price')
  })

  it('does not expand when two full names share the same initial and surname', () => {
    const names = ['Leo Price', 'Liam Price', 'Tom Smith']
    expect(_expandFromScorecard('L Price', names)).toBe('L Price')
  })

  it('returns the original when no full name matches the initial and surname', () => {
    const names = ['Tom Smith', 'Sam Jones']
    expect(_expandFromScorecard('L Price', names)).toBe('L Price')
  })

  it('does not expand a name that already has a full forename', () => {
    const names = ['Leo Price', 'Tom Smith']
    expect(_expandFromScorecard('Leo Price', names)).toBe('Leo Price')
  })

  it('is case-insensitive — expands "l price" against "Leo Price"', () => {
    const names = ['Leo Price', 'Tom Smith']
    expect(_expandFromScorecard('l price', names)).toBe('Leo Price')
  })

  it('handles dot-notated initials like "L. Price"', () => {
    const names = ['Leo Price', 'Tom Smith']
    expect(_expandFromScorecard('L. Price', names)).toBe('Leo Price')
  })

  it('does not match a different surname', () => {
    const names = ['Leo Pryce', 'Tom Smith']
    expect(_expandFromScorecard('L Price', names)).toBe('L Price')
  })

  it('does not expand against itself when the abbreviated name also appears in the list', () => {
    const names = ['L Price', 'Leo Price', 'Tom Smith']
    expect(_expandFromScorecard('L Price', names)).toBe('Leo Price')
  })
})

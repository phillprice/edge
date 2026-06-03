'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { _test: { autoAssociateTeam } } = require('./ingestMatch')

let db
beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('./schema').getDb()
})

beforeEach(() => {
  db.prepare('DELETE FROM scheduled_fixtures').run()
  db.prepare('DELETE FROM watched_teams').run()
  // Same team label watched across two seasons — the disambiguation case.
  db.prepare(`INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(239292, 258, 'U11 Hurricanes', '2025')
  db.prepare(`INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(239292, 259, 'U11 Hurricanes', '2026')
})

function seedFixture(fixtureId, pcId, year) {
  db.prepare(`INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
              VALUES (?, ?, ?, ?, ?)`)
    .run(fixtureId, String(pcId), 'Camberley CC - Under 11 Condors', 'WHCC U11 Hurricanes', `${year}-05-24`)
}

afterAll(() => {
  db.prepare(`DELETE FROM fixtures WHERE fixture_id IN ('assoc-2026','assoc-2025')`).run()
})

describe('autoAssociateTeam — year-aware season selection', () => {
  it('a 2026 match links to the 2026 season (259), not 2025 (258)', () => {
    seedFixture('assoc-2026', 25305193, 2026)
    const res = autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res).toEqual({ team_id: 239292, season_id: 259 })
    const row = db.prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(25305193)
    expect(row.season_id).toBe(259)
  })

  it('a 2025 match links to the 2025 season (258)', () => {
    seedFixture('assoc-2025', 25305194, 2025)
    const res = autoAssociateTeam(db, 25305194, 'assoc-2025')
    expect(res).toEqual({ team_id: 239292, season_id: 258 })
  })

  it('repairs a pre-existing wrong association on re-run', () => {
    seedFixture('assoc-2026', 25305193, 2026)
    // Simulate the old bug: a 2026 match wrongly linked to season 258.
    db.prepare(`INSERT INTO scheduled_fixtures (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'done')`)
      .run(25305193, 239292, 258, '2026-05-24', '2026-05-24', '2026-05-24')
    const res = autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res.season_id).toBe(259)
    const row = db.prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(25305193)
    expect(row.season_id).toBe(259)
  })

  it('returns null when no watched team label matches', () => {
    db.prepare(`INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
                VALUES ('assoc-none', '999', 'Foo CC', 'Bar CC', '2026-05-24')`).run()
    expect(autoAssociateTeam(db, 999, 'assoc-none')).toBeNull()
    db.prepare(`DELETE FROM fixtures WHERE fixture_id = 'assoc-none'`).run()
  })
})

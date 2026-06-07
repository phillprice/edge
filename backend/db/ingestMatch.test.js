'use strict'
const path = require('path')
// Tests use local SQLite via libsql file mode — clear Turso env so getDbAsync() uses file:
delete process.env.TURSO_DATABASE_URL
process.env.DB_PATH = path.join(__dirname, '..', 'test-ingestmatch.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { _test: { autoAssociateTeam } } = require('./ingestMatch')

let db
beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('./schema').getDbAsync()
})

beforeEach(async () => {
  await db.prepare('DELETE FROM scheduled_fixtures').run()
  await db.prepare('DELETE FROM watched_teams').run()
  await db.prepare(`INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(239292, 258, 'U11 Hurricanes', '2025')
  await db.prepare(`INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(239292, 259, 'U11 Hurricanes', '2026')
})

async function seedFixture(fixtureId, pcId, year) {
  await db.prepare(`INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
              VALUES (?, ?, ?, ?, ?)`)
    .run(fixtureId, String(pcId), 'Camberley CC - Under 11 Condors', 'WHCC U11 Hurricanes', `${year}-05-24`)
}

afterAll(async () => {
  await db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id IN ('assoc-2026','assoc-2025')`).run()
  await db.prepare(`DELETE FROM fixtures WHERE fixture_id IN ('assoc-2026','assoc-2025')`).run()
})

describe('autoAssociateTeam — year-aware season selection', () => {
  it('a 2026 match links to the 2026 season (259), not 2025 (258)', async () => {
    await seedFixture('assoc-2026', 25305193, 2026)
    const res = await autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res).toEqual({ team_id: 239292, season_id: 259 })
    const row = await db.prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(25305193)
    expect(row.season_id).toBe(259)
  })

  it('a 2025 match links to the 2025 season (258)', async () => {
    await seedFixture('assoc-2025', 25305194, 2025)
    const res = await autoAssociateTeam(db, 25305194, 'assoc-2025')
    expect(res).toEqual({ team_id: 239292, season_id: 258 })
  })

  it('repairs a pre-existing wrong association on re-run', async () => {
    await seedFixture('assoc-2026', 25305193, 2026)
    await db.prepare(`INSERT INTO scheduled_fixtures (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'done')`)
      .run(25305193, 239292, 258, '2026-05-24', '2026-05-24', '2026-05-24')
    const res = await autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res.season_id).toBe(259)
    const row = await db.prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(25305193)
    expect(row.season_id).toBe(259)
  })

  it('returns null when no watched team label matches', async () => {
    await db.prepare(`INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
                VALUES ('assoc-none', '999', 'Foo CC', 'Bar CC', '2026-05-24')`).run()
    const res = await autoAssociateTeam(db, 999, 'assoc-none')
    expect(res).toBeNull()
    await db.prepare(`DELETE FROM fixtures WHERE fixture_id = 'assoc-none'`).run()
  })
})

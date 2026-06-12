'use strict'
// Integration test: prove buildAccessFilter's generated SQL actually restricts fixtures
// when run against a real DB, scoping via the fixture_seasons mapping table.
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { buildAccessFilter } = require('../utils/access')
const { claimsToCtx } = require('../middleware/auth')

// Simulate the verified context attachAuthContext would attach for given metadata.
function mkReq(metadata) {
  return { authCtx: claimsToCtx({ metadata }) }
}

let db
beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()

  // Associate two seeded fixtures with two different team/season combos via fixture_seasons
  // (the table the access filter joins on — covers ingested and manual matches alike).
  const ins = db.prepare(
    `INSERT OR REPLACE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)`
  )
  ins.run('25577112', 111, 259) // Whirlwinds 2026
  ins.run('TEST_001', 222, 259) // Hurricanes 2026
})

function fixturesFor(filter) {
  const where = filter ? `WHERE ${filter.sql}` : ''
  return db
    .prepare(`SELECT f.fixture_id FROM fixtures f ${where}`)
    .all(...(filter?.params ?? []))
    .map((r) => r.fixture_id)
}

describe('buildAccessFilter — live SQL against seeded DB', () => {
  it('super admin sees all fixtures (no filter)', () => {
    const filter = buildAccessFilter(mkReq({ isSuperAdmin: true }))
    expect(filter).toBeNull()
    // null filter → caller applies no WHERE → all fixtures visible
    const all = db.prepare('SELECT COUNT(*) AS n FROM fixtures').get().n
    expect(all).toBeGreaterThan(1)
  })

  it('user with one team/season sees only that linked fixture', () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 111, season_id: 259 }] }))
    const ids = fixturesFor(filter)
    expect(ids).toEqual(['25577112'])
  })

  it('user with the other team/season sees only its fixture', () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 222, season_id: 259 }] }))
    const ids = fixturesFor(filter)
    expect(ids).toEqual(['TEST_001'])
  })

  it('user with both groups sees both linked fixtures', () => {
    const filter = buildAccessFilter(
      mkReq({
        accessGroups: [
          { team_id: 111, season_id: 259 },
          { team_id: 222, season_id: 259 }
        ]
      })
    )
    const ids = fixturesFor(filter).sort()
    expect(ids).toEqual(['25577112', 'TEST_001'])
  })

  it('user with a non-matching team/season sees nothing', () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 999, season_id: 999 }] }))
    expect(fixturesFor(filter)).toEqual([])
  })

  it('authenticated user with no groups sees nothing', () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [] }))
    expect(fixturesFor(filter)).toEqual([])
  })

  it('a manual match (no play_cricket_id) is visible to a scoped user when associated', () => {
    // Regression: the old filter scoped via scheduled_fixtures.play_cricket_id, so manual
    // matches (play_cricket_id NULL) were invisible to non-super-admins.
    db.prepare(
      `INSERT INTO fixtures (fixture_id, home_team, away_team, match_date) VALUES ('manual-acc-1', 'WHCC U11 Whirlwinds', 'Some Opp', '2026-05-01')`
    ).run()
    db.prepare(
      `INSERT INTO fixture_seasons (fixture_id, team_id, season_id) VALUES ('manual-acc-1', 111, 259)`
    ).run()

    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 111, season_id: 259 }] }))
    expect(fixturesFor(filter).sort()).toEqual(['25577112', 'manual-acc-1'])

    db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id = 'manual-acc-1'`).run()
    db.prepare(`DELETE FROM fixtures WHERE fixture_id = 'manual-acc-1'`).run()
  })
})

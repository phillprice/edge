'use strict'
// Integration test: prove buildAccessFilter's generated SQL actually restricts fixtures
// when run against a real DB linking fixtures → scheduled_fixtures by play_cricket_id.
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
process.env.CLERK_SECRET_KEY = 'sk_test_dummy'

const { execSync } = require('child_process')
const { buildAccessFilter } = require('../utils/access')

function mkReq(metadata) {
  const payload = Buffer.from(JSON.stringify({ metadata })).toString('base64')
  return { headers: { authorization: `Bearer x.${payload}.y` } }
}

let db
beforeAll(() => {
  execSync(`node ${path.join(__dirname, '..', 'scripts', 'seed-test-db.js')}`, { stdio: 'pipe' })
  db = require('../db/schema').getDb()

  // Link two seeded fixtures to play-cricket IDs and create scheduled_fixtures rows
  // for two different team/season combos.
  db.prepare(`UPDATE fixtures SET play_cricket_id = '900001' WHERE fixture_id = '25577112'`).run()
  db.prepare(`UPDATE fixtures SET play_cricket_id = '900002' WHERE fixture_id = 'TEST_001'`).run()

  const ins = db.prepare(`
    INSERT OR REPLACE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'done')
  `)
  ins.run(900001, 111, 259, '2026-04-29', '2026-04-29', '2026-04-29')  // Whirlwinds 2026
  ins.run(900002, 222, 259, '2026-04-22', '2026-04-22', '2026-04-22')  // Hurricanes 2026
})

function fixturesFor(filter) {
  const where = filter ? `WHERE ${filter.sql}` : ''
  return db.prepare(`SELECT f.fixture_id FROM fixtures f ${where}`).all(...(filter?.params ?? []))
    .map(r => r.fixture_id)
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
    const filter = buildAccessFilter(mkReq({ accessGroups: [
      { team_id: 111, season_id: 259 },
      { team_id: 222, season_id: 259 },
    ] }))
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
})

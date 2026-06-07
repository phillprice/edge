'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test-access.sqlite')
delete process.env.TURSO_DATABASE_URL

const { seed } = require('../scripts/seed-test-db')
const { buildAccessFilter } = require('../utils/access')
const { claimsToCtx } = require('../middleware/auth')

function mkReq(metadata) {
  return { authCtx: claimsToCtx({ metadata }) }
}

let db
beforeAll(async () => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDbAsync()

  await db.prepare(`INSERT OR REPLACE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)`).run('25577112', 111, 259)
  await db.prepare(`INSERT OR REPLACE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)`).run('TEST_001', 222, 259)
})

async function fixturesFor(filter) {
  const where = filter ? `WHERE ${filter.sql}` : ''
  return (await db.prepare(`SELECT f.fixture_id FROM fixtures f ${where}`).all(...(filter?.params ?? [])))
    .map(r => r.fixture_id)
}

describe('buildAccessFilter — live SQL against seeded DB', () => {
  it('super admin sees all fixtures (no filter)', async () => {
    const filter = buildAccessFilter(mkReq({ isSuperAdmin: true }))
    expect(filter).toBeNull()
    const row = await db.prepare('SELECT COUNT(*) AS n FROM fixtures').get()
    expect(row.n).toBeGreaterThan(1)
  })

  it('user with one team/season sees only that linked fixture', async () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 111, season_id: 259 }] }))
    const ids = await fixturesFor(filter)
    expect(ids).toEqual(['25577112'])
  })

  it('user with the other team/season sees only its fixture', async () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 222, season_id: 259 }] }))
    const ids = await fixturesFor(filter)
    expect(ids).toEqual(['TEST_001'])
  })

  it('user with both groups sees both linked fixtures', async () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [
      { team_id: 111, season_id: 259 },
      { team_id: 222, season_id: 259 },
    ] }))
    const ids = (await fixturesFor(filter)).sort()
    expect(ids).toEqual(['25577112', 'TEST_001'])
  })

  it('user with a non-matching team/season sees nothing', async () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 999, season_id: 999 }] }))
    expect(await fixturesFor(filter)).toEqual([])
  })

  it('authenticated user with no groups sees nothing', async () => {
    const filter = buildAccessFilter(mkReq({ accessGroups: [] }))
    expect(await fixturesFor(filter)).toEqual([])
  })

  it('a manual match (no play_cricket_id) is visible to a scoped user when associated', async () => {
    await db.prepare(`INSERT INTO fixtures (fixture_id, home_team, away_team, match_date) VALUES ('manual-acc-1', 'WHCC U11 Whirlwinds', 'Some Opp', '2026-05-01')`).run()
    await db.prepare(`INSERT INTO fixture_seasons (fixture_id, team_id, season_id) VALUES ('manual-acc-1', 111, 259)`).run()

    const filter = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 111, season_id: 259 }] }))
    expect((await fixturesFor(filter)).sort()).toEqual(['25577112', 'manual-acc-1'])

    await db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id = 'manual-acc-1'`).run()
    await db.prepare(`DELETE FROM fixtures WHERE fixture_id = 'manual-acc-1'`).run()
  })
})

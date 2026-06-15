'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const {
  reAssociateAllFixtures,
  _test: { autoAssociateTeam }
} = require('./ingestMatch')

let db
beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('./schema').getDb()
})

beforeEach(() => {
  db.prepare('DELETE FROM scheduled_fixtures').run()
  db.prepare('DELETE FROM watched_teams').run()
  // Same team label watched across two seasons — the disambiguation case.
  db.prepare(
    `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(239292, 258, 'U11 Hurricanes', '2025')
  db.prepare(
    `INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(239292, 259, 'U11 Hurricanes', '2026')
})

function seedFixture(fixtureId, pcId, year) {
  db.prepare(
    `INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
              VALUES (?, ?, ?, ?, ?)`
  ).run(
    fixtureId,
    String(pcId),
    'Camberley CC - Under 11 Condors',
    'WHCC U11 Hurricanes',
    `${year}-05-24`
  )
}

afterAll(() => {
  db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id IN ('assoc-2026','assoc-2025')`).run()
  db.prepare(`DELETE FROM fixtures WHERE fixture_id IN ('assoc-2026','assoc-2025')`).run()
})

describe('autoAssociateTeam — year-aware season selection', () => {
  it('a 2026 match links to the 2026 season (259), not 2025 (258)', () => {
    seedFixture('assoc-2026', 25305193, 2026)
    const res = autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res).toEqual({ team_id: 239292, season_id: 259 })
    const row = db
      .prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?')
      .get(25305193)
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
    db.prepare(
      `INSERT INTO scheduled_fixtures (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'done')`
    ).run(25305193, 239292, 258, '2026-05-24', '2026-05-24', '2026-05-24')
    const res = autoAssociateTeam(db, 25305193, 'assoc-2026')
    expect(res.season_id).toBe(259)
    const row = db
      .prepare('SELECT season_id FROM scheduled_fixtures WHERE play_cricket_id = ?')
      .get(25305193)
    expect(row.season_id).toBe(259)
  })

  it('returns null when no watched team label matches', () => {
    db.prepare(
      `INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
                VALUES ('assoc-none', '999', 'Foo CC', 'Bar CC', '2026-05-24')`
    ).run()
    expect(autoAssociateTeam(db, 999, 'assoc-none', [])).toBeNull()
    db.prepare(`DELETE FROM fixtures WHERE fixture_id = 'assoc-none'`).run()
  })
})

describe('autoAssociateTeam — Priority 2: HTML team IDs', () => {
  const FIXTURE_ID = 'html-teamid-1'
  const PC_ID = 9880001

  beforeEach(() => {
    // top-level beforeEach has cleared scheduled_fixtures and watched_teams
    // and re-inserted team 239292 (seasons 258/2025 and 259/2026)
    db.prepare(
      `INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
       VALUES (?, ?, 'Camberley CC', 'WHCC U11 Hurricanes', '2026-06-01')`
    ).run(FIXTURE_ID, String(PC_ID))
  })

  afterEach(() => {
    db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id = ?`).run(FIXTURE_ID)
    db.prepare(`DELETE FROM fixtures WHERE fixture_id = ?`).run(FIXTURE_ID)
    db.prepare(`DELETE FROM scheduled_fixtures WHERE play_cricket_id = ?`).run(PC_ID)
  })

  it('associates via HTML team ID when no scheduled_fixtures row exists', () => {
    const res = autoAssociateTeam(db, PC_ID, FIXTURE_ID, [239292])
    expect(res).toEqual({ team_id: 239292, season_id: 259 })
    const fsRow = db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ?')
      .get(FIXTURE_ID)
    expect(fsRow.team_id).toBe(239292)
    expect(fsRow.season_id).toBe(259)
  })

  it('creates a scheduled_fixtures row so future re-ingests use Priority 1', () => {
    autoAssociateTeam(db, PC_ID, FIXTURE_ID, [239292])
    const sfRow = db
      .prepare('SELECT team_id, season_id FROM scheduled_fixtures WHERE play_cricket_id = ?')
      .get(PC_ID)
    expect(sfRow).toBeDefined()
    expect(sfRow.team_id).toBe(239292)
    expect(sfRow.season_id).toBe(259)
  })

  it('ignores opponent team IDs not in watched_teams', () => {
    // Simulate both home and away team IDs from the HTML; only 239292 is watched
    const res = autoAssociateTeam(db, PC_ID, FIXTURE_ID, [555999, 239292, 666111])
    expect(res?.team_id).toBe(239292)
  })

  it('picks the year-matched season when multiple seasons exist for the same team', () => {
    // 2026 fixture → should get season 259, not 258
    const res = autoAssociateTeam(db, PC_ID, FIXTURE_ID, [239292])
    expect(res?.season_id).toBe(259)
  })

  it('skips Priority 2 and falls through to label matching when htmlTeamIds is empty', () => {
    // No htmlTeamIds — the WHCC side name contains the label "U11 Hurricanes"
    const res = autoAssociateTeam(db, PC_ID, FIXTURE_ID, [])
    expect(res?.team_id).toBe(239292)
  })
})

describe('reAssociateAllFixtures — startup sweep', () => {
  const FIXTURE_ID = 'reassoc-sweep-1'
  const PC_ID = 9990001

  beforeEach(() => {
    // top-level beforeEach has already cleared scheduled_fixtures and watched_teams
    // and inserted team 239292 with seasons 258 (year 2025) and 259 (year 2026)
    db.prepare(
      `INSERT OR REPLACE INTO fixtures (fixture_id, play_cricket_id, home_team, away_team, match_date_iso)
       VALUES (?, ?, 'Camberley CC', 'WHCC U11 Hurricanes', '2026-07-01')`
    ).run(FIXTURE_ID, String(PC_ID))
    db.prepare(
      `INSERT INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'done')`
    ).run(PC_ID, 239292, 259, '2026-07-01', '2026-07-01', '2026-07-01')
  })

  afterEach(() => {
    db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id = ?`).run(FIXTURE_ID)
    db.prepare(`DELETE FROM fixtures WHERE fixture_id = ?`).run(FIXTURE_ID)
    db.prepare(`DELETE FROM scheduled_fixtures WHERE play_cricket_id = ?`).run(PC_ID)
  })

  it('corrects a mis-associated fixture_seasons row', () => {
    // Simulate old wrong association: correct team but wrong season
    db.prepare(`INSERT INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)`).run(
      FIXTURE_ID,
      239292,
      258
    )

    reAssociateAllFixtures(db)

    const row = db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ?')
      .get(FIXTURE_ID)
    expect(row.team_id).toBe(239292)
    expect(row.season_id).toBe(259)
  })

  it('creates a fixture_seasons row when none exists', () => {
    reAssociateAllFixtures(db)

    const row = db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ?')
      .get(FIXTURE_ID)
    expect(row).toBeDefined()
    expect(row.team_id).toBe(239292)
    expect(row.season_id).toBe(259)
  })

  it('leaves a correctly-associated fixture_seasons row unchanged', () => {
    db.prepare(`INSERT INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)`).run(
      FIXTURE_ID,
      239292,
      259
    )

    reAssociateAllFixtures(db)

    const row = db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ?')
      .get(FIXTURE_ID)
    expect(row.team_id).toBe(239292)
    expect(row.season_id).toBe(259)
  })
})

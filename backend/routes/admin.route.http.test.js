'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
delete process.env.CLERK_SECRET_KEY

const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')
const { buildTestApp } = require('./test-helpers')

function buildApp() {
  return buildTestApp('/api/admin', require('./admin'))
}

let app
let db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()
  app = buildApp()
})

afterAll(() => {
  db.prepare(`UPDATE players SET display_name = NULL WHERE player_id IN (101, 103)`).run()
  db.prepare(`UPDATE players SET is_sub = 0 WHERE player_id = 103`).run()
  db.prepare(`UPDATE players SET ignore_flag = 0 WHERE player_id = 303`).run()
  db.prepare(`UPDATE fixtures SET match_type = 'league' WHERE fixture_id = 'TEST_001'`).run()
  db.prepare(`DELETE FROM players WHERE player_id IN (999, 998, 997)`).run()
})

// ─── PATCH /api/admin/player/:id — display_name ───────────────────────────────

describe('PATCH /api/admin/player/:id display_name', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET display_name = NULL WHERE player_id = 101`).run()
  })

  it('sets display_name', async () => {
    const res = await request(app)
      .patch('/api/admin/player/101')
      .send({ display_name: 'Sam Lawrence' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const row = db.prepare(`SELECT display_name FROM players WHERE player_id = 101`).get()
    expect(row.display_name).toBe('Sam Lawrence')
  })

  it('clears display_name when sent as empty string', async () => {
    db.prepare(`UPDATE players SET display_name = 'Sam L' WHERE player_id = 101`).run()
    const res = await request(app).patch('/api/admin/player/101').send({ display_name: '' })
    expect(res.status).toBe(200)
    const row = db.prepare(`SELECT display_name FROM players WHERE player_id = 101`).get()
    expect(row.display_name).toBeNull()
  })
})

// ─── PATCH /api/admin/player/:id — is_sub ────────────────────────────────────

describe('PATCH /api/admin/player/:id is_sub', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET is_sub = 0 WHERE player_id = 103`).run()
  })

  it('marks a player as sub', async () => {
    const res = await request(app).patch('/api/admin/player/103').send({ is_sub: true })
    expect(res.status).toBe(200)
    const row = db.prepare(`SELECT is_sub FROM players WHERE player_id = 103`).get()
    expect(row.is_sub).toBe(1)
  })

  it('unmarks a player as sub', async () => {
    db.prepare(`UPDATE players SET is_sub = 1 WHERE player_id = 103`).run()
    const res = await request(app).patch('/api/admin/player/103').send({ is_sub: false })
    expect(res.status).toBe(200)
    const row = db.prepare(`SELECT is_sub FROM players WHERE player_id = 103`).get()
    expect(row.is_sub).toBe(0)
  })
})

// ─── PATCH /api/admin/player/:id — ignore_flag ───────────────────────────────

describe('PATCH /api/admin/player/:id ignore_flag', () => {
  afterEach(() => {
    db.prepare(`UPDATE players SET ignore_flag = 0 WHERE player_id = 303`).run()
  })

  it('sets ignore_flag', async () => {
    const res = await request(app).patch('/api/admin/player/303').send({ ignore_flag: true })
    expect(res.status).toBe(200)
    const row = db.prepare(`SELECT ignore_flag FROM players WHERE player_id = 303`).get()
    expect(row.ignore_flag).toBe(1)
  })

  it('auto-creates and flags an unknown player (route upserts)', async () => {
    // The route inserts a placeholder row for unknown player_ids rather than 404ing,
    // so unknown IDs still return 200.
    const res = await request(app).patch('/api/admin/player/99999').send({ ignore_flag: true })
    expect(res.status).toBe(200)
    db.prepare(`DELETE FROM players WHERE player_id = 99999`).run()
  })
})

// ─── PATCH /api/admin/match/:id/type ─────────────────────────────────────────

describe('PATCH /api/admin/match/:id/type', () => {
  afterEach(() => {
    db.prepare(`UPDATE fixtures SET match_type = 'league' WHERE fixture_id = 'TEST_001'`).run()
  })

  it('updates match_type to a valid value (legacy single string)', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ match_type: 'cup' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.tags).toContain('cup')
    const row = db.prepare(`SELECT match_type FROM fixtures WHERE fixture_id = 'TEST_001'`).get()
    expect(row.match_type).toBe('cup')
  })

  it('normalises match_type to lowercase', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ match_type: 'FRIENDLY' })
    expect(res.status).toBe(200)
    expect(res.body.tags).toContain('friendly')
  })

  it('accepts tags[] for multi-tag (e.g. friendly + indoor)', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ tags: ['friendly', 'indoor'] })
    expect(res.status).toBe(200)
    expect(res.body.tags).toEqual(expect.arrayContaining(['friendly', 'indoor']))
    const tagRows = db
      .prepare(`SELECT tag FROM fixture_tags WHERE fixture_id = 'TEST_001'`)
      .all()
      .map((r) => r.tag)
    expect(tagRows).toEqual(expect.arrayContaining(['friendly', 'indoor']))
  })

  it('rejects an invalid match_type', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ match_type: 'invalid' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/match_type must be one of/)
  })

  it('returns 404 for unknown fixture', async () => {
    const res = await request(app)
      .patch('/api/admin/match/DOES_NOT_EXIST/type')
      .send({ match_type: 'cup' })
    expect(res.status).toBe(404)
  })

  it('accepts all valid match_type values', async () => {
    for (const t of ['league', 'cup', 'internal', 'indoor', 'friendly']) {
      const res = await request(app).patch('/api/admin/match/TEST_001/type').send({ match_type: t })
      expect(res.status).toBe(200)
      expect(res.body.tags).toContain(t)
    }
  })
})

// ─── POST /api/admin/merge-players ───────────────────────────────────────────

function deliveryCount(dbRef, batterId) {
  return dbRef.prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`).get(batterId).n
}

describe('POST /api/admin/merge-players', () => {
  const KEEP = 103 // Leo Brown
  const DROP = 104 // Tom Wilson (has deliveries in seed data)

  afterAll(() => {
    seed(process.env.DB_PATH)
    db = require('../db/schema').getDb()
  })

  it('reassigns deliveries from dropped player to kept player', async () => {
    const dropBefore = deliveryCount(db, DROP)
    expect(dropBefore).toBeGreaterThan(0)

    const res = await request(app)
      .post('/api/admin/merge-players')
      .send({ keepId: KEEP, dropId: DROP })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const dropAfter = deliveryCount(db, DROP)
    expect(dropAfter).toBe(0)

    const dropPlayer = db.prepare(`SELECT 1 FROM players WHERE player_id = ?`).get(DROP)
    expect(dropPlayer).toBeUndefined()
  })
})

// ─── POST /api/admin/associate-match ──────────────────────────────────────────

describe('POST /api/admin/associate-match', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/admin/associate-match')
      .send({ fixture_id: '25577112' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 for a zero team_id/season_id (falsy, same as missing)', async () => {
    const res = await request(app)
      .post('/api/admin/associate-match')
      .send({ fixture_id: '25577112', team_id: 0, season_id: 0 })
    expect(res.status).toBe(400)
  })

  it('passes validation and reaches the business-logic check for a well-formed body', async () => {
    // Seeded fixture 25577112 has no play_cricket_id, so this should get past validation
    // and fail on the (pre-existing, unrelated) business-logic check, not a 400 from zod.
    const res = await request(app)
      .post('/api/admin/associate-match')
      .send({ fixture_id: '25577112', team_id: 1, season_id: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/play_cricket_id/)
  })
})

// ─── POST /api/admin/import/scorecard-commit ──────────────────────────────────

describe('POST /api/admin/import/scorecard-commit', () => {
  afterEach(() => {
    const ids = db
      .prepare(`SELECT fixture_id FROM fixtures WHERE fixture_id LIKE 'manual-%'`)
      .all()
      .map((r) => r.fixture_id)
    for (const fid of ids) {
      db.prepare(
        `DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id = ?)`
      ).run(fid)
      db.prepare(`DELETE FROM innings WHERE fixture_id = ?`).run(fid)
      db.prepare(`DELETE FROM manual_batting WHERE fixture_id = ?`).run(fid)
      db.prepare(`DELETE FROM manual_bowling WHERE fixture_id = ?`).run(fid)
      db.prepare(`DELETE FROM fixture_tags WHERE fixture_id = ?`).run(fid)
      db.prepare(`DELETE FROM fixtures WHERE fixture_id = ?`).run(fid)
    }
  })

  it('returns 400 when home_team/away_team are missing', async () => {
    const res = await request(app)
      .post('/api/admin/import/scorecard-commit')
      .send({ innings: [{ batting: [], bowling: [] }] })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 when innings is not an array', async () => {
    const res = await request(app).post('/api/admin/import/scorecard-commit').send({
      home_team: 'Home CC',
      away_team: 'Away CC',
      innings: 'not-an-array'
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when innings has more than 2 entries', async () => {
    const res = await request(app)
      .post('/api/admin/import/scorecard-commit')
      .send({
        home_team: 'Home CC',
        away_team: 'Away CC',
        innings: [{}, {}, {}]
      })
    expect(res.status).toBe(400)
  })

  it('creates a fixture for a well-formed minimal payload', async () => {
    const res = await request(app)
      .post('/api/admin/import/scorecard-commit')
      .send({
        home_team: 'Home CC',
        away_team: 'Away CC',
        match_date: '2026-06-01',
        innings: [
          { batting: [], bowling: [] },
          { batting: [], bowling: [] }
        ]
      })
    expect(res.status).toBe(200)
    expect(res.body.fixture_id).toMatch(/^manual-/)
    const fixture = db
      .prepare('SELECT * FROM fixtures WHERE fixture_id = ?')
      .get(res.body.fixture_id)
    expect(fixture).toBeDefined()
    expect(fixture.home_team).toBe('Home CC')
  })
})

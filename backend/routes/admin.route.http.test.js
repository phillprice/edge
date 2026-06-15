'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
delete process.env.CLERK_SECRET_KEY

const express = require('express')
const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.authCtx = {
      verified: true,
      userId: 'test-user',
      isSuperAdmin: true,
      isClubAdmin: true,
      canUpload: true,
      accessGroups: []
    }
    next()
  })
  app.use('/api/admin', require('./admin'))
  return app
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

  it('updates match_type to a valid value', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ match_type: 'cup' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, match_type: 'cup' })
    const row = db.prepare(`SELECT match_type FROM fixtures WHERE fixture_id = 'TEST_001'`).get()
    expect(row.match_type).toBe('cup')
  })

  it('normalises match_type to lowercase', async () => {
    const res = await request(app)
      .patch('/api/admin/match/TEST_001/type')
      .send({ match_type: 'FRIENDLY' })
    expect(res.status).toBe(200)
    expect(res.body.match_type).toBe('friendly')
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
      expect(res.body.match_type).toBe(t)
    }
  })
})

// ─── POST /api/admin/merge-players ───────────────────────────────────────────

describe('POST /api/admin/merge-players', () => {
  const KEEP = 103 // Leo Brown
  const DROP = 104 // Tom Wilson (has deliveries in seed data)

  afterAll(() => {
    seed(process.env.DB_PATH)
    db = require('../db/schema').getDb()
  })

  it('reassigns deliveries from dropped player to kept player', async () => {
    const dropBefore = db
      .prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`)
      .get(DROP).n
    expect(dropBefore).toBeGreaterThan(0)

    const res = await request(app)
      .post('/api/admin/merge-players')
      .send({ keepId: KEEP, dropId: DROP })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const dropAfter = db
      .prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE batter_id = ?`)
      .get(DROP).n
    expect(dropAfter).toBe(0)

    const dropPlayer = db.prepare(`SELECT 1 FROM players WHERE player_id = ?`).get(DROP)
    expect(dropPlayer).toBeUndefined()
  })
})

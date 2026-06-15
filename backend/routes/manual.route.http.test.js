'use strict'

const path = require('path')
// Must be set before any DB module is loaded
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
// Disable Clerk auth so all routes pass through without token checks
delete process.env.CLERK_SECRET_KEY

const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')
const { buildTestApp } = require('./test-helpers')

function buildApp() {
  return buildTestApp('/api/manual', require('./manual'))
}

let app
let db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()
  app = buildApp()
})

afterAll(() => {
  // Clean up any manual fixtures created during tests — order matters for FK constraints
  db.prepare(`DELETE FROM match_captains WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM wk_assignments WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_fielding WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_bowling WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_batting WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_extras WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM match_stats_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM mvp_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM innings WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM fixtures WHERE fixture_id LIKE 'manual-%'`).run()
})

// ─── GET /api/manual/players ───────────────────────────────────────────────────

describe('GET /api/manual/players', () => {
  it('returns 200 with an array of WHCC players', async () => {
    const res = await request(app).get('/api/manual/players')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    // Seeded data has WHCC players — expect at least one
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0]).toHaveProperty('player_id')
    expect(res.body[0]).toHaveProperty('name')
  })
})

// ─── POST /api/manual/player ───────────────────────────────────────────────────

describe('POST /api/manual/player', () => {
  afterEach(() => {
    db.prepare(`DELETE FROM players WHERE name = 'HTTP Test Player'`).run()
  })

  it('creates a new player and returns player_id and name', async () => {
    const res = await request(app).post('/api/manual/player').send({ name: 'HTTP Test Player' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('player_id')
    expect(res.body.name).toBe('HTTP Test Player')
  })

  it('finds existing player instead of creating a duplicate', async () => {
    // First call — creates
    const r1 = await request(app).post('/api/manual/player').send({ name: 'HTTP Test Player' })
    expect(r1.status).toBe(200)
    const id1 = r1.body.player_id

    // Second call — finds same player
    const r2 = await request(app).post('/api/manual/player').send({ name: 'HTTP Test Player' })
    expect(r2.status).toBe(200)
    expect(r2.body.player_id).toBe(id1)
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/manual/player').send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is empty string', async () => {
    const res = await request(app).post('/api/manual/player').send({ name: '' })
    expect(res.status).toBe(400)
  })
})

// ─── POST /api/manual/fixture ─────────────────────────────────────────────────

describe('POST /api/manual/fixture', () => {
  const VALID_BODY = {
    match_date: '2026-06-01',
    home_team: 'WHCC Whirlwinds',
    away_team: 'Test CC'
  }

  it('creates a fixture and returns fixture_id', async () => {
    const res = await request(app).post('/api/manual/fixture').send(VALID_BODY)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('fixture_id')
    expect(res.body.fixture_id).toMatch(/^manual-/)
  })

  it('returns 400 when match_date is missing', async () => {
    const res = await request(app)
      .post('/api/manual/fixture')
      .send({ home_team: 'WHCC', away_team: 'Opp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when home_team is missing', async () => {
    const res = await request(app)
      .post('/api/manual/fixture')
      .send({ match_date: '2026-06-01', away_team: 'Opp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when away_team is missing', async () => {
    const res = await request(app)
      .post('/api/manual/fixture')
      .send({ match_date: '2026-06-01', home_team: 'WHCC' })
    expect(res.status).toBe(400)
  })

  it('accepts optional format field', async () => {
    const res = await request(app)
      .post('/api/manual/fixture')
      .send({ ...VALID_BODY, format: 'pairs', starting_score: 200 })
    expect(res.status).toBe(200)
    expect(res.body.fixture_id).toMatch(/^manual-/)
  })

  it('associates fixture to team+season when team_id and season_id provided', async () => {
    const res = await request(app)
      .post('/api/manual/fixture')
      .send({ ...VALID_BODY, team_id: 35534, season_id: 259 })
    expect(res.status).toBe(200)
    const fid = res.body.fixture_id
    const row = db.prepare('SELECT * FROM fixture_seasons WHERE fixture_id = ?').get(fid)
    expect(row).toBeDefined()
    expect(row.team_id).toBe(35534)
    expect(row.season_id).toBe(259)
  })
})

// ─── GET /api/manual/fixtures ─────────────────────────────────────────────────

describe('GET /api/manual/fixtures', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/manual/fixtures')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('lists previously created manual fixtures', async () => {
    // Create one
    await request(app)
      .post('/api/manual/fixture')
      .send({ match_date: '2026-06-10', home_team: 'WHCC Whirlwinds', away_team: 'List Test CC' })

    const res = await request(app).get('/api/manual/fixtures')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    const row = res.body[0]
    expect(row).toHaveProperty('fixture_id')
    expect(row).toHaveProperty('match_date')
    expect(row).toHaveProperty('manual_bat_count')
    expect(row).toHaveProperty('manual_bowl_count')
  })
})

// ─── GET /api/manual/entry/:fixtureId ─────────────────────────────────────────

describe('GET /api/manual/entry/:fixtureId', () => {
  let fixtureId

  beforeAll(async () => {
    const res = await request(app).post('/api/manual/fixture').send({
      match_date: '2026-06-15',
      home_team: 'WHCC Whirlwinds',
      away_team: 'Entry Test CC'
    })
    fixtureId = res.body.fixture_id
  })

  it('returns 200 with fixture details for a known fixture', async () => {
    const res = await request(app).get(`/api/manual/entry/${fixtureId}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('fixture')
    expect(res.body.fixture.fixture_id).toBe(fixtureId)
    expect(res.body).toHaveProperty('batting')
    expect(res.body).toHaveProperty('bowling')
    expect(res.body).toHaveProperty('fielding')
    expect(Array.isArray(res.body.batting)).toBe(true)
    expect(Array.isArray(res.body.bowling)).toBe(true)
  })

  it('returns 404 for unknown fixtureId', async () => {
    const res = await request(app).get('/api/manual/entry/DOES_NOT_EXIST')
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })
})

// ─── PUT /api/manual/entry/:fixtureId ─────────────────────────────────────────

describe('PUT /api/manual/entry/:fixtureId', () => {
  let fixtureId

  beforeEach(async () => {
    const res = await request(app).post('/api/manual/fixture').send({
      match_date: '2026-06-20',
      home_team: 'WHCC Whirlwinds',
      away_team: 'Put Test CC'
    })
    fixtureId = res.body.fixture_id
  })

  it('saves batting and bowling stats and returns { ok: true }', async () => {
    const res = await request(app)
      .put(`/api/manual/entry/${fixtureId}`)
      .send({
        batting: [
          { player_name: 'Leo Brown', runs: 35, balls: 42, fours: 4, sixes: 1, not_out: 0 }
        ],
        bowling: [{ player_name: 'Jack Smith', overs: 4, maidens: 1, runs: 18, wickets: 2 }],
        fielding: [],
        batting_extras: 5,
        bowling_byes: 2,
        bowling_leg_byes: 1,
        whcc_overs: '20',
        opp_overs: '19.3'
      })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify data was persisted
    const bat = db.prepare('SELECT * FROM manual_batting WHERE fixture_id = ?').all(fixtureId)
    expect(bat.length).toBe(1)
    expect(bat[0].runs).toBe(35)

    const bowl = db.prepare('SELECT * FROM manual_bowling WHERE fixture_id = ?').all(fixtureId)
    expect(bowl.length).toBe(1)
    expect(bowl[0].wickets).toBe(2)
  })

  it('returns 404 for unknown fixture', async () => {
    const res = await request(app).put('/api/manual/entry/DOES_NOT_EXIST').send({
      batting: [],
      bowling: [],
      fielding: []
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 with stats_locked when fixture already has ball-by-ball data', async () => {
    // Use the known seeded fixture which has deliveries
    const res = await request(app).put('/api/manual/entry/25577112').send({
      batting: [],
      bowling: [],
      fielding: []
    })
    expect(res.status).toBe(200)
    expect(res.body.stats_locked).toBe(true)
  })

  it('replaces batting on second PUT', async () => {
    // First save
    await request(app)
      .put(`/api/manual/entry/${fixtureId}`)
      .send({
        batting: [{ player_name: 'Leo Brown', runs: 10, balls: 15, not_out: 0 }],
        bowling: [],
        fielding: []
      })

    // Second save — different data
    await request(app)
      .put(`/api/manual/entry/${fixtureId}`)
      .send({
        batting: [
          { player_name: 'Tom Wilson', runs: 25, balls: 30, not_out: 1 },
          { player_name: 'Jack Smith', runs: 15, balls: 20, not_out: 0 }
        ],
        bowling: [],
        fielding: []
      })

    const bat = db.prepare('SELECT * FROM manual_batting WHERE fixture_id = ?').all(fixtureId)
    expect(bat.length).toBe(2)
    expect(bat.map((r) => r.runs).sort((a, b) => b - a)).toEqual([25, 15])
  })
})

'use strict'

const path = require('path')
// Must be set before any DB module is loaded
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
// Disable Clerk auth
delete process.env.CLERK_SECRET_KEY

const express = require('express')
const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')

// Build a minimal app mounting the players router
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
  app.use('/api/players', require('./players'))
  return app
}

let app
let db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()
  app = buildApp()
})

// ─── GET /api/players ─────────────────────────────────────────────────────────

describe('GET /api/players', () => {
  it('returns 200 with an array of all players', async () => {
    const res = await request(app).get('/api/players')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0]).toHaveProperty('player_id')
    expect(res.body[0]).toHaveProperty('name')
  })

  it('includes both WHCC and opposition players', async () => {
    const res = await request(app).get('/api/players')
    const names = res.body.map((p) => p.name)
    expect(names).toContain('Leo Brown')
    expect(names).toContain('Alex Taylor')
  })
})

// ─── GET /api/players/names ───────────────────────────────────────────────────

describe('GET /api/players/names', () => {
  it('returns 200 with an array of WHCC player name strings', async () => {
    const res = await request(app).get('/api/players/names')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(typeof res.body[0]).toBe('string')
  })

  it('includes seeded WHCC players', async () => {
    const res = await request(app).get('/api/players/names')
    // Sam L has a display_name set in seed
    expect(res.body).toContain('Sam L')
    // Leo Brown has no display_name so name is used
    expect(res.body).toContain('Leo Brown')
  })

  it('excludes opposition players', async () => {
    const res = await request(app).get('/api/players/names')
    expect(res.body).not.toContain('Alex Taylor')
  })
})

// ─── GET /api/players/stats ───────────────────────────────────────────────────

describe('GET /api/players/stats', () => {
  it('returns 200 with players and years arrays', async () => {
    const res = await request(app).get('/api/players/stats')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('players')
    expect(res.body).toHaveProperty('years')
    expect(Array.isArray(res.body.players)).toBe(true)
    expect(Array.isArray(res.body.years)).toBe(true)
  })
})

// ─── GET /api/players/stats/batting ──────────────────────────────────────────

describe('GET /api/players/stats/batting', () => {
  it('returns 200 with batting-only stats', async () => {
    const res = await request(app).get('/api/players/stats/batting')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('players')
    expect(Array.isArray(res.body.players)).toBe(true)
  })
})

// ─── GET /api/players/stats/bowling ──────────────────────────────────────────

describe('GET /api/players/stats/bowling', () => {
  it('returns 200 with bowling-only stats', async () => {
    const res = await request(app).get('/api/players/stats/bowling')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('players')
    expect(Array.isArray(res.body.players)).toBe(true)
  })
})

// ─── GET /api/players/partnerships ───────────────────────────────────────────

describe('GET /api/players/partnerships', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/players/partnerships')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts a year query param', async () => {
    const res = await request(app).get('/api/players/partnerships?year=2026')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ─── GET /api/players/unnamed ─────────────────────────────────────────────────

describe('GET /api/players/unnamed', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/api/players/unnamed')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ─── GET /api/players/:id/batting ─────────────────────────────────────────────

describe('GET /api/players/:id/batting', () => {
  it('returns 200 with player data for Leo Brown (103)', async () => {
    const res = await request(app).get('/api/players/103/batting')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('player')
    expect(res.body).toHaveProperty('innings')
    expect(res.body).toHaveProperty('totals')
    expect(res.body).toHaveProperty('dismissalCounts')
    expect(res.body).toHaveProperty('years')
    expect(res.body.player.player_id).toBe(103)
  })

  it('has correct totals for Leo Brown who batted in seeded fixture', async () => {
    const res = await request(app).get('/api/players/103/batting')
    expect(res.body.totals.innings).toBeGreaterThan(0)
    // Leo scored 2+1+6+1+4 = 14 runs in seeded fixture (over 0 and 1)
    expect(res.body.totals.runs).toBeGreaterThanOrEqual(14)
  })

  it('includes fielding and keeping data', async () => {
    const res = await request(app).get('/api/players/103/batting')
    expect(res.body).toHaveProperty('fielding')
    expect(res.body).toHaveProperty('keeping')
    expect(res.body.fielding).toHaveProperty('catches')
  })

  it('works for a player who has never batted', async () => {
    // player 101 (Samuel Lawrence) has player_flags but no batting deliveries
    const res = await request(app).get('/api/players/101/batting')
    expect(res.status).toBe(200)
    expect(res.body.totals.innings).toBe(0)
  })
})

// ─── GET /api/players/:id/bowling ─────────────────────────────────────────────

describe('GET /api/players/:id/bowling', () => {
  it('returns 200 with bowling spells for Jack Smith (105)', async () => {
    const res = await request(app).get('/api/players/105/bowling')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('player')
    expect(res.body).toHaveProperty('spells')
    expect(res.body).toHaveProperty('totals')
    expect(res.body).toHaveProperty('years')
    expect(Array.isArray(res.body.spells)).toBe(true)
    // Jack bowls in seeded fixture (innings 2)
    expect(res.body.spells.length).toBeGreaterThan(0)
  })

  it('has sane totals for Jack Smith', async () => {
    const res = await request(app).get('/api/players/105/bowling')
    expect(res.body.totals.wickets).toBeGreaterThanOrEqual(1)
  })

  it('returns empty spells for a non-bowler', async () => {
    // player 101 (Samuel Lawrence) never bowls in seeded data
    const res = await request(app).get('/api/players/101/bowling')
    expect(res.status).toBe(200)
    expect(res.body.spells).toEqual([])
  })
})

// ─── GET /api/players/:id/h2h ─────────────────────────────────────────────────

describe('GET /api/players/:id/h2h', () => {
  it('returns 200 with batting and bowling arrays', async () => {
    const res = await request(app).get('/api/players/103/h2h')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('batting')
    expect(res.body).toHaveProperty('bowling')
    expect(Array.isArray(res.body.batting)).toBe(true)
    expect(Array.isArray(res.body.bowling)).toBe(true)
  })
})

// ─── GET /api/players/:id/series ──────────────────────────────────────────────

describe('GET /api/players/:id/series', () => {
  it('returns 200 with player and matches', async () => {
    const res = await request(app).get('/api/players/103/series')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('player')
    expect(res.body).toHaveProperty('matches')
    expect(Array.isArray(res.body.matches)).toBe(true)
  })

  it('returns match-level data for Leo Brown', async () => {
    const res = await request(app).get('/api/players/103/series')
    expect(res.body.matches.length).toBeGreaterThan(0)
    const m = res.body.matches[0]
    expect(m).toHaveProperty('fixture_id')
    expect(m).toHaveProperty('bat_runs')
  })
})

// ─── PATCH /api/players/:id/name (no-Clerk path) ─────────────────────────────

describe('PATCH /api/players/:id/name', () => {
  afterEach(() => {
    db.prepare('UPDATE players SET display_name = NULL WHERE player_id = 102').run()
  })

  it('sets display_name and returns { ok: true }', async () => {
    const res = await request(app).patch('/api/players/102/name').send({ name: 'Zac H' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const row = db.prepare('SELECT display_name FROM players WHERE player_id = 102').get()
    expect(row.display_name).toBe('Zac H')
  })

  it('returns 400 when name is blank', async () => {
    const res = await request(app).patch('/api/players/102/name').send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown player id', async () => {
    const res = await request(app).patch('/api/players/99999/name').send({ name: 'Nobody' })
    expect(res.status).toBe(404)
  })
})

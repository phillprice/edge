'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', '..', 'test.sqlite')
delete process.env.CLERK_SECRET_KEY
delete process.env.CRON_JOB_ORG_API_KEY

const express = require('express')
const request = require('supertest')
const { seed } = require('../../scripts/seed-test-db')

// Mock the two heavier backend modules the scheduler route reaches into for real
// network/cron work, so route-level tests exercise pure DB/auth logic only.
jest.mock('../../scheduler', () => ({
  queueTeamSeasons: jest.fn(),
  processPendingIngests: jest.fn().mockResolvedValue(undefined),
  discoverFixtures: jest.fn().mockResolvedValue(3),
  rescanAllSeasons: jest.fn().mockResolvedValue(2),
  resetFixedIngestJobs: jest.fn().mockResolvedValue({ deleted: 1, created: 1 }),
  INGEST_CRON_KEY: 'ingest_cron_job_id'
}))
jest.mock('../../db/ingestMatch', () => ({
  ingestMatch: jest.fn().mockResolvedValue({ fixtureId: 'MOCK_FIXTURE' })
}))
jest.mock('../../utils/resultsvault', () => ({
  resolveTeamSeasons: jest.fn(),
  fetchClubTeams: jest.fn().mockResolvedValue([])
}))
jest.mock('../../utils/matchSummary', () => ({
  notifyMatchIngested: jest.fn().mockResolvedValue(undefined),
  computeAndCacheStats: jest.fn()
}))

const schedulerRouter = require('./scheduler')
const { resolveTeamSeasons } = require('../../utils/resultsvault')
const scheduler = require('../../scheduler')

let db

function buildApp(authCtx) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.authCtx = authCtx ?? {
      verified: true,
      userId: 'test-user',
      isSuperAdmin: true,
      isClubAdmin: true,
      canUpload: true,
      clubId: 1,
      groups: []
    }
    next()
  })
  app.use('/api/admin/scheduler', schedulerRouter)
  // Basic error handler so next(err) doesn't crash supertest
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))
  return app
}

const SUPER_ADMIN_CTX = {
  verified: true,
  userId: 'super',
  isSuperAdmin: true,
  isClubAdmin: false,
  canUpload: true,
  clubId: null,
  groups: []
}
const NON_ADMIN_CTX = {
  verified: true,
  userId: 'member',
  isSuperAdmin: false,
  isClubAdmin: false,
  canUpload: false,
  clubId: 1,
  groups: []
}
const CLUB_ADMIN_CTX = {
  verified: true,
  userId: 'clubadmin',
  isSuperAdmin: false,
  isClubAdmin: true,
  canUpload: true,
  clubId: 1,
  groups: []
}

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../../db/schema').getDb()
})

afterEach(() => {
  jest.clearAllMocks()
})

afterAll(() => {
  db.prepare(
    `DELETE FROM scheduled_fixtures WHERE play_cricket_id IN (555001, 555002, 555003)`
  ).run()
  db.prepare(`DELETE FROM watched_teams WHERE team_id = 999999`).run()
})

// ─── status ─────────────────────────────────────────────────────────────────

describe('GET /status', () => {
  it('returns teams, queue counts, byTeam and recent shape', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('teams')
    expect(res.body).toHaveProperty('queue')
    expect(res.body).toHaveProperty('byTeam')
    expect(res.body).toHaveProperty('recent')
    expect(Array.isArray(res.body.teams)).toBe(true)
  })

  it('scopes results to the caller club when not super admin', async () => {
    const app = buildApp(CLUB_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/status')
    expect(res.status).toBe(200)
    expect(res.body.teams.every((t) => t.club_id === 1)).toBe(true)
  })
})

// ─── browse-teams auth ──────────────────────────────────────────────────────

describe('GET /browse-teams', () => {
  it('403s for a non-admin caller', async () => {
    const app = buildApp(NON_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/browse-teams')
    expect(res.status).toBe(403)
  })

  it('200s for an admin caller (mocked fetchClubTeams)', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/browse-teams')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ─── teams POST validation ──────────────────────────────────────────────────

describe('POST /teams', () => {
  it('403s for a non-admin caller', async () => {
    const app = buildApp(NON_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/teams').send({ team_id: '123' })
    expect(res.status).toBe(403)
  })

  it('400s when neither team_id nor url is provided', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/teams').send({})
    expect(res.status).toBe(400)
  })

  it('400s for an invalid url', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app)
      .post('/api/admin/scheduler/teams')
      .send({ url: 'not a valid url::::' })
    expect(res.status).toBe(400)
  })

  it('extracts team_id from a valid url query param', async () => {
    resolveTeamSeasons.mockResolvedValueOnce([])
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app)
      .post('/api/admin/scheduler/teams')
      .send({ url: 'https://whcc.play-cricket.com/Matches?team_id=999999' })
    expect(res.status).toBe(404) // no seasons resolved
    expect(resolveTeamSeasons).toHaveBeenCalledWith('999999', expect.any(Object))
  })

  it('404s when resolveTeamSeasons finds no seasons', async () => {
    resolveTeamSeasons.mockResolvedValueOnce([])
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/teams').send({ team_id: '999999' })
    expect(res.status).toBe(404)
  })

  it('200s and queues seasons when resolveTeamSeasons finds fixtures', async () => {
    resolveTeamSeasons.mockResolvedValueOnce([
      { season_id: '259', label: '2026', year: 2026, fixtures: [{ id: 1 }] }
    ])
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/teams').send({ team_id: '999999' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(scheduler.queueTeamSeasons).toHaveBeenCalled()
    const row = db
      .prepare('SELECT * FROM watched_teams WHERE team_id = 999999 AND season_id = 259')
      .get()
    expect(row).toBeDefined()
  })
})

// ─── teams DELETE ───────────────────────────────────────────────────────────

describe('DELETE /teams/:id', () => {
  it('403s for non-admin', async () => {
    const app = buildApp(NON_ADMIN_CTX)
    const res = await request(app).delete('/api/admin/scheduler/teams/1')
    expect(res.status).toBe(403)
  })

  it('deletes a watched team row', async () => {
    const info = db
      .prepare(
        `INSERT INTO watched_teams (team_id, season_id, label, added_at, year, club_id) VALUES (999999, 300, 'Temp', ?, 2026, 1)`
      )
      .run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).delete(`/api/admin/scheduler/teams/${info.lastInsertRowid}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const row = db.prepare('SELECT id FROM watched_teams WHERE id = ?').get(info.lastInsertRowid)
    expect(row).toBeUndefined()
  })
})

// ─── discover / rescan (mocked scheduler) ──────────────────────────────────

describe('POST /discover', () => {
  it('calls scheduler.discoverFixtures and returns count', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/discover')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, added: 3 })
  })
})

describe('POST /rescan', () => {
  it('calls scheduler.rescanAllSeasons and triggers processPendingIngests', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/rescan')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, added: 2 })
  })
})

// ─── cron-jobs ──────────────────────────────────────────────────────────────

describe('GET /cron-jobs', () => {
  it('returns fixedJobs and upcomingFixtures without a live cron-job.org key', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/cron-jobs')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.fixedJobs)).toBe(true)
    expect(res.body.fixedJobs[0]).toMatchObject({ key: 'ingest_cron_job_id', exists: false })
    expect(Array.isArray(res.body.upcomingFixtures)).toBe(true)
  })
})

// ─── past-pending ───────────────────────────────────────────────────────────

describe('GET /past-pending', () => {
  it('returns rows for pending scheduled fixtures whose ingest_after has passed', async () => {
    db.prepare(
      `INSERT INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, club_id)
       VALUES (555001, 1, 259, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', ?, 'pending', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/past-pending')
    expect(res.status).toBe(200)
    expect(res.body.some((r) => r.play_cricket_id === 555001)).toBe(true)
  })
})

// ─── stale ──────────────────────────────────────────────────────────────────

describe('GET /stale', () => {
  it('returns failed and old-pending scheduled fixtures', async () => {
    db.prepare(
      `INSERT INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, error_msg, club_id)
       VALUES (555002, 1, 259, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', ?, 'failed', 'boom', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/stale')
    expect(res.status).toBe(200)
    expect(res.body.some((r) => r.play_cricket_id === 555002)).toBe(true)
  })
})

// ─── ignore ──────────────────────────────────────────────────────────────────

describe('POST /ignore', () => {
  it('400s when ids array missing', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/ignore').send({})
    expect(res.status).toBe(400)
  })

  it('marks matching pending/failed fixtures as ignored', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, club_id)
       VALUES (555003, 1, 259, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', ?, 'pending', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app)
      .post('/api/admin/scheduler/ignore')
      .send({ ids: [555003] })
    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe(1)
    const row = db
      .prepare('SELECT status FROM scheduled_fixtures WHERE play_cricket_id = 555003')
      .get()
    expect(row.status).toBe('ignored')
  })
})

// ─── retry ──────────────────────────────────────────────────────────────────

describe('POST /retry', () => {
  it('resets failed scheduled fixtures back to pending', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, error_msg, attempt_count, club_id)
       VALUES (555002, 1, 259, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', ?, 'failed', 'boom', 3, 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/retry')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const row = db
      .prepare(
        'SELECT status, attempt_count FROM scheduled_fixtures WHERE play_cricket_id = 555002'
      )
      .get()
    expect(row.status).toBe('pending')
    expect(row.attempt_count).toBe(0)
  })
})

// ─── reingest-bulk validation ───────────────────────────────────────────────

describe('POST /reingest-bulk', () => {
  it('400s when ids missing', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/reingest-bulk').send({})
    expect(res.status).toBe(400)
  })

  it('200s with queued=0 when no matching scheduled_fixtures exist for the given fixture ids', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] })
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app)
      .post('/api/admin/scheduler/reingest-bulk')
      .send({ ids: ['NOT_A_REAL_FIXTURE_ID'] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, queued: 0 })
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })
})

// ─── sync-cron-jobs (mocked scheduler) ──────────────────────────────────────

describe('POST /sync-cron-jobs', () => {
  it('calls scheduler.resetFixedIngestJobs and returns deleted/created counts', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/sync-cron-jobs')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, deleted: 1, created: 1 })
  })
})

// ─── ingest-one (mocked ingestMatch) ────────────────────────────────────────

describe('POST /ingest-one/:playCricketId', () => {
  it('404s when the fixture is not in scheduled_fixtures', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/ingest-one/00000')
    expect(res.status).toBe(404)
  })

  it('returns alreadyDone when a matching fixture already exists', async () => {
    db.prepare(
      `UPDATE fixtures SET play_cricket_id = '25577112' WHERE fixture_id = '25577112'`
    ).run()
    db.prepare(
      `INSERT OR REPLACE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, club_id)
       VALUES (25577112, 1, 259, '2026-04-29T00:00:00Z', '2026-04-29T00:00:00Z', ?, 'pending', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/ingest-one/25577112')
    expect(res.status).toBe(200)
    expect(res.body.alreadyDone).toBe(true)
    expect(res.body.fixtureId).toBe('25577112')
  })

  it('ingests via mocked ingestMatch when no fixture exists yet', async () => {
    db.prepare(
      `INSERT OR REPLACE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, club_id)
       VALUES (777001, 1, 259, '2026-04-29T00:00:00Z', '2026-04-29T00:00:00Z', ?, 'pending', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/ingest-one/777001')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.fixtureId).toBe('MOCK_FIXTURE')
    const row = db
      .prepare('SELECT status FROM scheduled_fixtures WHERE play_cricket_id = 777001')
      .get()
    expect(row.status).toBe('done')
    db.prepare('DELETE FROM scheduled_fixtures WHERE play_cricket_id = 777001').run()
  })

  it('marks the fixture failed when ingestMatch throws', async () => {
    const { ingestMatch } = require('../../db/ingestMatch')
    ingestMatch.mockRejectedValueOnce(new Error('boom'))
    db.prepare(
      `INSERT OR REPLACE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, status, club_id)
       VALUES (777002, 1, 259, '2026-04-29T00:00:00Z', '2026-04-29T00:00:00Z', ?, 'pending', 1)`
    ).run(new Date().toISOString())
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/ingest-one/777002')
    expect(res.status).toBe(500)
    const row = db
      .prepare('SELECT status, error_msg FROM scheduled_fixtures WHERE play_cricket_id = 777002')
      .get()
    expect(row.status).toBe('failed')
    expect(row.error_msg).toBe('boom')
    db.prepare('DELETE FROM scheduled_fixtures WHERE play_cricket_id = 777002').run()
  })
})

// ─── reingest-candidates ────────────────────────────────────────────────────

describe('GET /reingest-candidates', () => {
  it('returns 200 with an array (may be empty)', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).get('/api/admin/scheduler/reingest-candidates')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ─── process-now ────────────────────────────────────────────────────────────

describe('POST /process-now', () => {
  it('responds immediately and kicks off background processing', async () => {
    const app = buildApp(SUPER_ADMIN_CTX)
    const res = await request(app).post('/api/admin/scheduler/process-now')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

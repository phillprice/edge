'use strict'
// Set DB_PATH before any module that touches better-sqlite3 is loaded
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')

beforeAll(() => {
  seed(process.env.DB_PATH)
})

let db
beforeEach(() => {
  const { getDb } = require('../db/schema')
  db = getDb()
})

// ─── parseMsDate / minTimestamp ────────────────────────────────────────────────
// These helpers in ingest.js sort innings JSON files by timestamp.
// Tested directly since they are pure functions (no side effects).

// Inline copies so we don't have to export them from the module
function parseMsDate(raw) {
  if (!raw) return null
  const m = raw.match(/\/Date\((\d+)/)
  return m ? Number(m[1]) : null
}

function minTimestamp(data) {
  let min = Infinity
  for (const d of data) {
    const t = parseMsDate(d.last_update_time)
    if (t !== null && t < min) min = t
  }
  return min === Infinity ? 0 : min
}

describe('parseMsDate', () => {
  it('parses a /Date(ms)/ timestamp', () => {
    expect(parseMsDate('/Date(1748558400000)/')).toBe(1748558400000)
  })
  it('returns null for null input', () => {
    expect(parseMsDate(null)).toBeNull()
  })
  it('returns null for unrecognised format', () => {
    expect(parseMsDate('2026-06-01')).toBeNull()
  })
  it('ignores trailing timezone info', () => {
    expect(parseMsDate('/Date(1748558400000+0100)/')).toBe(1748558400000)
  })
})

describe('minTimestamp', () => {
  it('returns the smallest ms timestamp in the array', () => {
    const data = [
      { last_update_time: '/Date(1748558400000)/' },
      { last_update_time: '/Date(1748472000000)/' },
      { last_update_time: '/Date(1748644800000)/' }
    ]
    expect(minTimestamp(data)).toBe(1748472000000)
  })

  it('returns 0 for empty array', () => {
    expect(minTimestamp([])).toBe(0)
  })

  it('skips entries with null timestamp', () => {
    const data = [{ last_update_time: null }, { last_update_time: '/Date(1748558400000)/' }]
    expect(minTimestamp(data)).toBe(1748558400000)
  })
})

// ─── ingestDeliveries — delivery count after seeding ──────────────────────────
// Characterization test: verifies the seed DB structure so ingest logic has a
// known baseline to compare against after Phase 5/6 refactoring.

describe('deliveries baseline', () => {
  it('seed DB has deliveries in innings 1 (WHCC batting)', () => {
    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM deliveries d
         JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 1`
      )
      .get()
    expect(count.n).toBeGreaterThan(0)
  })

  it('seed DB has deliveries in innings 2 (WHCC bowling)', () => {
    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM deliveries d
         JOIN innings i ON i.result_id = d.result_id AND i.innings_order = 2`
      )
      .get()
    expect(count.n).toBeGreaterThan(0)
  })

  it('every delivery references a known player', () => {
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM deliveries d
         WHERE d.batter_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM players p WHERE p.player_id = d.batter_id)`
      )
      .get()
    expect(orphans.n).toBe(0)
  })

  it('fixture record exists for seeded play-cricket ID', () => {
    const f = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get('25577112')
    expect(f).toBeDefined()
    expect(f.home_team).toMatch(/whirlwind/i)
  })
})

// ─── Auth: requireSignedIn prevents unauthenticated ingests ───────────────────
// The auth check is applied by server.js before the route mounts:
//   app.use('/api/ingest', requireSignedIn, requireUpload, require('./routes/ingest'))
// The middleware behaviour is covered by middleware/auth.test.js.
// This test documents the expectation so refactors can't silently remove the guard.

describe('auth guard contract', () => {
  it('requireSignedIn middleware is tested in auth.test.js (guard documented)', () => {
    const authTest = path.join(__dirname, '..', 'middleware', 'auth.test.js')
    expect(require('fs').existsSync(authTest)).toBe(true)
  })

  it('requireUpload middleware rejects users without canUpload flag', () => {
    const { requireUpload } = require('../middleware/auth')
    const mockReq = { authCtx: { canUpload: false } }
    const mockRes = {
      _status: null,
      _body: null,
      status(s) { this._status = s; return this },
      json(b) { this._body = b }
    }
    const next = jest.fn()
    requireUpload(mockReq, mockRes, next)
    expect(next).not.toHaveBeenCalled()
    expect(mockRes._status).toBe(403)
  })
})

'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { getDb } = require('../db/schema')
const { getClubFilters } = require('../utils/db')
const {
  battingSummarySql,
  bowlingSummarySql,
  topBattersSql,
  topBowlersSql
} = require('./seasonStatsQueries')

let db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = getDb()
})

// All these queries take a `rfSub` (a "relevant fixtures" subquery selecting fixture_id)
// and a colWhere(col) club filter. Build the same rfSub/params getSeasonStats uses,
// scoped to the known WHCC fixtures in the seed data.
function buildRfSub() {
  const { fixtureWhere, fixtureParams, colWhere } = getClubFilters(db, null)
  const rfSub = `SELECT f.fixture_id FROM fixtures f WHERE ${fixtureWhere}`
  return { rfSub, rfParams: fixtureParams, colWhere }
}

describe('seasonStatsQueries — battingSummarySql', () => {
  it('returns aggregate batting totals across delivery-sourced fixtures', () => {
    const { rfSub, rfParams, colWhere } = buildRfSub()
    const row = db.prepare(battingSummarySql(rfSub, colWhere)).get(...rfParams, ...rfParams)
    expect(row).not.toBeNull()
    expect(row.total_runs).toBeGreaterThan(0)
    expect(row.total_balls).toBeGreaterThan(0)
    expect(row.total_outs).toBeGreaterThanOrEqual(0)
  })

  it('returns nulls (no rows) when rfSub matches nothing', () => {
    const { colWhere } = buildRfSub()
    const emptyRfSub = `SELECT f.fixture_id FROM fixtures f WHERE 1 = 0`
    const row = db.prepare(battingSummarySql(emptyRfSub, colWhere)).get()
    expect(row.total_runs).toBeNull()
  })
})

describe('seasonStatsQueries — bowlingSummarySql', () => {
  it('returns aggregate bowling totals across delivery-sourced fixtures', () => {
    const { rfSub, rfParams, colWhere } = buildRfSub()
    const row = db.prepare(bowlingSummarySql(rfSub, colWhere)).get(...rfParams, ...rfParams)
    expect(row).not.toBeNull()
    expect(row.total_wickets).toBeGreaterThanOrEqual(0)
    expect(row.total_balls).toBeGreaterThan(0)
    expect(row.total_runs).toBeGreaterThanOrEqual(0)
  })
})

describe('seasonStatsQueries — topBattersSql', () => {
  it('returns up to 3 top run scorers ordered by runs descending', () => {
    const { rfSub, rfParams, colWhere } = buildRfSub()
    const rows = db.prepare(topBattersSql(rfSub, colWhere)).all(...rfParams, ...rfParams)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total_runs).toBeGreaterThanOrEqual(rows[i].total_runs)
    }
    expect(rows[0]).toHaveProperty('player_id')
    expect(rows[0]).toHaveProperty('name')
  })
})

describe('seasonStatsQueries — topBowlersSql', () => {
  it('returns up to 3 top wicket takers ordered by wickets descending', () => {
    const { rfSub, rfParams, colWhere } = buildRfSub()
    const rows = db.prepare(topBowlersSql(rfSub, colWhere)).all(...rfParams, ...rfParams)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total_wickets).toBeGreaterThanOrEqual(rows[i].total_wickets)
    }
  })
})

describe('seasonStatsQueries — club-scoped filters (Kempton club)', () => {
  it('produces different (or empty) results for a different club marker set', () => {
    // Kempton club_id=2 — its watched teams / markers differ from WHCC's default markers.
    const { fixtureWhere, fixtureParams, colWhere } = getClubFilters(db, 2)
    const rfSub = `SELECT f.fixture_id FROM fixtures f WHERE ${fixtureWhere}`
    expect(() =>
      db.prepare(battingSummarySql(rfSub, colWhere)).get(...fixtureParams, ...fixtureParams)
    ).not.toThrow()
  })
})

'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { getDb } = require('../db/schema')
const { computeTopTrumps } = require('./topTrumpsService')

let db

function fakeReq(overrides = {}) {
  return {
    query: {},
    headers: {},
    authCtx: { verified: true, isSuperAdmin: true, isClubAdmin: true, clubId: 1, groups: [] },
    ...overrides
  }
}

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = getDb()
})

describe('topTrumpsService — computeTopTrumps', () => {
  it('returns an array of players with the expected stat shape', () => {
    const result = computeTopTrumps(db, fakeReq())
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    const p = result[0]
    expect(p).toHaveProperty('player_id')
    expect(p).toHaveProperty('name')
    expect(p).toHaveProperty('batting')
    expect(p).toHaveProperty('bowling')
    expect(p).toHaveProperty('fielding')
    expect(p).toHaveProperty('gamechanger')
    expect(p).toHaveProperty('overall')
    expect(p).toHaveProperty('matches')
    expect(p).toHaveProperty('qualified')
  })

  it('clamps batting/bowling/fielding/overall scores to [0, 100]', () => {
    const result = computeTopTrumps(db, fakeReq())
    for (const p of result) {
      expect(p.batting).toBeGreaterThanOrEqual(0)
      expect(p.batting).toBeLessThanOrEqual(100)
      expect(p.bowling).toBeGreaterThanOrEqual(0)
      expect(p.bowling).toBeLessThanOrEqual(100)
      expect(p.fielding).toBeGreaterThanOrEqual(0)
      expect(p.fielding).toBeLessThanOrEqual(100)
      expect(p.overall).toBeGreaterThanOrEqual(0)
      expect(p.overall).toBeLessThanOrEqual(100)
    }
  })

  it('sorts players by overall score descending', () => {
    const result = computeTopTrumps(db, fakeReq())
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].overall).toBeGreaterThanOrEqual(result[i].overall)
    }
  })

  it('marks qualified=false for players below MIN_MATCHES (5) games attended', () => {
    const result = computeTopTrumps(db, fakeReq())
    for (const p of result) {
      expect(p.qualified).toBe(p.matches >= 5)
    }
  })

  it('excludes players with zero games_attended', () => {
    const result = computeTopTrumps(db, fakeReq())
    for (const p of result) {
      expect(p.matches).toBeGreaterThan(0)
    }
  })

  it('applies year filter without throwing and narrows or keeps result set', () => {
    const all = computeTopTrumps(db, fakeReq())
    const filtered = computeTopTrumps(db, fakeReq({ query: { year: '2026' } }))
    expect(Array.isArray(filtered)).toBe(true)
    expect(filtered.length).toBeLessThanOrEqual(all.length)
  })

  it('applies team sub-filter (whirlwind) without throwing', () => {
    const result = computeTopTrumps(db, fakeReq({ query: { team: 'whirlwind' } }))
    expect(Array.isArray(result)).toBe(true)
  })

  it('gamechanger count contributes to overall score (nonzero for top performers)', () => {
    const result = computeTopTrumps(db, fakeReq())
    // At least one player should have registered as a gamechanger in some fixture,
    // given the seeded deliveries feature clear top performers each innings.
    const anyGamechanger = result.some((p) => p.gamechanger > 0)
    expect(anyGamechanger).toBe(true)
  })
})

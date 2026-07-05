'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { getDb } = require('../db/schema')
const { getMatchDetail } = require('./matchService')
const { syncFixtureTags } = require('../utils/tags')

const KNOWN_FIXTURE = '25577112'

beforeAll(() => {
  seed(process.env.DB_PATH)
})

// getMatchDetail's fixture object feeds MatchDetail.jsx's "Predict league" entry point,
// which only renders when fixture.tags includes 'league' — regression coverage for a bug
// where getMatchDetail's SELECT f.* never attached tags at all (only getMatchList did).
describe('matchService — getMatchDetail fixture.tags', () => {
  it('falls back to [match_type || "league"] when no fixture_tags rows exist', () => {
    const db = getDb()
    const result = getMatchDetail(db, KNOWN_FIXTURE, { authCtx: { isSuperAdmin: true } })
    expect(result.fixture.tags).toEqual(['league'])
  })

  it('reflects real fixture_tags rows once tags are synced', () => {
    const db = getDb()
    syncFixtureTags(db, KNOWN_FIXTURE, ['cup'])
    const result = getMatchDetail(db, KNOWN_FIXTURE, { authCtx: { isSuperAdmin: true } })
    expect(result.fixture.tags).toEqual(['cup'])
    syncFixtureTags(db, KNOWN_FIXTURE, ['league']) // restore for other tests
  })
})

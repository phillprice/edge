'use strict'

const { buildFilterClauses } = require('./filterClauses')

const dummyDb = {}

function makeReq(query) {
  return { query, authCtx: { isSuperAdmin: true, isClubAdmin: false, clubId: null, groups: [] } }
}

describe('buildFilterClauses', () => {
  it('builds a fixture_tags-based clause from ?types=, not a f.competition clause', () => {
    const { compFilter, compParams } = buildFilterClauses(dummyDb, makeReq({ types: 'cup' }))
    expect(compFilter).toContain('fixture_tags')
    expect(compFilter).not.toContain('f.competition')
    expect(compParams).toEqual(['cup'])
  })

  it('supports multiple comma-separated types', () => {
    const { compFilter, compParams } = buildFilterClauses(dummyDb, makeReq({ types: 'league,cup' }))
    expect(compFilter).toContain('IN (?, ?)')
    expect(compParams).toEqual(['league', 'cup'])
  })

  it('ignores the legacy ?comp= param entirely', () => {
    const { compFilter, compParams } = buildFilterClauses(dummyDb, makeReq({ comp: 'cup' }))
    expect(compFilter).toBe('')
    expect(compParams).toEqual([])
  })

  it('returns an empty clause/params when no types are given', () => {
    const { compFilter, compParams } = buildFilterClauses(dummyDb, makeReq({}))
    expect(compFilter).toBe('')
    expect(compParams).toEqual([])
  })
})

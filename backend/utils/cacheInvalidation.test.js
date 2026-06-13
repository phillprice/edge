'use strict'

const { invalidateFixtureCaches } = require('./cacheInvalidation')

describe('invalidateFixtureCaches', () => {
  function makeDb() {
    const deleted = {}
    return {
      prepare: (sql) => ({
        run: (id) => {
          deleted[sql] = id
        }
      }),
      _deleted: deleted
    }
  }

  it('deletes from all three cache tables', () => {
    const db = makeDb()
    invalidateFixtureCaches(db, 'FIX-001')
    const keys = Object.keys(db._deleted)
    expect(keys.some((k) => k.includes('match_stats_cache'))).toBe(true)
    expect(keys.some((k) => k.includes('match_detail_cache'))).toBe(true)
    expect(keys.some((k) => k.includes('mvp_cache'))).toBe(true)
  })

  it('passes the fixtureId to each delete', () => {
    const db = makeDb()
    invalidateFixtureCaches(db, 'FIX-002')
    Object.values(db._deleted).forEach((id) => {
      expect(id).toBe('FIX-002')
    })
  })
})

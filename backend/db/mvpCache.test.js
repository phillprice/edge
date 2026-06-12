'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')

// Regression: mvp_cache.fixture_id must be TEXT. Manual fixture ids ('manual-…') are not
// integers and threw "SqliteError: datatype mismatch" against the old INTEGER PRIMARY KEY,
//500-ing the match-detail endpoint for every manual match.
describe('mvp_cache fixture_id is TEXT', () => {
  let db
  beforeAll(() => {
    seed(process.env.DB_PATH)
    db = require('../db/schema').getDb()
  })

  it('accepts a manual (text) fixture_id without datatype mismatch', () => {
    const ins = () =>
      db
        .prepare(
          'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
        )
        .run('manual-1779054809040', '[]', 'null', Date.now())
    expect(ins).not.toThrow()
    const row = db
      .prepare('SELECT fixture_id FROM mvp_cache WHERE fixture_id = ?')
      .get('manual-1779054809040')
    expect(row.fixture_id).toBe('manual-1779054809040')
    db.prepare('DELETE FROM mvp_cache WHERE fixture_id = ?').run('manual-1779054809040')
  })

  it('column type is TEXT', () => {
    const col = db
      .prepare('PRAGMA table_info(mvp_cache)')
      .all()
      .find((c) => c.name === 'fixture_id')
    expect(col.type.toUpperCase()).toBe('TEXT')
  })
})

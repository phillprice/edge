'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test-mvpcache.sqlite')
delete process.env.TURSO_DATABASE_URL

const { seed } = require('../scripts/seed-test-db')

describe('mvp_cache fixture_id is TEXT', () => {
  let db
  beforeAll(async () => { seed(process.env.DB_PATH); db = require('../db/schema').getDbAsync() })

  it('accepts a manual (text) fixture_id without datatype mismatch', async () => {
    await db.prepare(
      'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
    ).run('manual-1779054809040', '[]', 'null', Date.now())
    const row = await db.prepare('SELECT fixture_id FROM mvp_cache WHERE fixture_id = ?').get('manual-1779054809040')
    expect(row.fixture_id).toBe('manual-1779054809040')
    await db.prepare('DELETE FROM mvp_cache WHERE fixture_id = ?').run('manual-1779054809040')
  })

  it('column type is TEXT', async () => {
    const cols = await db.prepare('PRAGMA table_info(mvp_cache)').all()
    const col = cols.find(c => c.name === 'fixture_id')
    expect(col.type.toUpperCase()).toBe('TEXT')
  })
})

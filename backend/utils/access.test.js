'use strict'
const { buildAccessFilter, getJwtMeta } = require('./access')

// Build a fake Clerk-style JWT: header.payload.signature where payload is base64 JSON.
function mkReq(metadata) {
  const payload = Buffer.from(JSON.stringify({ metadata })).toString('base64')
  return { headers: { authorization: `Bearer x.${payload}.y` } }
}

describe('access — getJwtMeta / buildAccessFilter', () => {
  const ORIGINAL = process.env.CLERK_SECRET_KEY

  describe('with CLERK_SECRET_KEY unset (dev mode)', () => {
    beforeAll(() => { delete process.env.CLERK_SECRET_KEY })
    afterAll(() => { if (ORIGINAL) process.env.CLERK_SECRET_KEY = ORIGINAL })

    it('treats everyone as super admin', () => {
      expect(getJwtMeta({ headers: {} })).toEqual({ isSuperAdmin: true, groups: [] })
    })
    it('applies no filter', () => {
      expect(buildAccessFilter({ headers: {} })).toBeNull()
    })
  })

  describe('with CLERK_SECRET_KEY set', () => {
    beforeAll(() => { process.env.CLERK_SECRET_KEY = 'sk_test_dummy' })
    afterAll(() => { if (ORIGINAL) process.env.CLERK_SECRET_KEY = ORIGINAL; else delete process.env.CLERK_SECRET_KEY })

    it('super admin gets no filter (sees everything)', () => {
      expect(buildAccessFilter(mkReq({ isSuperAdmin: true }))).toBeNull()
    })

    it('authenticated user with no groups sees nothing (1 = 0)', () => {
      const f = buildAccessFilter(mkReq({ accessGroups: [] }))
      expect(f).toEqual({ sql: '1 = 0', params: [] })
    })

    it('missing metadata entirely → sees nothing', () => {
      const f = buildAccessFilter(mkReq(undefined))
      expect(f).toEqual({ sql: '1 = 0', params: [] })
    })

    it('single group produces one team/season clause with numeric params', () => {
      const f = buildAccessFilter(mkReq({ accessGroups: [{ team_id: 35533, season_id: 259 }] }))
      expect(f.params).toEqual([35533, 259])
      expect(f.sql).toContain('scheduled_fixtures')
      expect(f.sql).toContain('(sf.team_id = ? AND sf.season_id = ?)')
      // Exactly one clause → no OR
      expect(f.sql.match(/sf\.team_id = \?/g)).toHaveLength(1)
    })

    it('multiple groups are OR-ed and params flattened in order', () => {
      const f = buildAccessFilter(mkReq({ accessGroups: [
        { team_id: 1, season_id: 10 },
        { team_id: 2, season_id: 20 },
      ] }))
      expect(f.params).toEqual([1, 10, 2, 20])
      expect(f.sql.match(/sf\.team_id = \?/g)).toHaveLength(2)
      expect(f.sql).toContain(' OR ')
    })

    it('coerces string ids to numbers', () => {
      const f = buildAccessFilter(mkReq({ accessGroups: [{ team_id: '7', season_id: '70' }] }))
      expect(f.params).toEqual([7, 70])
    })

    it('malformed token → not super admin, sees nothing', () => {
      const f = buildAccessFilter({ headers: { authorization: 'Bearer garbage' } })
      expect(f).toEqual({ sql: '1 = 0', params: [] })
    })

    it('isSuperAdmin only true for strict boolean true', () => {
      expect(getJwtMeta(mkReq({ isSuperAdmin: 'true' })).isSuperAdmin).toBe(false)
      expect(getJwtMeta(mkReq({ isSuperAdmin: 1 })).isSuperAdmin).toBe(false)
      expect(getJwtMeta(mkReq({ isSuperAdmin: true })).isSuperAdmin).toBe(true)
    })
  })
})

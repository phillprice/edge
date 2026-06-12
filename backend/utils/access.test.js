'use strict'
const { buildAccessFilter, getJwtMeta } = require('./access')
const { claimsToCtx, anonCtx, devCtx } = require('../middleware/auth')

// req.authCtx is attached by the attachAuthContext middleware in production. In unit tests
// we set it directly to the verified context the middleware would have produced.
function mkReq(ctx) {
  return { authCtx: ctx }
}

describe('access — buildAccessFilter (reads verified req.authCtx)', () => {
  it('dev context (no Clerk) → no filter', () => {
    expect(buildAccessFilter(mkReq(devCtx()))).toBeNull()
  })

  it('super admin → no filter (sees everything)', () => {
    expect(buildAccessFilter(mkReq(claimsToCtx({ metadata: { isSuperAdmin: true } })))).toBeNull()
  })

  it('signed-in user with no groups → sees nothing (1 = 0)', () => {
    expect(buildAccessFilter(mkReq(claimsToCtx({ metadata: { accessGroups: [] } })))).toEqual({
      sql: '1 = 0',
      params: [],
    })
  })

  it('anonymous (unverified) context → sees nothing', () => {
    expect(buildAccessFilter(mkReq(anonCtx()))).toEqual({ sql: '1 = 0', params: [] })
  })

  it('missing authCtx entirely → treated as anonymous → sees nothing', () => {
    expect(buildAccessFilter({ headers: {} })).toEqual({ sql: '1 = 0', params: [] })
  })

  it('single group → one team/season clause, numeric params', () => {
    const f = buildAccessFilter(
      mkReq(claimsToCtx({ metadata: { accessGroups: [{ team_id: 35533, season_id: 259 }] } }))
    )
    expect(f.params).toEqual([35533, 259])
    expect(f.sql).toContain('fixture_seasons')
    expect(f.sql.match(/fs\.team_id = \?/g)).toHaveLength(1)
  })

  it('multiple groups → OR-ed clauses, params flattened in order', () => {
    const f = buildAccessFilter(
      mkReq(
        claimsToCtx({
          metadata: {
            accessGroups: [
              { team_id: 1, season_id: 10 },
              { team_id: 2, season_id: 20 },
            ],
          },
        })
      )
    )
    expect(f.params).toEqual([1, 10, 2, 20])
    expect(f.sql.match(/fs\.team_id = \?/g)).toHaveLength(2)
    expect(f.sql).toContain(' OR ')
  })

  it('string ids are coerced to numbers', () => {
    const f = buildAccessFilter(
      mkReq(claimsToCtx({ metadata: { accessGroups: [{ team_id: '7', season_id: '70' }] } }))
    )
    expect(f.params).toEqual([7, 70])
  })

  it('getJwtMeta surfaces verified isSuperAdmin / groups', () => {
    const m = getJwtMeta(
      mkReq(
        claimsToCtx({
          metadata: { isSuperAdmin: true, accessGroups: [{ team_id: 9, season_id: 1 }] },
        })
      )
    )
    expect(m.isSuperAdmin).toBe(true)
    expect(m.groups).toEqual([{ team_id: 9, season_id: 1 }])
  })
})

describe('auth — claimsToCtx strictness', () => {
  it('only strict boolean true grants privileges', () => {
    expect(claimsToCtx({ metadata: { isSuperAdmin: 'true' } }).isSuperAdmin).toBe(false)
    expect(claimsToCtx({ metadata: { isSuperAdmin: 1 } }).isSuperAdmin).toBe(false)
    expect(claimsToCtx({ metadata: { isSuperAdmin: true } }).isSuperAdmin).toBe(true)
    expect(claimsToCtx({ metadata: { canUpload: true } }).canUpload).toBe(true)
  })
  it('non-array accessGroups → empty', () => {
    expect(claimsToCtx({ metadata: { accessGroups: 'x' } }).groups).toEqual([])
    expect(claimsToCtx({}).groups).toEqual([])
  })
  it('userId comes from sub claim', () => {
    expect(claimsToCtx({ sub: 'user_123', metadata: {} }).userId).toBe('user_123')
  })
  it('anonCtx and devCtx have expected privilege shape', () => {
    expect(anonCtx()).toMatchObject({ isSuperAdmin: false, canUpload: false, verified: false })
    expect(devCtx()).toMatchObject({ isSuperAdmin: true, canUpload: true, verified: true })
  })
})

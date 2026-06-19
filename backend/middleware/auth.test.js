'use strict'
const {
  attachAuthContext,
  getAuthContext,
  requireSignedIn,
  requireUpload,
  requireSuperAdmin,
  claimsToCtx,
  anonCtx,
  devCtx
} = require('./auth')

function runMw(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) {
        this.statusCode = c
        return this
      },
      json(b) {
        this.body = b
        resolve({ res: this, nexted: false })
      }
    }
    mw(req, res, () => resolve({ res, nexted: true }))
  })
}

describe('auth middleware', () => {
  const ORIGINAL = process.env.CLERK_SECRET_KEY
  afterAll(() => {
    if (ORIGINAL) process.env.CLERK_SECRET_KEY = ORIGINAL
    else delete process.env.CLERK_SECRET_KEY
  })

  describe('attachAuthContext — dev mode (no Clerk)', () => {
    beforeAll(() => {
      delete process.env.CLERK_SECRET_KEY
    })
    it('attaches a full-access verified context with clubId=1', async () => {
      const req = { headers: {} }
      await runMw(attachAuthContext, req)
      expect(req.authCtx).toMatchObject({ isSuperAdmin: true, canUpload: true, verified: true, clubId: 1 })
    })
  })

  describe('attachAuthContext — Clerk enabled', () => {
    beforeAll(() => {
      process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
    })
    it('no Authorization header → anonymous context, still calls next', async () => {
      const req = { headers: {} }
      const { nexted } = await runMw(attachAuthContext, req)
      expect(nexted).toBe(true)
      expect(req.authCtx).toMatchObject({ verified: false, isSuperAdmin: false })
    })
    it('invalid/forged token → anonymous context (verification fails closed)', async () => {
      const req = { headers: { authorization: 'Bearer not.a.realtoken' } }
      await runMw(attachAuthContext, req)
      expect(req.authCtx.verified).toBe(false)
      expect(req.authCtx.isSuperAdmin).toBe(false)
    })
  })

  describe('getAuthContext', () => {
    it('falls back to anonymous when nothing attached', () => {
      expect(getAuthContext({})).toEqual(anonCtx())
    })
  })

  describe('claimsToCtx', () => {
    it('extracts clubId from metadata', () => {
      const ctx = claimsToCtx({ sub: 'u1', metadata: { clubId: 2, isSuperAdmin: false, accessGroups: [] } })
      expect(ctx.clubId).toBe(2)
    })
    it('returns null clubId when not set', () => {
      const ctx = claimsToCtx({ sub: 'u1', metadata: {} })
      expect(ctx.clubId).toBeNull()
    })
  })

  describe('devCtx / anonCtx', () => {
    it('devCtx has clubId=1', () => {
      expect(devCtx().clubId).toBe(1)
    })
    it('anonCtx has clubId=null', () => {
      expect(anonCtx().clubId).toBeNull()
    })
  })

  describe('guards', () => {
    it('requireSignedIn blocks anonymous with 401', async () => {
      process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
      const { res, nexted } = await runMw(requireSignedIn, { authCtx: anonCtx() })
      expect(nexted).toBe(false)
      expect(res.statusCode).toBe(401)
    })
    it('requireSignedIn allows a verified signed-in user', async () => {
      const { nexted } = await runMw(requireSignedIn, { authCtx: { verified: true, userId: 'u1' } })
      expect(nexted).toBe(true)
    })
    it('requireUpload blocks without canUpload', async () => {
      const { res } = await runMw(requireUpload, { authCtx: { canUpload: false } })
      expect(res.statusCode).toBe(403)
    })
    it('requireUpload allows with canUpload', async () => {
      const { nexted } = await runMw(requireUpload, { authCtx: { canUpload: true } })
      expect(nexted).toBe(true)
    })
    it('requireSuperAdmin blocks non-admins', async () => {
      const { res } = await runMw(requireSuperAdmin, { authCtx: { isSuperAdmin: false } })
      expect(res.statusCode).toBe(403)
    })
  })
})

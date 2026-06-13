'use strict'

const { withEtag } = require('./cacheHeaders')

// Mock schema so withEtag can call getDb() without a real database file
jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ ts: 1748558400 }) })
  })
}))

function makeReqRes(ifNoneMatch) {
  const headers = {}
  const req = {
    headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}
  }
  const res = {
    _headers: {},
    _status: null,
    _ended: false,
    set(k, v) {
      this._headers[k] = v
    },
    status(s) {
      this._status = s
      return this
    },
    end() {
      this._ended = true
    }
  }
  return { req, res }
}

describe('withEtag', () => {
  it('sets Cache-Control, Vary, and ETag on a fresh request', () => {
    const { req, res } = makeReqRes()
    const next = jest.fn()

    withEtag('test-salt')(req, res, next)

    expect(res._headers['Cache-Control']).toMatch(/private/)
    expect(res._headers['Vary']).toBe('Authorization')
    expect(res._headers['ETag']).toMatch(/^W\/"test-salt-/)
    expect(next).toHaveBeenCalled()
    expect(res._ended).toBe(false)
  })

  it('returns 304 when If-None-Match matches the ETag', () => {
    const { req: freshReq, res: freshRes } = makeReqRes()
    const next1 = jest.fn()
    withEtag('test-salt')(freshReq, freshRes, next1)
    const etag = freshRes._headers['ETag']

    const { req, res } = makeReqRes(etag)
    const next = jest.fn()
    withEtag('test-salt')(req, res, next)

    expect(res._status).toBe(304)
    expect(res._ended).toBe(true)
    expect(next).not.toHaveBeenCalled()
  })

  it('does not return 304 when ETag differs', () => {
    const { req, res } = makeReqRes('W/"old-etag"')
    const next = jest.fn()

    withEtag('test-salt')(req, res, next)

    expect(res._status).toBeNull()
    expect(next).toHaveBeenCalled()
  })
})

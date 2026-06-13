'use strict'

const { validateBody, validateParams, z } = require('./validate')

function makeReqRes(body = {}, params = {}) {
  const req = { body, params }
  const res = {
    _status: null,
    _body: null,
    status(s) {
      this._status = s
      return this
    },
    json(b) {
      this._body = b
    }
  }
  return { req, res }
}

describe('validateBody', () => {
  const schema = z.object({ name: z.string().min(1) })

  it('calls next() when body is valid', () => {
    const { req, res } = makeReqRes({ name: 'Alice' })
    const next = jest.fn()
    validateBody(schema)(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(res._status).toBeNull()
  })

  it('returns 400 when body fails validation', () => {
    const { req, res } = makeReqRes({ name: '' })
    const next = jest.fn()
    validateBody(schema)(req, res, next)
    expect(res._status).toBe(400)
    expect(res._body.error).toBeTruthy()
    expect(next).not.toHaveBeenCalled()
  })

  it('replaces req.body with parsed/coerced data', () => {
    const numSchema = z.object({ count: z.number() })
    const { req, res } = makeReqRes({ count: 5 })
    const next = jest.fn()
    validateBody(numSchema)(req, res, next)
    expect(req.body.count).toBe(5)
  })
})

describe('validateParams', () => {
  const schema = z.object({ id: z.coerce.number().int().positive() })

  it('calls next() for a valid param', () => {
    const { req, res } = makeReqRes({}, { id: '42' })
    const next = jest.fn()
    validateParams(schema)(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.params.id).toBe(42)
  })

  it('returns 400 for an invalid param', () => {
    const { req, res } = makeReqRes({}, { id: 'abc' })
    const next = jest.fn()
    validateParams(schema)(req, res, next)
    expect(res._status).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
})

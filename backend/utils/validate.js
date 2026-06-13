'use strict'

const { z } = require('zod')

/**
 * Express middleware: validates req.body against a zod schema.
 * Returns 400 { error } on failure; calls next() on success.
 * @param {z.ZodTypeAny} schema
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues.map((i) => i.message).join('; ') })
    }
    req.body = result.data
    next()
  }
}

/**
 * Express middleware: validates req.params against a zod schema.
 * Returns 400 { error } on failure; calls next() on success.
 * @param {z.ZodTypeAny} schema
 */
function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params)
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues.map((i) => i.message).join('; ') })
    }
    req.params = result.data
    next()
  }
}

module.exports = { validateBody, validateParams, z }

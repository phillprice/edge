'use strict'

const express = require('express')
const router = express.Router()
const { marked } = require('marked')
const { getDb } = require('../db/schema')
const { getAuthContext } = require('../middleware/auth')

marked.setOptions({ gfm: true, breaks: true })

function requireAdmin(req, res, next) {
  try {
    const ctx = getAuthContext(req)
    if (!ctx.isClubAdmin && !ctx.isSuperAdmin) return res.status(403).json({ error: 'Forbidden' })
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorised' })
  }
}

// ── Public ──────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, version, title, body, published_at
         FROM changelog
         ORDER BY published_at DESC`
      )
      .all()
    const entries = rows.map((r) => ({ ...r, html: marked(r.body) }))
    res.json(entries)
  } catch (err) {
    console.error('[changelog:get]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Latest entry only — used by footer version badge
router.get('/latest', (req, res) => {
  try {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT id, version, published_at FROM changelog
         WHERE version IS NOT NULL
         ORDER BY published_at DESC LIMIT 1`
      )
      .get()
    res.json(row ?? null)
  } catch (err) {
    console.error('[changelog:latest]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Admin ───────────────────────────────────────────────────────────────────

router.post('/', requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const { version, title, body } = req.body
    if (!title || !body) return res.status(400).json({ error: 'title and body required' })
    const result = db
      .prepare(
        `INSERT INTO changelog (version, title, body)
         VALUES (?, ?, ?)`
      )
      .run(version || null, title.trim(), body.trim())
    const row = db
      .prepare(`SELECT id, version, title, body, published_at FROM changelog WHERE id = ?`)
      .get(result.lastInsertRowid)
    res.status(201).json({ ...row, html: marked(row.body) })
  } catch (err) {
    console.error('[changelog:post]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' })
    db.prepare(`DELETE FROM changelog WHERE id = ?`).run(id)
    res.json({ ok: true })
  } catch (err) {
    console.error('[changelog:delete]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

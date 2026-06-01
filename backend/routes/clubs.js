'use strict'
const express = require('express')
const router  = express.Router()
const { getDb } = require('../db/schema')
const { clerkClient } = require('@clerk/express')

function isSuperAdmin(req) {
  if (!process.env.CLERK_SECRET_KEY) return true
  try {
    const token  = (req.headers.authorization || '').replace('Bearer ', '')
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return claims?.metadata?.isSuperAdmin === true
  } catch { return false }
}

function getClubId(req) {
  if (!process.env.CLERK_SECRET_KEY) return null
  try {
    const token  = (req.headers.authorization || '').replace('Bearer ', '')
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return claims?.metadata?.club_id ?? null
  } catch { return null }
}

// GET /api/clubs/config — colour scheme for the current user's club (or null)
router.get('/config', (req, res) => {
  const clubId = getClubId(req)
  if (!clubId) return res.json(null)
  const db  = getDb()
  const row = db.prepare('SELECT id, name, slug, primary_color, secondary_color, show_opp_data FROM clubs WHERE id = ?').get(clubId)
  res.json(row ?? null)
})

// All endpoints below require super admin
function superAdminOnly(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' })
  next()
}

// GET /api/clubs — list all clubs with their team patterns
router.get('/', superAdminOnly, (req, res) => {
  const db = getDb()
  const clubs = db.prepare('SELECT * FROM clubs ORDER BY name').all()
  const patterns = db.prepare('SELECT * FROM club_teams ORDER BY club_id, pattern').all()
  const patternMap = {}
  for (const p of patterns) {
    if (!patternMap[p.club_id]) patternMap[p.club_id] = []
    patternMap[p.club_id].push({ id: p.id, pattern: p.pattern })
  }
  res.json(clubs.map(c => ({ ...c, patterns: patternMap[c.id] ?? [] })))
})

// POST /api/clubs — create a club
router.post('/', superAdminOnly, (req, res) => {
  const { name, slug, primary_color, secondary_color, show_opp_data, patterns } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' })
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' })

  const db = getDb()
  let id
  try {
    const r = db.prepare(
      'INSERT INTO clubs (name, slug, primary_color, secondary_color, show_opp_data) VALUES (?, ?, ?, ?, ?)'
    ).run(name, slug, primary_color || '#3b82f6', secondary_color || '#1e3a8a', show_opp_data ? 1 : 0)
    id = r.lastInsertRowid
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Slug already in use' })
    throw e
  }

  if (Array.isArray(patterns)) {
    const ins = db.prepare('INSERT OR IGNORE INTO club_teams (club_id, pattern) VALUES (?, ?)')
    for (const p of patterns) { if (p?.trim()) ins.run(id, p.trim().toLowerCase()) }
  }

  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(id)
  const pts  = db.prepare('SELECT * FROM club_teams WHERE club_id = ?').all(id)
  res.status(201).json({ ...club, patterns: pts })
})

// GET /api/clubs/:id — single club
router.get('/:id', superAdminOnly, (req, res) => {
  const db  = getDb()
  const row = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Club not found' })
  const patterns = db.prepare('SELECT id, pattern FROM club_teams WHERE club_id = ? ORDER BY pattern').all(row.id)
  res.json({ ...row, patterns })
})

// PATCH /api/clubs/:id — update club fields
router.patch('/:id', superAdminOnly, (req, res) => {
  const db  = getDb()
  const row = db.prepare('SELECT id FROM clubs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Club not found' })

  const allowed = ['name', 'slug', 'primary_color', 'secondary_color', 'show_opp_data']
  const sets = [], vals = []
  for (const k of allowed) {
    if (req.body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(req.body[k]) }
  }
  if (sets.length) db.prepare(`UPDATE clubs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, row.id)
  res.json({ ok: true })
})

// DELETE /api/clubs/:id — delete club (cascades to club_teams)
router.delete('/:id', superAdminOnly, (req, res) => {
  const db  = getDb()
  const row = db.prepare('SELECT id FROM clubs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Club not found' })
  db.prepare('DELETE FROM clubs WHERE id = ?').run(row.id)
  res.json({ ok: true })
})

// POST /api/clubs/:id/patterns — add team patterns
router.post('/:id/patterns', superAdminOnly, (req, res) => {
  const db  = getDb()
  const row = db.prepare('SELECT id FROM clubs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Club not found' })

  const patterns = Array.isArray(req.body.patterns) ? req.body.patterns : [req.body.pattern]
  const ins = db.prepare('INSERT OR IGNORE INTO club_teams (club_id, pattern) VALUES (?, ?)')
  for (const p of patterns) { if (p?.trim()) ins.run(row.id, p.trim().toLowerCase()) }

  const pts = db.prepare('SELECT id, pattern FROM club_teams WHERE club_id = ? ORDER BY pattern').all(row.id)
  res.json({ patterns: pts })
})

// DELETE /api/clubs/:id/patterns/:patternId — remove a pattern
router.delete('/:id/patterns/:patternId', superAdminOnly, (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM club_teams WHERE id = ? AND club_id = ?').run(req.params.patternId, req.params.id)
  res.json({ ok: true })
})

// ── User management (super admin) ────────────────────────────────────────────

// GET /api/clubs/users — list all Clerk users
router.get('/users/list', superAdminOnly, async (req, res) => {
  if (!process.env.CLERK_SECRET_KEY) return res.json([])
  try {
    const { data } = await clerkClient.users.getUserList({ limit: 200 })
    res.json(data.map(u => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress,
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.id,
      publicMetadata: u.publicMetadata,
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/clubs/users/:userId — update user publicMetadata
router.patch('/users/:userId', superAdminOnly, async (req, res) => {
  if (!process.env.CLERK_SECRET_KEY) return res.json({ ok: true })
  const { canUpload, isSuperAdmin: sa, club_id, accessGroups } = req.body
  const db = getDb()

  try {
    const user = await clerkClient.users.getUser(req.params.userId)
    const existing = user.publicMetadata ?? {}
    const updated  = { ...existing }

    if (canUpload !== undefined)    updated.canUpload    = canUpload === true
    if (sa !== undefined)           updated.isSuperAdmin = sa === true
    if (club_id !== undefined)      updated.club_id      = club_id === null ? undefined : club_id
    if (accessGroups !== undefined) updated.accessGroups = accessGroups

    // Clean up undefined keys
    for (const k of Object.keys(updated)) {
      if (updated[k] === undefined) delete updated[k]
    }

    await clerkClient.users.updateUser(req.params.userId, { publicMetadata: updated })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router

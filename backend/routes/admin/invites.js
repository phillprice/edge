'use strict'

const express = require('express')
const router = express.Router()
const { randomBytes } = require('crypto')
const { createClerkClient } = require('@clerk/express')
const { getDb } = require('../../db/schema')
const { getAuthContext } = require('../../middleware/auth')
const { validateBody, z } = require('../../utils/validate')

const INVITE_TTL_DAYS = 7

// POST /api/admin/invites — create an invite link for the caller's club
router.post(
  '/',
  validateBody(z.object({ expiryDays: z.number().int().min(1).max(30).optional() })),
  (req, res) => {
    const ctx = getAuthContext(req)
    if (!ctx.isSuperAdmin && !ctx.isClubAdmin) return res.status(403).json({ error: 'Forbidden' })
    if (ctx.clubId == null)
      return res.status(400).json({ error: 'No club assigned to your account' })

    const days = req.body.expiryDays ?? INVITE_TTL_DAYS
    const token = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + days * 86400_000).toISOString()

    getDb()
      .prepare(
        `INSERT INTO invites (token, club_id, created_by, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(token, ctx.clubId, ctx.userId, expiresAt)

    res.json({ token, expiresAt })
  }
)

// GET /api/admin/invites — list active invites for the caller's club
router.get('/', (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.isSuperAdmin && !ctx.isClubAdmin) return res.status(403).json({ error: 'Forbidden' })
  if (ctx.clubId == null) return res.status(400).json({ error: 'No club assigned' })

  const rows = getDb()
    .prepare(
      `SELECT token, created_at AS createdAt, expires_at AS expiresAt,
              used_at AS usedAt, used_by AS usedBy
       FROM invites WHERE club_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(ctx.clubId)

  res.json(rows)
})

// DELETE /api/admin/invites/:token — revoke an invite
router.delete('/:token', (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.isSuperAdmin && !ctx.isClubAdmin) return res.status(403).json({ error: 'Forbidden' })

  const r = getDb()
    .prepare(`DELETE FROM invites WHERE token = ? AND club_id = ? AND used_at IS NULL`)
    .run(req.params.token, ctx.clubId)

  if (r.changes === 0) return res.status(404).json({ error: 'Invite not found or already used' })
  res.json({ ok: true })
})

// GET /api/invites/:token — public: validate token, return club name (no auth)
router.get('/validate/:token', (req, res) => {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT i.token, i.expires_at AS expiresAt, i.used_at AS usedAt,
              c.club_id AS clubId, c.app_name AS appName, c.name AS clubName,
              c.primary_colour AS primaryColour, c.secondary_colour AS secondaryColour
       FROM invites i JOIN clubs c ON c.club_id = i.club_id
       WHERE i.token = ?`
    )
    .get(req.params.token)

  if (!row) return res.status(404).json({ error: 'Invalid invite' })
  if (row.usedAt) return res.status(410).json({ error: 'Invite already used' })
  if (new Date(row.expiresAt) < new Date()) return res.status(410).json({ error: 'Invite expired' })

  res.json({
    clubId: row.clubId,
    appName: row.appName,
    clubName: row.clubName,
    primaryColour: row.primaryColour,
    secondaryColour: row.secondaryColour
  })
})

// POST /api/invites/:token/redeem — signed-in user claims the invite
router.post('/redeem/:token', async (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.userId) return res.status(401).json({ error: 'Sign in first' })

  const db = getDb()
  const row = db
    .prepare(
      `SELECT club_id AS clubId, expires_at AS expiresAt, used_at AS usedAt
       FROM invites WHERE token = ?`
    )
    .get(req.params.token)

  if (!row) return res.status(404).json({ error: 'Invalid invite' })
  if (row.usedAt) return res.status(410).json({ error: 'Invite already used' })
  if (new Date(row.expiresAt) < new Date()) return res.status(410).json({ error: 'Invite expired' })

  // If user already has a clubId don't overwrite it (idempotent if same club)
  if (ctx.clubId != null && ctx.clubId !== row.clubId) {
    return res.status(409).json({ error: 'You already belong to a different club' })
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const clerkUser = await clerk.users.getUser(ctx.userId)
  await clerk.users.updateUserMetadata(ctx.userId, {
    publicMetadata: { ...clerkUser.publicMetadata, clubId: row.clubId }
  })

  db.prepare(`UPDATE invites SET used_at = datetime('now'), used_by = ? WHERE token = ?`).run(
    ctx.userId,
    req.params.token
  )

  res.json({ ok: true, clubId: row.clubId })
})

module.exports = router

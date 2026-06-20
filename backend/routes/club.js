'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')
const { getAuthContext, requireSuperAdmin } = require('../middleware/auth')
const { validateBody, z } = require('../utils/validate')

const WHCC_DEFAULT = {
  name: 'Edge XI',
  primaryColour: '#690028',
  secondaryColour: '#a00040'
}

const colourRe = /^#[0-9a-fA-F]{6}$/

const clubBodySchema = z.object({
  appName: z.string().min(1).max(80).optional(),
  primaryColour: z.string().regex(colourRe).optional(),
  secondaryColour: z.string().regex(colourRe).optional(),
  nameMarkers: z.array(z.string().min(1)).min(1).optional(),
  playCricketDomain: z.string().max(200).optional()
})

// GET /api/club/config — branding for the requesting user's club
router.get('/config', (req, res) => {
  const clubId = getAuthContext(req).clubId
  if (clubId == null) return res.json(WHCC_DEFAULT)

  const db = getDb()
  const club = db
    .prepare(
      `SELECT app_name AS name, primary_colour AS primaryColour, secondary_colour AS secondaryColour,
              play_cricket_domain AS playCricketDomain, name_markers AS nameMarkers
       FROM clubs WHERE club_id = ?`
    )
    .get(clubId)

  if (club?.nameMarkers) {
    try { club.nameMarkers = JSON.parse(club.nameMarkers) } catch { club.nameMarkers = null }
  }
  res.json(club ?? WHCC_DEFAULT)
})

// GET /api/club/settings — full settings for the requesting user's club (admins)
router.get('/settings', (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.isSuperAdmin && !ctx.isClubAdmin) return res.status(403).json({ error: 'Forbidden' })
  if (ctx.clubId == null) return res.status(404).json({ error: 'No club assigned' })

  const db = getDb()
  const club = db
    .prepare(
      `SELECT club_id AS clubId, name, slug, app_name AS appName,
              primary_colour AS primaryColour, secondary_colour AS secondaryColour,
              name_markers AS nameMarkers, play_cricket_domain AS playCricketDomain
       FROM clubs WHERE club_id = ?`
    )
    .get(ctx.clubId)

  if (!club) return res.status(404).json({ error: 'Club not found' })
  club.nameMarkers = JSON.parse(club.nameMarkers || '[]')
  res.json(club)
})

// PATCH /api/club/settings — update the requesting user's own club
router.patch('/settings', validateBody(clubBodySchema), (req, res) => {
  const ctx = getAuthContext(req)
  if (!ctx.isSuperAdmin && !ctx.isClubAdmin) return res.status(403).json({ error: 'Forbidden' })
  if (ctx.clubId == null) return res.status(404).json({ error: 'No club assigned' })

  const { appName, primaryColour, secondaryColour, nameMarkers, playCricketDomain } = req.body
  const db = getDb()
  const sets = []
  const params = []

  if (appName !== undefined) {
    sets.push('app_name = ?')
    params.push(appName)
  }
  if (primaryColour !== undefined) {
    sets.push('primary_colour = ?')
    params.push(primaryColour)
  }
  if (secondaryColour !== undefined) {
    sets.push('secondary_colour = ?')
    params.push(secondaryColour)
  }
  if (nameMarkers !== undefined) {
    sets.push('name_markers = ?')
    params.push(JSON.stringify(nameMarkers))
  }
  if (playCricketDomain !== undefined) {
    sets.push('play_cricket_domain = ?')
    params.push(playCricketDomain)
  }

  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' })

  params.push(ctx.clubId)
  db.prepare(`UPDATE clubs SET ${sets.join(', ')} WHERE club_id = ?`).run(...params)
  res.json({ ok: true })
})

// GET /api/club/all — super admin: list all clubs
router.get('/all', requireSuperAdmin, (req, res) => {
  const db = getDb()
  const clubs = db
    .prepare(
      `SELECT club_id AS clubId, name, slug, app_name AS appName,
              primary_colour AS primaryColour, secondary_colour AS secondaryColour,
              name_markers AS nameMarkers, play_cricket_domain AS playCricketDomain
       FROM clubs ORDER BY club_id`
    )
    .all()
    .map((c) => ({ ...c, nameMarkers: JSON.parse(c.nameMarkers || '[]') }))
  res.json(clubs)
})

// POST /api/club/all — super admin: create a new club
router.post(
  '/all',
  requireSuperAdmin,
  validateBody(
    z.object({
      name: z.string().min(1).max(120),
      slug: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z0-9-]+$/),
      appName: z.string().min(1).max(80),
      primaryColour: z.string().regex(colourRe),
      secondaryColour: z.string().regex(colourRe),
      nameMarkers: z.array(z.string().min(1)).min(1),
      playCricketDomain: z.string().max(200).optional()
    })
  ),
  (req, res) => {
    const { name, slug, appName, primaryColour, secondaryColour, nameMarkers, playCricketDomain } =
      req.body
    const db = getDb()
    try {
      const result = db
        .prepare(
          `INSERT INTO clubs (name, slug, app_name, primary_colour, secondary_colour, name_markers, play_cricket_domain)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          slug,
          appName,
          primaryColour,
          secondaryColour,
          JSON.stringify(nameMarkers),
          playCricketDomain ?? null
        )
      res.json({ ok: true, clubId: result.lastInsertRowid })
    } catch (e) {
      if (e.message.includes('UNIQUE'))
        return res.status(409).json({ error: 'Slug already exists' })
      throw e
    }
  }
)

// PATCH /api/club/all/:clubId — super admin: update any club
router.patch('/all/:clubId', requireSuperAdmin, validateBody(clubBodySchema), (req, res) => {
  const clubId = Number(req.params.clubId)
  if (!Number.isInteger(clubId)) return res.status(400).json({ error: 'Invalid clubId' })

  const { appName, primaryColour, secondaryColour, nameMarkers, playCricketDomain } = req.body
  const db = getDb()
  const sets = []
  const params = []

  if (appName !== undefined) {
    sets.push('app_name = ?')
    params.push(appName)
  }
  if (primaryColour !== undefined) {
    sets.push('primary_colour = ?')
    params.push(primaryColour)
  }
  if (secondaryColour !== undefined) {
    sets.push('secondary_colour = ?')
    params.push(secondaryColour)
  }
  if (nameMarkers !== undefined) {
    sets.push('name_markers = ?')
    params.push(JSON.stringify(nameMarkers))
  }
  if (playCricketDomain !== undefined) {
    sets.push('play_cricket_domain = ?')
    params.push(playCricketDomain)
  }

  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' })

  params.push(clubId)
  const r = db.prepare(`UPDATE clubs SET ${sets.join(', ')} WHERE club_id = ?`).run(...params)
  if (r.changes === 0) return res.status(404).json({ error: 'Club not found' })
  res.json({ ok: true })
})

module.exports = router

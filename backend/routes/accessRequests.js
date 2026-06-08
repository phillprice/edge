'use strict'
const express = require('express')
const router  = express.Router()
const { apiLimiter } = require('../middleware/rateLimit')
router.use(apiLimiter)
const { getDb } = require('../db/schema')
const { clerkClient } = require('@clerk/express')
const { getAuthContext } = require('../middleware/auth')

// Verified auth context (attached by attachAuthContext middleware).
function getJwtMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, isClubAdmin: ctx.isClubAdmin, groups: ctx.groups, userId: ctx.userId }
}

function canManage(req) {
  const { isSuperAdmin, isClubAdmin } = getJwtMeta(req)
  return isSuperAdmin || isClubAdmin
}

// GET /api/access-requests/teams — all known team+season combos (auth-only, any user).
// Used by the request-access form. Mirrors /api/admin/teams but without the upload gate.
router.get('/teams', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      t.team_id,
      t.season_id,
      COALESCE(wt.label, 'Team ' || t.team_id)                AS label,
      COALESCE(wt.year, substr(MIN(sf.match_date_iso), 1, 4)) AS year
    FROM (
      SELECT team_id, season_id FROM scheduled_fixtures
      UNION
      SELECT team_id, season_id FROM watched_teams
    ) t
    LEFT JOIN watched_teams      wt ON wt.team_id = t.team_id AND wt.season_id = t.season_id
    LEFT JOIN scheduled_fixtures sf ON sf.team_id = t.team_id AND sf.season_id = t.season_id
    GROUP BY t.team_id, t.season_id
    ORDER BY year DESC, label
  `).all()
  res.json(rows)
})

// GET /api/access-requests/my-groups — the requesting user's own access groups with labels (auth-only).
router.get('/my-groups', (req, res) => {
  const db = getDb()
  const { isSuperAdmin, groups } = getJwtMeta(req)

  let rows
  if (isSuperAdmin) {
    rows = db.prepare(`SELECT team_id, season_id, label, year FROM watched_teams ORDER BY year DESC, label ASC`).all()
  } else {
    if (!groups.length) return res.json([])
    const clauses = groups.map(() => '(wt.team_id = ? AND wt.season_id = ?)').join(' OR ')
    const params  = groups.flatMap(g => [Number(g.team_id), Number(g.season_id)])
    rows = db.prepare(`SELECT wt.team_id, wt.season_id, wt.label, wt.year FROM watched_teams wt WHERE ${clauses} ORDER BY wt.year DESC, wt.label ASC`).all(...params)
  }
  res.json(rows.map(r => ({
    team_id: r.team_id, season_id: r.season_id, label: r.label, year: r.year ?? null,
    display: r.year ? `${r.label} ${r.year}` : r.label,
  })))
})

// GET /api/access-requests/count — pending count for badge (club admin / super admin only)
router.get('/count', (req, res) => {
  if (!canManage(req)) return res.json({ count: 0 })
  const { isSuperAdmin, groups } = getJwtMeta(req)
  const db = getDb()

  if (isSuperAdmin || groups.length === 0) {
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM access_requests WHERE status = 'pending'`).get()
    return res.json({ count })
  }
  // Club admin: only count requests for teams they manage
  const placeholders = groups.map(() => '(team_id = ? AND season_id = ?)').join(' OR ')
  const params = groups.flatMap(g => [g.team_id, g.season_id])
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM access_requests WHERE status = 'pending' AND (${placeholders})`).get(...params)
  res.json({ count })
})

// GET /api/access-requests — list requests (club admin / super admin)
router.get('/', (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Not authorised' })
  const { isSuperAdmin, groups } = getJwtMeta(req)
  const db = getDb()
  const status = req.query.status || 'pending'

  let rows
  if (isSuperAdmin || groups.length === 0) {
    rows = db.prepare(`
      SELECT ar.*, wt.label AS team_label, wt.year AS team_year
      FROM access_requests ar
      LEFT JOIN watched_teams wt ON wt.team_id = ar.team_id AND wt.season_id = ar.season_id
      WHERE ar.status = ?
      ORDER BY ar.requested_at DESC
    `).all(status)
  } else {
    const placeholders = groups.map(() => '(ar.team_id = ? AND ar.season_id = ?)').join(' OR ')
    const params = groups.flatMap(g => [g.team_id, g.season_id])
    rows = db.prepare(`
      SELECT ar.*, wt.label AS team_label, wt.year AS team_year
      FROM access_requests ar
      LEFT JOIN watched_teams wt ON wt.team_id = ar.team_id AND wt.season_id = ar.season_id
      WHERE ar.status = ? AND (${placeholders})
      ORDER BY ar.requested_at DESC
    `).all(status, ...params)
  }
  res.json(rows)
})

// POST /api/access-requests — submit a request (any authenticated user)
router.post('/', async (req, res) => {
  const { team_id, season_id } = req.body || {}
  if (!team_id || !season_id) return res.status(400).json({ error: 'team_id and season_id required' })

  const { userId } = getJwtMeta(req)
  if (!userId && process.env.CLERK_SECRET_KEY) return res.status(401).json({ error: 'Not authenticated' })

  let userName = null, userEmail = null
  if (process.env.CLERK_SECRET_KEY && userId) {
    try {
      const u = await clerkClient.users.getUser(userId)
      userName  = [u.firstName, u.lastName].filter(Boolean).join(' ') || null
      userEmail = u.emailAddresses?.[0]?.emailAddress ?? null
    } catch (_) {} // eslint-disable-line no-empty
  }

  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO access_requests (clerk_user_id, user_name, user_email, team_id, season_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(clerk_user_id, team_id, season_id) DO UPDATE SET
        status = CASE WHEN excluded.status = 'pending' THEN 'pending' ELSE status END,
        requested_at = datetime('now')
      WHERE status != 'pending'
    `).run(userId ?? 'dev', userName, userEmail, Number(team_id), Number(season_id))
    res.json({ ok: true })

    require('../utils/notifications').notifyAccessRequest({
      userName, userEmail, teamId: Number(team_id), seasonId: Number(season_id),
    }).catch(e => console.error('[notify] access_request error:', e.message))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/access-requests/:id — approve or deny
router.patch('/:id', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Not authorised' })
  const { action } = req.body || {} // 'approve' | 'deny'
  if (!['approve', 'deny'].includes(action)) return res.status(400).json({ error: 'action must be approve or deny' })

  const db = getDb()
  const request = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(req.params.id)
  if (!request) return res.status(404).json({ error: 'Request not found' })

  // Club admins can only act on teams they have access to
  const { isSuperAdmin, groups, userId: adminId } = getJwtMeta(req)
  if (!isSuperAdmin && groups.length > 0) {
    const canAct = groups.some(g => g.team_id === request.team_id && g.season_id === request.season_id)
    if (!canAct) return res.status(403).json({ error: 'You do not manage this team' })
  }

  if (action === 'approve' && process.env.CLERK_SECRET_KEY) {
    try {
      const user = await clerkClient.users.getUser(request.clerk_user_id)
      const existing = Array.isArray(user.publicMetadata?.accessGroups) ? user.publicMetadata.accessGroups : []
      const already  = existing.some(g => g.team_id === request.team_id && g.season_id === request.season_id)
      if (!already) {
        await clerkClient.users.updateUserMetadata(request.clerk_user_id, {
          publicMetadata: {
            ...user.publicMetadata,
            accessGroups: [...existing, { team_id: request.team_id, season_id: request.season_id }],
          },
        })
      }
    } catch (e) {
      return res.status(500).json({ error: `Could not update user: ${e.message}` })
    }
  }

  db.prepare(`UPDATE access_requests SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .run(action === 'approve' ? 'approved' : 'denied', adminId ?? 'dev', request.id)

  const { notifyAccessOutcome } = require('../utils/notifications')
  notifyAccessOutcome({ clerkUserId: request.clerk_user_id, action, teamId: request.team_id, seasonId: request.season_id })
    .catch(e => console.error('[notify] access_outcome error:', e.message))
  // Subscriptions are now created when the user stars a team as a favourite,
  // not on access approval, so all teams aren't auto-subscribed indiscriminately.

  res.json({ ok: true })
})

module.exports = router

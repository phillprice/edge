'use strict'

const express = require('express')
const router = express.Router()
const { clerkClient } = require('@clerk/express')
const { getAuthContext } = require('../../middleware/auth')
const { canManageUsers, getAdminMeta } = require('./shared')

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.json([])
  const ctx = getAuthContext(req)
  try {
    const { data: users } = await clerkClient.users.getUserList({ limit: 500 })
    if (users.length >= 500)
      console.warn('[admin] getUserList hit limit of 500 — some users may be missing')
    const mapped = users.map((u) => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u.firstName,
      lastName: u.lastName,
      canUpload: u.publicMetadata?.canUpload === true,
      isSuperAdmin: u.publicMetadata?.isSuperAdmin === true,
      isClubAdmin: u.publicMetadata?.isClubAdmin === true,
      accessGroups: u.publicMetadata?.accessGroups ?? [],
      clubId: u.publicMetadata?.clubId ?? null
    }))
    // Super admins see all users; club admins see only their club's users
    const filtered = ctx.isSuperAdmin ? mapped : mapped.filter((u) => u.clubId === ctx.clubId)
    res.json(filtered)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/admin/users/:userId
router.patch('/users/:userId', async (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({ error: 'Clerk not configured' })

  const { isSuperAdmin: callerIsSuper, groups: callerGroups } = getAdminMeta(req)
  const { userId } = req.params
  const allowed = callerIsSuper
    ? ['canUpload', 'isSuperAdmin', 'isClubAdmin', 'accessGroups']
    : ['accessGroups']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No valid fields to update' })
  if (updates.accessGroups !== undefined) {
    if (
      !Array.isArray(updates.accessGroups) ||
      !updates.accessGroups.every((g) => g.team_id !== null && g.season_id !== null)
    ) {
      return res
        .status(400)
        .json({ error: 'accessGroups must be an array of {team_id, season_id}' })
    }
    updates.accessGroups = updates.accessGroups.map((g) => ({
      team_id: Number(g.team_id),
      season_id: Number(g.season_id)
    }))
    if (!callerIsSuper && callerGroups.length > 0) {
      const user = await clerkClient.users.getUser(userId)
      const existing = Array.isArray(user.publicMetadata?.accessGroups)
        ? user.publicMetadata.accessGroups
        : []
      const unmanaged = existing.filter(
        (g) => !callerGroups.some((cg) => cg.team_id === g.team_id && cg.season_id === g.season_id)
      )
      updates.accessGroups = [
        ...unmanaged,
        ...updates.accessGroups.filter((g) =>
          callerGroups.some((cg) => cg.team_id === g.team_id && cg.season_id === g.season_id)
        )
      ]
    }
  }
  try {
    const user = await clerkClient.users.getUser(userId)
    const merged = { ...user.publicMetadata, ...updates }
    await clerkClient.users.updateUserMetadata(userId, { publicMetadata: merged })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router

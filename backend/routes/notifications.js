'use strict'
const express = require('express')
const router  = express.Router()
const { getDbAsync } = require('../db/schema')
const { getAuthContext } = require('../middleware/auth')
const { sendTelegramTo } = require('../utils/notify')
const { apiLimiter } = require('../middleware/rateLimit')

router.use(apiLimiter)

function userId(req) {
  return getAuthContext(req).userId
}

// ── Prefs ──────────────────────────────────────────────────────────────────

// GET /api/notifications/prefs
router.get('/prefs', async (req, res) => {
  const uid = userId(req)
  const db  = getDbAsync()

  const rows = await db.prepare(`SELECT notif_type, channel, enabled FROM notification_prefs WHERE clerk_user_id = ?`).all(uid)
  const prefs = {}
  for (const r of rows) {
    if (!prefs[r.notif_type]) prefs[r.notif_type] = {}
    prefs[r.notif_type][r.channel] = r.enabled === 1
  }
  const DEFAULTS = { access_outcome: { email: true }, new_match: { email: true }, milestone: { email: false } }
  for (const [type, channels] of Object.entries(DEFAULTS)) {
    if (!prefs[type]) prefs[type] = {}
    for (const [ch, def] of Object.entries(channels)) {
      if (prefs[type][ch] === undefined) prefs[type][ch] = def
    }
  }

  const tgRow = await db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(uid)

  res.json({ prefs, telegram: tgRow ? { registered: true, chatIdHint: String(tgRow.chat_id).slice(-4) } : { registered: false } })
})

// PUT /api/notifications/prefs
router.put('/prefs', async (req, res) => {
  const uid = userId(req)
  const { notif_type, channel, enabled } = req.body || {}
  const VALID_TYPES    = ['access_outcome', 'new_match', 'milestone']
  const VALID_CHANNELS = ['email', 'telegram']
  if (!VALID_TYPES.includes(notif_type) || !VALID_CHANNELS.includes(channel)) {
    return res.status(400).json({ error: 'Invalid notif_type or channel' })
  }
  const db = getDbAsync()
  await db.prepare(`
    INSERT INTO notification_prefs (clerk_user_id, notif_type, channel, enabled, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(clerk_user_id, notif_type, channel)
    DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(uid, notif_type, channel, enabled ? 1 : 0)
  res.json({ ok: true })
})

// ── Team subscriptions ─────────────────────────────────────────────────────

// GET /api/notifications/subscriptions
router.get('/subscriptions', async (req, res) => {
  const uid = userId(req)
  const db  = getDbAsync()
  const rows = await db.prepare(`
    SELECT ts.team_id, ts.season_id, ts.channel, ts.enabled,
           wt.label, wt.year
    FROM team_subscriptions ts
    LEFT JOIN watched_teams wt ON wt.team_id = ts.team_id AND wt.season_id = ts.season_id
    WHERE ts.clerk_user_id = ?
    ORDER BY wt.year DESC, wt.label
  `).all(uid)
  res.json(rows)
})

// PUT /api/notifications/subscriptions/:teamId/:seasonId
router.put('/subscriptions/:teamId/:seasonId', async (req, res) => {
  const uid      = userId(req)
  const teamId   = parseInt(req.params.teamId, 10)
  const seasonId = parseInt(req.params.seasonId, 10)
  const { channel = 'email', enabled } = req.body || {}
  if (!teamId || !seasonId) return res.status(400).json({ error: 'Invalid team or season' })

  const db = getDbAsync()
  await db.prepare(`
    INSERT INTO team_subscriptions (clerk_user_id, team_id, season_id, channel, enabled)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(clerk_user_id, team_id, season_id, channel)
    DO UPDATE SET enabled = excluded.enabled
  `).run(uid, teamId, seasonId, channel, enabled ? 1 : 0)
  res.json({ ok: true })
})

// ── Player follows ─────────────────────────────────────────────────────────

// GET /api/notifications/player-follows
router.get('/player-follows', async (req, res) => {
  const uid = userId(req)
  const db  = getDbAsync()
  const rows = await db.prepare(`
    SELECT pf.player_id, pf.channel, COALESCE(p.display_name, p.name) AS player_name
    FROM player_follows pf
    JOIN players p ON p.player_id = pf.player_id
    WHERE pf.clerk_user_id = ?
    ORDER BY player_name
  `).all(uid)
  res.json(rows)
})

// POST /api/notifications/player-follows
router.post('/player-follows', async (req, res) => {
  const uid = userId(req)
  const { player_id, channel = 'email' } = req.body || {}
  if (!player_id) return res.status(400).json({ error: 'player_id required' })

  const db = getDbAsync()
  const player = await db.prepare(`SELECT player_id FROM players WHERE player_id = ?`).get(Number(player_id))
  if (!player) return res.status(404).json({ error: 'Player not found' })

  await db.prepare(`INSERT OR IGNORE INTO player_follows (clerk_user_id, player_id, channel) VALUES (?, ?, ?)`).run(uid, Number(player_id), channel)
  res.json({ ok: true })
})

// DELETE /api/notifications/player-follows/:playerId
router.delete('/player-follows/:playerId', async (req, res) => {
  const uid = userId(req)
  const db  = getDbAsync()
  await db.prepare(`DELETE FROM player_follows WHERE clerk_user_id = ? AND player_id = ?`).run(uid, parseInt(req.params.playerId, 10))
  res.json({ ok: true })
})

// ── Telegram ───────────────────────────────────────────────────────────────

// GET /api/notifications/telegram
router.get('/telegram', async (req, res) => {
  const uid = userId(req)
  const row = await getDbAsync().prepare(`SELECT chat_id, registered_at FROM user_telegram WHERE clerk_user_id = ?`).get(uid)
  if (!row) return res.json({ registered: false })
  res.json({ registered: true, chatIdHint: String(row.chat_id).slice(-4), registeredAt: row.registered_at })
})

// PUT /api/notifications/telegram
router.put('/telegram', async (req, res) => {
  const uid     = userId(req)
  const { chat_id } = req.body || {}
  if (!chat_id || !/^\d+$/.test(String(chat_id))) return res.status(400).json({ error: 'chat_id must be a numeric string' })

  await getDbAsync().prepare(`
    INSERT INTO user_telegram (clerk_user_id, chat_id)
    VALUES (?, ?)
    ON CONFLICT(clerk_user_id) DO UPDATE SET chat_id = excluded.chat_id, registered_at = datetime('now')
  `).run(uid, String(chat_id))

  sendTelegramTo(String(chat_id), `✅ EDGE notifications connected!\n\nYou'll receive Telegram notifications here. Visit ${process.env.APP_BASE_URL || 'https://edge.phillprice.com'}/notifications to manage your preferences.`).catch(() => {})

  res.json({ ok: true })
})

// DELETE /api/notifications/telegram
router.delete('/telegram', async (req, res) => {
  await getDbAsync().prepare(`DELETE FROM user_telegram WHERE clerk_user_id = ?`).run(userId(req))
  res.json({ ok: true })
})

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  res.json({ count: 0 })
})

// ── Unsubscribe (public, no auth) ─────────────────────────────────────────

async function unsubscribeHandler(req, res) {
  const { token } = req.query
  if (!token) return res.status(400).send('<html><body><p>Invalid unsubscribe link.</p></body></html>')

  const db  = getDbAsync()
  const row = await db.prepare(`SELECT clerk_user_id, notif_type FROM notification_prefs WHERE unsub_token = ?`).get(token)
  if (!row) return res.status(404).send('<html><body><p>Unsubscribe link not found or already used.</p></body></html>')

  await db.prepare(`UPDATE notification_prefs SET enabled = 0 WHERE unsub_token = ?`).run(token)

  const LABELS = { access_outcome: 'access notifications', new_match: 'match result emails', milestone: 'milestone alerts' }
  const label = LABELS[row.notif_type] || 'these notifications'
  const appUrl = process.env.APP_BASE_URL || 'https://edge.phillprice.com'
  const html = '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center">' +
    '<p style="font-size:32px">&#9989;</p>' +
    '<h2>Unsubscribed</h2>' +
    '<p>You\'ve been unsubscribed from <strong>' + label + '</strong>.</p>' +
    '<p><a href="' + appUrl + '/notifications">Manage all preferences</a></p>' +
    '</body></html>'
  res.send(html)
}

module.exports = { router, unsubscribeHandler }

'use strict'
const crypto = require('crypto')
const { getDbAsync } = require('../db/schema')
const { sendEmail } = require('./brevo')
const { sendTelegramTo } = require('./notify')
const { createClerkClient } = require('@clerk/express')
const { tmplAccessRequest, tmplAccessOutcome, tmplNewMatch, tmplMilestone, tmplServiceAlert, tmplPendingRequestsDigest } = require('./emailTemplates')

const APP_URL = () => process.env.APP_BASE_URL || 'https://edge.phillprice.com'

// ── Unsubscribe tokens ─────────────────────────────────────────────────────

function getOrCreateUnsubToken(db, clerkUserId, notifType) {
  await db.prepare(`
    INSERT OR IGNORE INTO notification_prefs (clerk_user_id, notif_type, channel, enabled, unsub_token)
    VALUES (?, ?, 'email', 1, ?)
  `).run(clerkUserId, notifType, crypto.randomUUID())
  const row = await db.prepare(
    `SELECT unsub_token FROM notification_prefs WHERE clerk_user_id = ? AND notif_type = ? AND channel = 'email'`
  ).get(clerkUserId, notifType)
  if (!row?.unsub_token) {
    const token = crypto.randomUUID()
    await db.prepare(`UPDATE notification_prefs SET unsub_token = ? WHERE clerk_user_id = ? AND notif_type = ? AND channel = 'email'`)
      .run(token, clerkUserId, notifType)
    return token
  }
  return row.unsub_token
}

function unsubUrl(token) {
  return `${APP_URL()}/api/notifications/unsubscribe?token=${token}`
}

// ── Pref helpers ───────────────────────────────────────────────────────────

function isEnabled(db, clerkUserId, notifType, channel) {
  const row = await db.prepare(
    `SELECT enabled FROM notification_prefs WHERE clerk_user_id = ? AND notif_type = ? AND channel = ?`
  ).get(clerkUserId, notifType, channel)
  // Default: email on for most types; telegram off unless user sets it up
  if (!row) return channel === 'email' ? notifType !== 'milestone' : false
  return row.enabled === 1
}

// ── Admin resolution ───────────────────────────────────────────────────────

async function getAdminRecipients(db) {
  if (!process.env.CLERK_SECRET_KEY) return []
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const { data } = await clerk.users.getUserList({ limit: 100 })
  return data
    .filter(u => u.publicMetadata?.isSuperAdmin || u.publicMetadata?.isClubAdmin)
    .map(u => ({
      clerkUserId: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      name:  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.emailAddresses?.[0]?.emailAddress || 'Admin',
    }))
    .filter(u => u.email)
}

// ── Public dispatch functions ──────────────────────────────────────────────

/**
 * Notify all admins of a new access request.
 * Always fires — no prefs check. Fire-and-forget safe.
 */
async function notifyAccessRequest({ userName, userEmail, teamId, seasonId }) {
  const db = getDbAsync()
  const teamRow = await db.prepare(
    `SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`
  ).get(teamId, seasonId)
  const teamLabel = teamRow?.label || `team ${teamId}`

  const admins = await getAdminRecipients(db)
  const { subject, htmlContent } = tmplAccessRequest({ userName, userEmail, teamLabel, adminUrl: APP_URL() })
  const tgText = `🔔 New access request\n${userName || userEmail} wants access to ${teamLabel}\n${APP_URL()}/admin`

  for (const admin of admins) {
    sendEmail({ to: admin.email, toName: admin.name, subject, htmlContent }).catch(e =>
      console.error('[notifications] access_request email error:', e.message))
    const tgRow = await db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(admin.clerkUserId)
    if (tgRow?.chat_id) sendTelegramTo(tgRow.chat_id, tgText).catch(() => {})
  }
}

function sendAccessOutcomeTelegram(db, clerkUserId, action, teamLabel) {
  const tgRow = await db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(clerkUserId)
  if (!tgRow?.chat_id) return
  const approved = action === 'approve' || action === 'approved'
  const msg = (approved ? '✅' : '❌') + ' Your access to ' + teamLabel + ' has been ' + (approved ? 'approved' : 'denied') + '.'
  sendTelegramTo(tgRow.chat_id, msg).catch(() => {})
}

function getUserEmail(user) {
  return user.emailAddresses[0]?.emailAddress
}

function getUserName(user, fallback) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || fallback
}

/**
 * Notify the requesting user of an approval or denial.
 */
// #lizard forgive
async function notifyAccessOutcome({ clerkUserId, action, teamId, seasonId }) {
  if (!clerkUserId || !process.env.CLERK_SECRET_KEY) return
  const db = getDbAsync()

  const emailOn = isEnabled(db, clerkUserId, 'access_outcome', 'email')
  const tgOn    = isEnabled(db, clerkUserId, 'access_outcome', 'telegram')
  if (!emailOn && !tgOn) return

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const user      = await clerk.users.getUser(clerkUserId)
  const email     = getUserEmail(user)
  const name      = getUserName(user, email)
  const teamRow   = await db.prepare(`SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`).get(teamId, seasonId)
  const teamLabel = teamRow ? teamRow.label : 'team ' + teamId

  if (email && emailOn) {
    const unsubToken = getOrCreateUnsubToken(db, clerkUserId, 'access_outcome')
    const tmpl = tmplAccessOutcome({ userName: name, action, teamLabel, appUrl: APP_URL(), unsubLink: unsubUrl(unsubToken) })
    sendEmail({ to: email, toName: name, subject: tmpl.subject, htmlContent: tmpl.htmlContent }).catch(e => console.error('[notifications] access_outcome email error:', e.message))
  }
  if (tgOn) sendAccessOutcomeTelegram(db, clerkUserId, action, teamLabel)
}

/**
 * Auto-subscribe user to match notifications for a team/season.
 * Called synchronously when access is approved.
 */
function subscribeUserToTeam(db, clerkUserId, teamId, seasonId) {
  await db.prepare(`
    INSERT OR IGNORE INTO team_subscriptions (clerk_user_id, team_id, season_id, channel, enabled)
    VALUES (?, ?, ?, 'email', 1)
  `).run(clerkUserId, teamId, seasonId)
}

/**
 * Send new_match notifications to all team subscribers.
 */
// #lizard forgive
async function notifyNewMatch({ fixtureId, teamId, seasonId, matchData }) {
  const db = getDbAsync()
  const { fix, topBat, topBowl, mvp } = matchData

  const subscribers = await db.prepare(`
    SELECT ts.clerk_user_id, ts.channel, ut.chat_id
    FROM team_subscriptions ts
    LEFT JOIN user_telegram ut ON ut.clerk_user_id = ts.clerk_user_id
    WHERE ts.team_id = ? AND ts.season_id = ? AND ts.enabled = 1
  `).all(teamId, seasonId)

  if (!subscribers.length) return

  const teamRow = await db.prepare(`SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`).get(teamId, seasonId)
  const teamLabel = teamRow ? teamRow.label : 'team ' + teamId
  const matchCtx  = buildMatchCtx(db, fix, fixtureId, topBat, topBowl, mvp, teamLabel)

  const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null
  const byUser = groupSubscribersByUser(subscribers)

  for (const [clerkUserId, { channels, chatId }] of Object.entries(byUser)) {
    await sendNewMatchEmailToUser({ db, clerk, clerkUserId, channels, matchCtx })
    sendNewMatchTelegram(chatId, channels, matchCtx, fix)
  }
}

function sendNewMatchTelegram(chatId, channels, matchCtx, fix) {
  if (!channels.has('telegram') || !chatId) return
  const emoji = fix.result && fix.result.toLowerCase().includes('won') ? '✅' : '📋'
  const msg = emoji + ' ' + matchCtx.whccTeam + ' v ' + matchCtx.oppTeam + ' – ' + matchCtx.date + '\n' + (fix.result || '') + '\n' + matchCtx.matchUrl
  sendTelegramTo(chatId, msg).catch(() => {})
}

function groupSubscribersByUser(subscribers) {
  const byUser = {}
  for (const s of subscribers) {
    if (!byUser[s.clerk_user_id]) byUser[s.clerk_user_id] = { channels: new Set(), chatId: s.chat_id }
    byUser[s.clerk_user_id].channels.add(s.channel)
  }
  return byUser
}

function buildMatchCtx(db, fix, fixtureId, topBat, topBowl, mvp, teamLabel) {
  const { isWhccTeam } = require('./db')
  const isWhccHome = isWhccTeam(fix.home_team)
  const whccTeam   = (fix[isWhccHome ? 'home_team' : 'away_team'] || '').replace(/Woking\s*(?:&|and)?\s*Horsell\s*(?:Cricket\s*Club|CC)?\s*[-–]?\s*/gi, '').trim() || 'WHCC'
  const oppTeam    = fix[isWhccHome ? 'away_team' : 'home_team'] || 'Opposition'
  return { whccTeam, oppTeam, date: fix.match_date_iso || fix.match_date || '', fix, topBat, topBowl, mvp, matchUrl: APP_URL() + '/match/' + fixtureId, teamLabel }
}

// #lizard forgive
async function sendNewMatchEmailToUser(ctx) {
  const { db, clerk, clerkUserId, channels, matchCtx } = ctx
  if (!channels.has('email')) return
  try {
    const user  = clerk ? await clerk.users.getUser(clerkUserId) : null
    const email = user ? getUserEmail(user) : null
    const name  = user ? getUserName(user, email) : null
    if (!email) return
    const { whccTeam, oppTeam, date, fix, topBat, topBowl, mvp, matchUrl, teamLabel } = matchCtx
    const unsubToken = getOrCreateUnsubToken(db, clerkUserId, 'new_match')
    const { subject, htmlContent } = tmplNewMatch({ userName: name, whccTeam, oppTeam, date, result: fix.result, topBat, topBowl, mvp, matchUrl, teamLabel, unsubLink: unsubUrl(unsubToken) })
    sendEmail({ to: email, toName: name, subject, htmlContent }).catch(e => console.error('[notifications] new_match email error:', e.message))
  } catch (e) {
    console.error('[notifications] new_match Clerk lookup error:', e.message)
  }
}

/**
 * Send milestone notifications to followers of players who hit milestones.
 */
async function notifyMilestones({ fixtureId, milestones }) {
  if (!milestones?.length) return
  const db = getDbAsync()
  const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null
  const matchUrl = `${APP_URL()}/match/${fixtureId}`

  for (const { playerId, playerName, milestones: playerMilestones } of milestones) {
    const followers = await db.prepare(`
      SELECT pf.clerk_user_id, pf.channel, ut.chat_id
      FROM player_follows pf
      LEFT JOIN user_telegram ut ON ut.clerk_user_id = pf.clerk_user_id
      WHERE pf.player_id = ?
    `).all(playerId)

    for (const follower of followers) {
      await sendMilestoneToFollower(db, clerk, follower, { playerName, playerMilestones, matchUrl })
    }
  }
}

function sendMilestoneTelegram(follower, playerName, playerMilestones, matchUrl) {
  if (follower.channel !== 'telegram' || !follower.chat_id) return
  sendTelegramTo(follower.chat_id, '⭐ Milestone: ' + playerName + '\n' + playerMilestones.join(', ') + '\n' + matchUrl).catch(() => {})
}

async function sendMilestoneEmail(db, clerk, follower, playerName, playerMilestones, matchUrl) {
  const user  = clerk ? await clerk.users.getUser(follower.clerk_user_id) : null
  const email = user ? getUserEmail(user) : null
  if (!email) return
  if (!isEnabled(db, follower.clerk_user_id, 'milestone', 'email')) return
  const name       = getUserName(user, email)
  const unsubToken = getOrCreateUnsubToken(db, follower.clerk_user_id, 'milestone')
  const { subject, htmlContent } = tmplMilestone({ userName: name, playerName, milestones: playerMilestones, matchUrl, unsubLink: unsubUrl(unsubToken) })
  sendEmail({ to: email, toName: name, subject, htmlContent }).catch(e => console.error('[notifications] milestone email error:', e.message))
}

async function sendMilestoneToFollower(db, clerk, follower, { playerName, playerMilestones, matchUrl }) {
  sendMilestoneTelegram(follower, playerName, playerMilestones, matchUrl)
  if (follower.channel !== 'email') return
  try {
    await sendMilestoneEmail(db, clerk, follower, playerName, playerMilestones, matchUrl)
  } catch (e) {
    console.error('[notifications] milestone Clerk lookup error:', e.message)
  }
}

/**
 * Notify superadmins of a service/operational error.
 */
async function notifyServiceAlert({ message, detail }) {
  const db = getDbAsync()
  const admins = await getAdminRecipients(db).catch(() => [])
  const { subject, htmlContent } = tmplServiceAlert({ message, detail })
  const tgText = `⚠️ EDGE service alert\n${message}${detail ? '\n' + String(detail).slice(0, 200) : ''}`

  for (const admin of admins) {
    sendEmail({ to: admin.email, toName: admin.name, subject, htmlContent }).catch(() => {})
    const tgRow = await db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(admin.clerkUserId)
    if (tgRow?.chat_id) sendTelegramTo(tgRow.chat_id, tgText).catch(() => {})
  }
}

/**
 * Daily digest of pending access requests older than 7 days.
 */
async function notifyPendingRequestsDigest() {
  const db = getDbAsync()
  const requests = await db.prepare(`
    SELECT ar.*, wt.label AS team_label
    FROM access_requests ar
    LEFT JOIN watched_teams wt ON wt.team_id = ar.team_id AND wt.season_id = ar.season_id
    WHERE ar.status = 'pending'
      AND ar.requested_at < datetime('now', '-7 days')
    ORDER BY ar.requested_at ASC
  `).all()

  if (!requests.length) return

  const admins = await getAdminRecipients(db).catch(() => [])
  const { subject, htmlContent } = tmplPendingRequestsDigest({ requests })

  for (const admin of admins) {
    sendEmail({ to: admin.email, toName: admin.name, subject, htmlContent }).catch(() => {})
  }
}

module.exports = {
  notifyAccessRequest,
  notifyAccessOutcome,
  subscribeUserToTeam,
  notifyNewMatch,
  notifyMilestones,
  notifyServiceAlert,
  notifyPendingRequestsDigest
}

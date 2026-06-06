'use strict'
const crypto = require('crypto')
const { getDb } = require('../db/schema')
const { sendEmail } = require('./brevo')
const { sendTelegramTo } = require('./notify')
const { createClerkClient } = require('@clerk/express')

const APP_URL = () => process.env.APP_BASE_URL || 'https://edge.phillprice.com'

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Unsubscribe tokens ─────────────────────────────────────────────────────

function getOrCreateUnsubToken(db, clerkUserId, notifType) {
  db.prepare(`
    INSERT OR IGNORE INTO notification_prefs (clerk_user_id, notif_type, channel, enabled, unsub_token)
    VALUES (?, ?, 'email', 1, ?)
  `).run(clerkUserId, notifType, crypto.randomUUID())
  const row = db.prepare(
    `SELECT unsub_token FROM notification_prefs WHERE clerk_user_id = ? AND notif_type = ? AND channel = 'email'`
  ).get(clerkUserId, notifType)
  if (!row?.unsub_token) {
    const token = crypto.randomUUID()
    db.prepare(`UPDATE notification_prefs SET unsub_token = ? WHERE clerk_user_id = ? AND notif_type = ? AND channel = 'email'`)
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
  const row = db.prepare(
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

// ── Email templates ────────────────────────────────────────────────────────

function wrap(content) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<div style="border-bottom:3px solid #690028;padding-bottom:12px;margin-bottom:24px">
  <strong style="font-size:18px;color:#690028">EDGE</strong>
  <span style="color:#555;font-size:14px;margin-left:8px">WHCC Cricket Stats</span>
</div>
${content}
<div style="border-top:1px solid #eee;margin-top:32px;padding-top:12px;font-size:12px;color:#888">
  EDGE &ndash; Enhanced Data for Game Evolution &middot; <a href="${APP_URL()}" style="color:#888">edge.phillprice.com</a>
</div></body></html>`
}

function tmplAccessRequest({ userName, userEmail, teamLabel, adminUrl }) {
  const eName = escHtml(userName || userEmail)
  const eEmail = escHtml(userEmail)
  const eTeam = escHtml(teamLabel)
  return {
    subject: `New access request from ${userName || userEmail}`,
    htmlContent: wrap(`
      <p>Hi,</p>
      <p><strong>${eName}</strong> (${eEmail}) has requested access to <strong>${eTeam}</strong>.</p>
      <p><a href="${escHtml(adminUrl)}/admin" style="background:#690028;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;display:inline-block">Review request</a></p>
    `),
  }
}

function tmplAccessOutcome({ userName, action, teamLabel, appUrl, unsubLink }) {
  const approved = action === 'approve' || action === 'approved'
  const eName = escHtml(userName || 'there')
  const eTeam = escHtml(teamLabel)
  return {
    subject: `Your access request has been ${approved ? 'approved' : 'denied'}`,
    htmlContent: wrap(`
      <p>Hi ${eName},</p>
      <p>Your request to access <strong>${eTeam}</strong> has been <strong>${approved ? 'approved' : 'denied'}</strong>.</p>
      ${approved
        ? `<p><a href="${escHtml(appUrl)}" style="background:#690028;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;display:inline-block">View match stats</a></p>`
        : '<p>If you think this is a mistake, please contact your team administrator.</p>'}
      <p style="font-size:12px;color:#888;margin-top:32px"><a href="${escHtml(unsubLink)}" style="color:#888">Unsubscribe from access notifications</a></p>
    `),
  }
}

function tmplNewMatch({ userName, whccTeam, oppTeam, date, result, topBat, topBowl, mvp, matchUrl, teamLabel, unsubLink }) {
  const resultLine = result ? `<p style="font-size:18px">${escHtml(result)}</p>` : ''
  const statsLines = [
    topBat  ? `<tr><td style="padding:4px 8px;color:#555">Top bat</td><td style="padding:4px 8px"><strong>${escHtml(topBat.name)}</strong> ${escHtml(topBat.runs)} (${escHtml(topBat.balls)}b)</td></tr>` : '',
    topBowl ? `<tr><td style="padding:4px 8px;color:#555">Top bowl</td><td style="padding:4px 8px"><strong>${escHtml(topBowl.name)}</strong> ${escHtml(topBowl.wickets)}/${escHtml(topBowl.runs)}</td></tr>` : '',
    mvp     ? `<tr><td style="padding:4px 8px;color:#555">MVP</td><td style="padding:4px 8px"><strong>${escHtml(mvp.name)}</strong> (${escHtml(mvp.pts)} pts)</td></tr>` : ''
  ].filter(Boolean).join('')
  return {
    subject: `${whccTeam} v ${oppTeam} – ${date}`,
    htmlContent: wrap(`
      <p>Hi ${escHtml(userName || 'there')},</p>
      <h2 style="margin:0 0 4px">${escHtml(whccTeam)} v ${escHtml(oppTeam)}</h2>
      <p style="color:#555;margin:0 0 16px">${escHtml(date)}</p>
      ${resultLine}
      ${statsLines ? `<table style="border-collapse:collapse;margin:16px 0">${statsLines}</table>` : ''}
      <p><a href="${escHtml(matchUrl)}" style="background:#690028;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;display:inline-block">View full scorecard</a></p>
      <p style="font-size:12px;color:#888;margin-top:32px"><a href="${escHtml(unsubLink)}" style="color:#888">Unsubscribe from ${escHtml(teamLabel)} match emails</a></p>
    `),
  }
}

function tmplMilestone({ userName, playerName, milestones, matchUrl, unsubLink }) {
  const items = milestones.map(m => `<li>${escHtml(m)}</li>`).join('')
  return {
    subject: `Milestone: ${playerName}`,
    htmlContent: wrap(`
      <p>Hi ${escHtml(userName || 'there')},</p>
      <p><strong>${escHtml(playerName)}</strong> hit a milestone:</p>
      <ul style="padding-left:20px">${items}</ul>
      <p><a href="${escHtml(matchUrl)}" style="background:#690028;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;display:inline-block">View match</a></p>
      <p style="font-size:12px;color:#888;margin-top:32px"><a href="${escHtml(unsubLink)}" style="color:#888">Unsubscribe from milestone alerts</a></p>
    `),
  }
}

function tmplServiceAlert({ message, detail }) {
  return {
    subject: `[EDGE] Service alert: ${message}`,
    htmlContent: wrap(`
      <p><strong>Service alert</strong></p>
      <p>${escHtml(message)}</p>
      ${detail ? `<pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:12px;overflow:auto">${escHtml(String(detail).slice(0, 500))}</pre>` : ''}
    `),
  }
}

function tmplPendingRequestsDigest({ requests }) {
  const rows = requests.map(r =>
    `<tr><td style="padding:4px 8px">${escHtml(r.user_name || r.user_email || r.clerk_user_id)}</td><td style="padding:4px 8px">${escHtml(r.team_label || `team ${r.team_id}`)}</td><td style="padding:4px 8px;color:#888">${escHtml(r.requested_at?.slice(0, 10))}</td></tr>`
  ).join('')
  return {
    subject: `${requests.length} access request${requests.length === 1 ? '' : 's'} pending action`,
    htmlContent: wrap(`
      <p>The following access requests have been waiting for more than 7 days:</p>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:4px 8px;text-align:left">User</th>
          <th style="padding:4px 8px;text-align:left">Team</th>
          <th style="padding:4px 8px;text-align:left">Requested</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="${APP_URL()}/admin" style="background:#690028;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:16px">Review requests</a></p>
    `),
  }
}

// ── Public dispatch functions ──────────────────────────────────────────────

/**
 * Notify all admins of a new access request.
 * Always fires — no prefs check. Fire-and-forget safe.
 */
async function notifyAccessRequest({ userName, userEmail, teamId, seasonId }) {
  const db = getDb()
  const teamRow = db.prepare(
    `SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`
  ).get(teamId, seasonId)
  const teamLabel = teamRow?.label || `team ${teamId}`

  const admins = await getAdminRecipients(db)
  const { subject, htmlContent } = tmplAccessRequest({ userName, userEmail, teamLabel, adminUrl: APP_URL() })
  const tgText = `🔔 New access request\n${userName || userEmail} wants access to ${teamLabel}\n${APP_URL()}/admin`

  for (const admin of admins) {
    sendEmail({ to: admin.email, toName: admin.name, subject, htmlContent }).catch(e =>
      console.error('[notifications] access_request email error:', e.message))
    const tgRow = db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(admin.clerkUserId)
    if (tgRow?.chat_id) sendTelegramTo(tgRow.chat_id, tgText).catch(() => {})
  }
}

/**
 * Notify the requesting user of an approval or denial.
 */
async function notifyAccessOutcome({ clerkUserId, action, teamId, seasonId }) {
  if (!clerkUserId || !process.env.CLERK_SECRET_KEY) return
  const db = getDb()

  if (!isEnabled(db, clerkUserId, 'access_outcome', 'email') &&
      !isEnabled(db, clerkUserId, 'access_outcome', 'telegram')) return

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const user = await clerk.users.getUser(clerkUserId)
  const email   = user.emailAddresses?.[0]?.emailAddress
  const name    = [user.firstName, user.lastName].filter(Boolean).join(' ') || email

  const teamRow = db.prepare(`SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`).get(teamId, seasonId)
  const teamLabel = teamRow?.label || `team ${teamId}`

  if (email && isEnabled(db, clerkUserId, 'access_outcome', 'email')) {
    const unsubToken = getOrCreateUnsubToken(db, clerkUserId, 'access_outcome')
    const { subject, htmlContent } = tmplAccessOutcome({
      userName: name, action, teamLabel, appUrl: APP_URL(), unsubLink: unsubUrl(unsubToken),
    })
    sendEmail({ to: email, toName: name, subject, htmlContent }).catch(e =>
      console.error('[notifications] access_outcome email error:', e.message))
  }

  if (isEnabled(db, clerkUserId, 'access_outcome', 'telegram')) {
    const tgRow = db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(clerkUserId)
    if (tgRow?.chat_id) {
      const approved = action === 'approve' || action === 'approved'
      sendTelegramTo(tgRow.chat_id, `${approved ? '✅' : '❌'} Your access to ${teamLabel} has been ${approved ? 'approved' : 'denied'}.`).catch(() => {})
    }
  }
}

/**
 * Auto-subscribe user to match notifications for a team/season.
 * Called synchronously when access is approved.
 */
function subscribeUserToTeam(db, clerkUserId, teamId, seasonId) {
  db.prepare(`
    INSERT OR IGNORE INTO team_subscriptions (clerk_user_id, team_id, season_id, channel, enabled)
    VALUES (?, ?, ?, 'email', 1)
  `).run(clerkUserId, teamId, seasonId)
}

/**
 * Send new_match notifications to all team subscribers.
 */
async function notifyNewMatch({ fixtureId, teamId, seasonId, matchData }) {
  const db = getDb()
  const { fix, topBat, topBowl, mvp } = matchData

  const subscribers = db.prepare(`
    SELECT ts.clerk_user_id, ts.channel, ut.chat_id
    FROM team_subscriptions ts
    LEFT JOIN user_telegram ut ON ut.clerk_user_id = ts.clerk_user_id
    WHERE ts.team_id = ? AND ts.season_id = ? AND ts.enabled = 1
  `).all(teamId, seasonId)

  if (!subscribers.length) return

  const teamRow = db.prepare(`SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? LIMIT 1`).get(teamId, seasonId)
  const teamLabel = teamRow?.label || `team ${teamId}`

  const { isWhccTeam } = require('./db')
  const isWhccHome = isWhccTeam(fix.home_team)
  const whccTeam   = fix[isWhccHome ? 'home_team' : 'away_team']?.replace(/Woking\s*(?:&|and)?\s*Horsell\s*(?:Cricket\s*Club|CC)?\s*[-–]?\s*/gi, '').trim() || 'WHCC'
  const oppTeam    = fix[isWhccHome ? 'away_team' : 'home_team'] || 'Opposition'
  const date       = fix.match_date_iso || fix.match_date || ''
  const matchUrl   = `${APP_URL()}/match/${fixtureId}`

  const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null

  // Group by clerk_user_id to send one email per user even if multiple subscription rows
  const byUser = {}
  for (const s of subscribers) {
    if (!byUser[s.clerk_user_id]) byUser[s.clerk_user_id] = { channels: new Set(), chatId: s.chat_id }
    byUser[s.clerk_user_id].channels.add(s.channel)
  }

  for (const [clerkUserId, { channels, chatId }] of Object.entries(byUser)) {
    if (channels.has('email')) {
      try {
        const user  = clerk ? await clerk.users.getUser(clerkUserId) : null
        const email = user?.emailAddresses?.[0]?.emailAddress
        const name  = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || email : null
        if (email) {
          const unsubToken = getOrCreateUnsubToken(db, clerkUserId, 'new_match')
          const { subject, htmlContent } = tmplNewMatch({
            userName: name, whccTeam, oppTeam, date, result: fix.result,
            topBat, topBowl, mvp, matchUrl, teamLabel, unsubLink: unsubUrl(unsubToken),
          })
          sendEmail({ to: email, toName: name, subject, htmlContent }).catch(e =>
            console.error('[notifications] new_match email error:', e.message))
        }
      } catch (e) {
        console.error('[notifications] new_match Clerk lookup error:', e.message)
      }
    }
    if (channels.has('telegram') && chatId) {
      const emoji = fix.result?.toLowerCase().includes('won') ? '✅' : '📋'
      sendTelegramTo(chatId, `${emoji} ${whccTeam} v ${oppTeam} – ${date}\n${fix.result || ''}\n${matchUrl}`).catch(() => {})
    }
  }
}

/**
 * Send milestone notifications to followers of players who hit milestones.
 */
async function notifyMilestones({ fixtureId, milestones }) {
  if (!milestones?.length) return
  const db = getDb()
  const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null
  const matchUrl = `${APP_URL()}/match/${fixtureId}`

  for (const { playerId, playerName, milestones: playerMilestones } of milestones) {
    const followers = db.prepare(`
      SELECT pf.clerk_user_id, pf.channel, ut.chat_id
      FROM player_follows pf
      LEFT JOIN user_telegram ut ON ut.clerk_user_id = pf.clerk_user_id
      WHERE pf.player_id = ?
    `).all(playerId)

    for (const follower of followers) {
      if (follower.channel === 'email') {
        try {
          const user  = clerk ? await clerk.users.getUser(follower.clerk_user_id) : null
          const email = user?.emailAddresses?.[0]?.emailAddress
          const name  = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || email : null
          if (email && isEnabled(db, follower.clerk_user_id, 'milestone', 'email')) {
            const unsubToken = getOrCreateUnsubToken(db, follower.clerk_user_id, 'milestone')
            const { subject, htmlContent } = tmplMilestone({ userName: name, playerName, milestones: playerMilestones, matchUrl, unsubLink: unsubUrl(unsubToken) })
            sendEmail({ to: email, toName: name, subject, htmlContent }).catch(e =>
              console.error('[notifications] milestone email error:', e.message))
          }
        } catch (e) {
          console.error('[notifications] milestone Clerk lookup error:', e.message)
        }
      }
      if (follower.channel === 'telegram' && follower.chat_id) {
        sendTelegramTo(follower.chat_id, `⭐ Milestone: ${playerName}\n${playerMilestones.join(', ')}\n${matchUrl}`).catch(() => {})
      }
    }
  }
}

/**
 * Notify superadmins of a service/operational error.
 */
async function notifyServiceAlert({ message, detail }) {
  const db = getDb()
  const admins = await getAdminRecipients(db).catch(() => [])
  const { subject, htmlContent } = tmplServiceAlert({ message, detail })
  const tgText = `⚠️ EDGE service alert\n${message}${detail ? '\n' + String(detail).slice(0, 200) : ''}`

  for (const admin of admins) {
    sendEmail({ to: admin.email, toName: admin.name, subject, htmlContent }).catch(() => {})
    const tgRow = db.prepare(`SELECT chat_id FROM user_telegram WHERE clerk_user_id = ?`).get(admin.clerkUserId)
    if (tgRow?.chat_id) sendTelegramTo(tgRow.chat_id, tgText).catch(() => {})
  }
}

/**
 * Daily digest of pending access requests older than 7 days.
 */
async function notifyPendingRequestsDigest() {
  const db = getDb()
  const requests = db.prepare(`
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
  notifyPendingRequestsDigest,
}

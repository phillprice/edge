'use strict'
const { escHtml } = require('./escHtml')

const APP_URL = () => process.env.APP_BASE_URL || 'https://edge.phillprice.com'

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
    `)
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
    `)
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
    `)
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
    `)
  }
}

function tmplServiceAlert({ message, detail }) {
  return {
    subject: `[EDGE] Service alert: ${message}`,
    htmlContent: wrap(`
      <p><strong>Service alert</strong></p>
      <p>${escHtml(message)}</p>
      ${detail ? `<pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:12px;overflow:auto">${escHtml(String(detail).slice(0, 500))}</pre>` : ''}
    `)
  }
}

function tmplPendingRequestsDigest({ requests }) {
  const rows = requests.map(r =>
    `<tr><td style="padding:4px 8px">${escHtml(r.user_name || r.user_email || r.clerk_user_id)}</td><td style="padding:4px 8px">${escHtml(r.team_label || 'team ' + r.team_id)}</td><td style="padding:4px 8px;color:#888">${escHtml(r.requested_at?.slice(0, 10))}</td></tr>`
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
    `)
  }
}

module.exports = { tmplAccessRequest, tmplAccessOutcome, tmplNewMatch, tmplMilestone, tmplServiceAlert, tmplPendingRequestsDigest }

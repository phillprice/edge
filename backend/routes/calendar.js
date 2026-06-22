'use strict'

const crypto = require('crypto')
const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')
const { getAuthContext } = require('../middleware/auth')
const { parseGroupPairs } = require('../utils/access')

// ── ICS helpers ──────────────────────────────────────────────────────────────

function escIcs(s) {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const out = []
  let pos = 0
  while (pos < bytes.length) {
    // find chunk boundary that doesn't split a multi-byte char
    let end = pos + 75
    if (end >= bytes.length) {
      out.push(bytes.slice(pos).toString('utf8'))
      break
    }
    while (end > pos && (bytes[end] & 0xc0) === 0x80) end--
    out.push(bytes.slice(pos, end).toString('utf8'))
    pos = end
  }
  return out.join('\r\n ')
}

// Normalise to YYYY-MM-DD — scheduled_fixtures store datetime strings like "2026-06-24T18:00:00"
function dateOnly(iso) {
  return (iso || '').slice(0, 10)
}

function nextDay(iso) {
  const d = new Date(dateOnly(iso) + 'T12:00:00Z')
  if (isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// Add minutes to a local datetime (floating — no tz conversion).
// dateStr: 'YYYY-MM-DD', timePart: 'HH:MM:SS' → {dateCompact, timeCompact}
function addMinutes(dateStr, timePart, minutes) {
  const [h, m, s] = (timePart + ':0').split(':').map(Number)
  const totalMins = h * 60 + m + minutes
  const endH = Math.floor(totalMins / 60) % 24
  const endM = totalMins % 60
  const overflow = Math.floor(totalMins / 1440)

  let endDate = dateStr
  if (overflow > 0) {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + overflow)
    endDate = d.toISOString().slice(0, 10)
  }

  const p = (n) => String(n).padStart(2, '0')
  return { dateCompact: endDate.replace(/-/g, ''), timeCompact: `${p(endH)}${p(endM)}${p(s || 0)}` }
}

function dtstamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

// Returns {dtStart, dtEnd} strings for a row, or null if the date is invalid.
// Timed events use floating local time (no tz suffix); date-only fall back to VALUE=DATE.
function buildEventDates(row) {
  const rawDate = row.match_date_iso
  const dateStr = dateOnly(rawDate)
  const dateCompact = dateStr.replace(/-/g, '')

  if (rawDate.length > 10 && rawDate[10] === 'T') {
    const timePart = rawDate.slice(11, 19)
    const maxOvers = row.max_overs || 20
    const endDt = addMinutes(dateStr, timePart, Math.round((maxOvers / 10) * 90))
    return {
      dtStart: `DTSTART:${dateCompact}T${timePart.replace(/:/g, '')}`,
      dtEnd: `DTEND:${endDt.dateCompact}T${endDt.timeCompact}`
    }
  }

  const end = nextDay(rawDate)
  if (!end) return null
  return { dtStart: `DTSTART;VALUE=DATE:${dateCompact}`, dtEnd: `DTEND;VALUE=DATE:${end}` }
}

function buildIcs(rows, calName) {
  const stamp = dtstamp()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Edge XI//Cricket Fixtures//EN',
    `X-WR-CALNAME:${escIcs(calName)}`,
    'X-PUBLISHED-TTL:PT1H',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ]

  for (const row of rows) {
    if (!row.match_date_iso) continue
    const dates = buildEventDates(row)
    if (!dates) continue

    const uid = row.play_cricket_id
      ? `PCID_${row.play_cricket_id}@edgexi.uk`
      : `MAN_${row.fixture_id}@edgexi.uk`

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(dates.dtStart)
    lines.push(dates.dtEnd)
    lines.push(foldLine(`SUMMARY:${escIcs(row.home_team)} v ${escIcs(row.away_team)}`))
    if (row.ground) lines.push(foldLine(`LOCATION:${escIcs(row.ground)}`))
    if (row.competition) lines.push(foldLine(`DESCRIPTION:${escIcs(row.competition)}`))
    lines.push('STATUS:CONFIRMED')
    lines.push('TRANSP:OPAQUE')
    lines.push(`DTSTAMP:${stamp}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// ── Active groups query ──────────────────────────────────────────────────────

function getActiveGroups(db, clubId) {
  return db
    .prepare(
      `SELECT DISTINCT wt.team_id, wt.season_id, wt.label, wt.year
       FROM watched_teams wt
       WHERE wt.club_id = ?
         AND (
           EXISTS (
             SELECT 1 FROM fixtures f
             JOIN fixture_seasons fs ON fs.fixture_id = f.fixture_id
             WHERE fs.team_id = wt.team_id AND fs.season_id = wt.season_id
               AND f.match_date_iso >= date('now')
           )
           OR EXISTS (
             SELECT 1 FROM scheduled_fixtures sf
             WHERE sf.team_id = wt.team_id AND sf.season_id = wt.season_id
               AND sf.match_date_iso >= date('now') AND sf.ingested_at IS NULL
           )
         )
       ORDER BY wt.label`
    )
    .all(clubId)
}

// ── Upcoming fixtures query ──────────────────────────────────────────────────

function getUpcomingFixtures(db, clubId, groups) {
  let groupClause1 = ''
  let groupClause2 = ''
  const groupParams = []

  if (groups && groups.length > 0) {
    const parts = groups.map(() => '(fs.team_id = ? AND fs.season_id = ?)')
    groupClause1 = `AND (${parts.join(' OR ')})`
    const parts2 = groups.map(() => '(sf.team_id = ? AND sf.season_id = ?)')
    groupClause2 = `AND (${parts2.join(' OR ')})`
    groupParams.push(...groups.flatMap((g) => [g.team_id, g.season_id]))
  }

  const sql = `
    SELECT f.fixture_id, f.play_cricket_id,
           f.home_team, f.away_team, f.ground, f.match_date_iso, f.competition, f.max_overs
    FROM fixtures f
    JOIN fixture_seasons fs ON fs.fixture_id = f.fixture_id
    JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
    WHERE wt.club_id = ?
      AND f.match_date_iso >= date('now')
      ${groupClause1}

    UNION

    SELECT CAST(sf.play_cricket_id AS TEXT) AS fixture_id,
           sf.play_cricket_id,
           sf.home_team, sf.away_team, sf.ground, sf.match_date_iso, NULL AS competition,
           20 AS max_overs
    FROM scheduled_fixtures sf
    JOIN watched_teams wt ON wt.team_id = sf.team_id AND wt.season_id = sf.season_id
    WHERE wt.club_id = ?
      AND sf.match_date_iso >= date('now')
      AND sf.ingested_at IS NULL
      ${groupClause2}

    ORDER BY match_date_iso ASC
  `

  return db.prepare(sql).all(clubId, ...groupParams, clubId, ...groupParams)
}

// ── Public ICS feed (no auth — token is the credential) ─────────────────────

// base64url tokens are 32 chars of [A-Za-z0-9_-] (randomBytes(24).toString('base64url'))
const TOKEN_RE = /^[A-Za-z0-9_-]{20,50}$/

function icsHandler(req, res) {
  try {
    const db = getDb()
    const rawToken = req.params.token.replace(/\.ics$/, '')

    if (!TOKEN_RE.test(rawToken)) return res.status(404).json({ error: 'Not found' })

    const row = db
      .prepare(`SELECT clerk_user_id, club_id FROM calendar_tokens WHERE token = ?`)
      .get(rawToken)
    if (!row) return res.status(404).json({ error: 'Not found' })

    // parseGroupPairs validates: only accepts integer team_id:season_id pairs, ignores anything else
    const groups = parseGroupPairs(req.query)
    const fixtures = getUpcomingFixtures(db, row.club_id, groups.length > 0 ? groups : null)

    const club = db.prepare(`SELECT app_name FROM clubs WHERE club_id = ?`).get(row.club_id)
    const appName = club ? club.app_name : 'Cricket'

    let calName
    if (groups.length === 1) {
      const team = db
        .prepare(
          `SELECT label FROM watched_teams WHERE team_id = ? AND season_id = ? AND club_id = ?`
        )
        .get(groups[0].team_id, groups[0].season_id, row.club_id)
      calName = team ? `${appName} ${team.label}` : `${appName} Fixtures`
    } else {
      calName = `${appName} Favourites`
    }

    const ics = buildIcs(fixtures, calName)
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Cache-Control', 'no-cache')
    res.set('Content-Disposition', 'inline; filename="fixtures.ics"')
    res.end(ics, 'utf8')
  } catch (err) {
    console.error('[calendar:ics]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ── Authenticated token management ──────────────────────────────────────────

router.get('/token', (req, res) => {
  try {
    const db = getDb()
    const ctx = getAuthContext(req)
    const { userId, clubId } = ctx

    const tokenRow = db
      .prepare(`SELECT token FROM calendar_tokens WHERE clerk_user_id = ?`)
      .get(userId)
    const activeGroups = clubId ? getActiveGroups(db, clubId) : []

    res.json({ token: tokenRow ? tokenRow.token : null, activeGroups })
  } catch (err) {
    console.error('[calendar:get-token]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/token', (req, res) => {
  try {
    const db = getDb()
    const ctx = getAuthContext(req)
    const { userId, clubId } = ctx

    if (!clubId) return res.status(400).json({ error: 'No club associated with account' })

    const token = crypto.randomBytes(24).toString('base64url')
    db.prepare(
      `INSERT INTO calendar_tokens (token, clerk_user_id, club_id)
       VALUES (?, ?, ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')`
    ).run(token, userId, clubId)

    const activeGroups = getActiveGroups(db, clubId)
    res.json({ token, activeGroups })
  } catch (err) {
    console.error('[calendar:post-token]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/token', (req, res) => {
  try {
    const db = getDb()
    const ctx = getAuthContext(req)
    db.prepare(`DELETE FROM calendar_tokens WHERE clerk_user_id = ?`).run(ctx.userId)
    res.json({ ok: true })
  } catch (err) {
    console.error('[calendar:delete-token]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = { router, icsHandler }

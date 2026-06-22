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

function isoToDate(iso) {
  return iso.replace(/-/g, '')
}

function nextDay(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function dtstamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
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
    const uid = row.play_cricket_id
      ? `PCID_${row.play_cricket_id}@edgexi.uk`
      : `MAN_${row.fixture_id}@edgexi.uk`
    const summary = `${escIcs(row.home_team)} v ${escIcs(row.away_team)}`
    const start = isoToDate(row.match_date_iso)
    const end = nextDay(row.match_date_iso)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTART;VALUE=DATE:${start}`)
    lines.push(`DTEND;VALUE=DATE:${end}`)
    lines.push(foldLine(`SUMMARY:${summary}`))
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
           f.home_team, f.away_team, f.ground, f.match_date_iso, f.competition
    FROM fixtures f
    JOIN fixture_seasons fs ON fs.fixture_id = f.fixture_id
    JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
    WHERE wt.club_id = ?
      AND f.match_date_iso >= date('now')
      ${groupClause1}

    UNION

    SELECT CAST(sf.play_cricket_id AS TEXT) AS fixture_id,
           sf.play_cricket_id,
           sf.home_team, sf.away_team, sf.ground, sf.match_date_iso, NULL AS competition
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

function icsHandler(req, res) {
  try {
    const db = getDb()
    const rawToken = req.params.token.replace(/\.ics$/, '')

    const row = db
      .prepare(`SELECT clerk_user_id, club_id FROM calendar_tokens WHERE token = ?`)
      .get(rawToken)
    if (!row) return res.status(404).json({ error: 'Not found' })

    const groups = parseGroupPairs(req.query)
    const fixtures = getUpcomingFixtures(db, row.club_id, groups.length > 0 ? groups : null)

    const ics = buildIcs(fixtures, 'Cricket Fixtures')
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Cache-Control', 'no-cache')
    res.set('Content-Disposition', 'inline; filename="fixtures.ics"')
    res.send(ics)
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

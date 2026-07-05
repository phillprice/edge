'use strict'

// Duplicated from resultsvault.js's private helpers (rather than importing) to avoid a
// circular require — resultsvault.js requires this module for the pure parsing functions.

// ── Constants (kept together, away from function bodies, so line/complexity tooling
// that scans "until the next function keyword" doesn't misattribute these regex-heavy
// alternation strings to whichever function happens to precede them in the file) ──────

const HTML_NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

// Maps the header <th> title labels (e.g. "Won", "Opposition Conceded") to the
// pointsRules keys we expose. Point values are per-division, never hardcoded.
const POINTS_LABEL_KEYS = {
  won: 'won',
  lost: 'lost',
  tied: 'tied',
  cancelled: 'cancelled',
  abandoned: 'abandoned',
  'opposition conceded': 'oppositionConceded',
  'team conceded': 'teamConceded'
}

const FIXTURE_DAY_PAT = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
const FIXTURE_MONTH_PAT =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

// ── Helpers ─────────────────────────────────────────────────────────────────────────

// Single-pass decode — numeric refs and named entities replaced in one call
// so the output of one substitution is never re-scanned as input.
function decodeHtmlEntities(str) {
  return str.replace(/&(#(\d+)|[a-z]+);/gi, (match, ref, code) => {
    if (code) return String.fromCharCode(parseInt(code, 10))
    return HTML_NAMED_ENTITIES[ref.toLowerCase()] ?? match
  })
}

// "25 May 2026" + "10:00" → "2026-05-25T10:00:00"
function fixtureToIso(rawDate, startTime) {
  const monthMap = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }
  const [day, mon, year] = rawDate.trim().split(/\s+/)
  const mm = String(monthMap[mon.toLowerCase().slice(0, 3)]).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}T${startTime}:00`
}

// Strip tags from a single-cell fragment and collapse whitespace.
function cellText(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Division id ─────────────────────────────────────────────────────────────────────

// Extract the division id from a results page (a plain link to /website/division/{id}).
function extractDivisionId(html) {
  const m = html.match(/website\/division\/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

// ── Standings ───────────────────────────────────────────────────────────────────────

// Parse the "title='Label ( N )'" legend embedded in the standings table header.
function parsePointsRules(html) {
  const rules = {}
  for (const m of html.matchAll(/title=(?:'|")([a-z][a-z\s]*?)\s*\(\s*(\d+)\s*\)(?:'|")/gi)) {
    const key = POINTS_LABEL_KEYS[m[1].trim().toLowerCase()]
    if (key) rules[key] = parseInt(m[2], 10)
  }
  return rules
}

// Column order after pos/team-name is fixed: P, W, L, T, Cancelled, Abandoned,
// WCN (opposition conceded), LCN (team conceded), Pen, H2H, Pts.
function parseStandingsRow(row) {
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]))
  const teamLinkMatch = row.match(/<a href="([^"]*\/Teams\/(\d+))"[^>]*>([^<]+)<\/a>/)
  if (!teamLinkMatch || cells.length < 13) return null
  const [, , teamIdStr, teamNameRaw] = teamLinkMatch
  const nums = cells.slice(2, 13).map((c) => (c === '' ? 0 : parseInt(c, 10) || 0))
  const [played, won, lost, tied, cancelled, abandoned, oppConceded, teamConceded, pen, h2h, pts] =
    nums
  return {
    teamId: parseInt(teamIdStr, 10),
    teamName: decodeHtmlEntities(teamNameRaw.trim()),
    played,
    won,
    lost,
    tied,
    cancelled,
    abandoned,
    oppConceded,
    teamConceded,
    pen,
    h2h,
    pts
  }
}

// Parse every "<tr id='legN' class='league_row ...'>...</tr>" standings row. The viewing
// club's own row carries an extra "highlighted-row" class on their own domain (e.g.
// class='league_row highlighted-row') — match on the league_row prefix, not an exact value.
function parseStandingsRows(html) {
  const teams = []
  for (const rowMatch of html.matchAll(
    /<tr id=\s*'leg\d+' class='league_row[^']*'>([\s\S]*?)<\/tr>/g
  )) {
    const team = parseStandingsRow(rowMatch[1])
    if (team) teams.push(team)
  }
  return teams
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────

// Tokenize the "NEXT 10 FIXTURES" tab HTML into position-ordered date/time/location/id/team
// tokens. Each day has one date-heading div followed by one or more fixture blocks (each
// rendered twice, mobile + desktop, with identical id/time/location).
function tokenizeDivisionFixturesHtml(html) {
  const tokens = []
  const dateRe = new RegExp(
    'title2(?:\'|")[^>]*>\\s*(?:' +
      FIXTURE_DAY_PAT +
      ')\\s+(\\d{1,2}\\s+(?:' +
      FIXTURE_MONTH_PAT +
      ')\\s+\\d{4})',
    'gi'
  )
  const timeRe = /class='time[^']*'>(\d{2}:\d{2})/g
  const locRe = /class='location'>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g
  const idRe = /href=(?:'|")\/match_details\?id=(\d+)(?:'|")/g
  const teamRe = /class='txt1'>([\s\S]*?)<\/p>/g

  let m
  while ((m = dateRe.exec(html)) !== null) tokens.push({ type: 'date', val: m[1], pos: m.index })
  while ((m = timeRe.exec(html)) !== null) tokens.push({ type: 'time', val: m[1], pos: m.index })
  while ((m = locRe.exec(html)) !== null)
    tokens.push({ type: 'location', val: m[1].trim(), pos: m.index })
  while ((m = idRe.exec(html)) !== null) tokens.push({ type: 'id', val: m[1], pos: m.index })
  while ((m = teamRe.exec(html)) !== null)
    tokens.push({ type: 'team', val: cellText(m[1]), pos: m.index })
  tokens.sort((a, b) => a.pos - b.pos)
  return tokens
}

// Collects the next two 'team' tokens following an 'id' token (stopping at the next id).
function collectTeamNames(tokens, afterIndex) {
  const teams = []
  for (let j = afterIndex + 1; j < tokens.length && teams.length < 2; j++) {
    if (tokens[j].type === 'id') break
    if (tokens[j].type === 'team') teams.push(tokens[j].val)
  }
  return teams
}

// Builds one fixture from an 'id' token, the surrounding token list, and the current
// date/time/ground context accumulated by buildFixturesFromTokens.
function buildFixtureFromIdToken(idToken, tokens, idx, dateCtx) {
  const teams = collectTeamNames(tokens, idx)
  return {
    playCricketId: parseInt(idToken.val, 10),
    matchDateIso: fixtureToIso(dateCtx.date.trim(), dateCtx.time),
    ground: dateCtx.location ? decodeHtmlEntities(dateCtx.location) : null,
    homeTeam: teams[0] ? decodeHtmlEntities(teams[0]) : null,
    awayTeam: teams[1] ? decodeHtmlEntities(teams[1]) : null
  }
}

// Walk position-ordered tokens and reconstruct one fixture per distinct play-cricket id,
// deduping the mobile/desktop duplicate and attaching the most recently seen date/time/ground.
function buildFixturesFromTokens(tokens) {
  const results = []
  const seen = new Set()
  const dateCtx = { date: null, time: '12:00', location: null }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'date') {
      dateCtx.date = t.val
      dateCtx.time = '12:00'
      dateCtx.location = null
    } else if (t.type === 'time') {
      dateCtx.time = t.val
    } else if (t.type === 'location') {
      dateCtx.location = t.val
    } else if (t.type === 'id' && dateCtx.date && !seen.has(t.val)) {
      seen.add(t.val)
      results.push(buildFixtureFromIdToken(t, tokens, i, dateCtx))
    }
  }
  return results
}

function parseDivisionFixtures(html) {
  return buildFixturesFromTokens(tokenizeDivisionFixturesHtml(html))
}

module.exports = {
  extractDivisionId,
  parsePointsRules,
  parseStandingsRows,
  parseDivisionFixtures
}

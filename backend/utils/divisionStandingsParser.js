'use strict'

const { decodeHtmlEntities, cellText } = require('./divisionTextHelpers')

// Extract the division id from a results page (a plain link to /website/division/{id}).
function extractDivisionId(html) {
  const m = html.match(/website\/division\/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

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

module.exports = { extractDivisionId, parsePointsRules, parseStandingsRows }

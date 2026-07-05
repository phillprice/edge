'use strict'

const { decodeHtmlEntities, fixtureToIso, cellText } = require('./divisionTextHelpers')

const FIXTURE_DAY_PAT = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
const FIXTURE_MONTH_PAT =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

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

module.exports = { parseDivisionFixtures }

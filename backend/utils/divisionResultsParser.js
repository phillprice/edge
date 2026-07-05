'use strict'

const { decodeHtmlEntities, fixtureToIso, cellText } = require('./divisionTextHelpers')

const RESULTS_DAY_PAT = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
const RESULTS_MONTH_PAT =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

// Tokenize the "LAST 10 RESULTS" tab HTML into position-ordered date/id/points/team tokens.
// Each match card shows a mobile layout and a desktop "Vs" layout with identical values —
// points-l/points-r and the results id each appear twice per match, team names (txt1) once each.
function tokenizeDivisionResultsHtml(html) {
  const tokens = []
  const dateRe = new RegExp(
    'title2">\\s*(?:' +
      RESULTS_DAY_PAT +
      ')\\s+(\\d{1,2}\\s+(?:' +
      RESULTS_MONTH_PAT +
      ')\\s+\\d{4})',
    'gi'
  )
  const idRe = /\/website\/results\/(\d+)/g
  const pointsLeftRe = /points-l[^']*'>\s*(\d+)/g
  const pointsRightRe = /points-r[^']*'>\s*(\d+)/g
  const teamRe = /class='txt1'>([\s\S]*?)<\/p>/g

  let m
  while ((m = dateRe.exec(html)) !== null) tokens.push({ type: 'date', val: m[1], pos: m.index })
  while ((m = idRe.exec(html)) !== null) tokens.push({ type: 'id', val: m[1], pos: m.index })
  while ((m = pointsLeftRe.exec(html)) !== null)
    tokens.push({ type: 'pointsLeft', val: m[1], pos: m.index })
  while ((m = pointsRightRe.exec(html)) !== null)
    tokens.push({ type: 'pointsRight', val: m[1], pos: m.index })
  while ((m = teamRe.exec(html)) !== null)
    tokens.push({ type: 'team', val: cellText(m[1]), pos: m.index })
  tokens.sort((a, b) => a.pos - b.pos)
  return tokens
}

// Collects the first token of a given type appearing after `afterIndex` and before the next
// 'id' token for a *different* match — the results id itself appears 3 times per match
// (onclick wrapper, mobile link, desktop link) with the same value, so only a differing id
// value marks the true boundary. points-l/points-r/team tokens share the same value within
// one match's segment (mobile+desktop duplicates), so "first occurrence" is sufficient.
function firstOfTypeInSegment(tokens, afterIndex, matchId, type, maxCount = 1) {
  const found = []
  for (let j = afterIndex + 1; j < tokens.length && found.length < maxCount; j++) {
    if (tokens[j].type === 'id' && tokens[j].val !== matchId) break
    if (tokens[j].type === type) found.push(tokens[j].val)
  }
  return found
}

// Builds one result from an 'id' token, the surrounding token list, and the current date.
function buildResultFromIdToken(idToken, tokens, idx, curDate) {
  const teams = firstOfTypeInSegment(tokens, idx, idToken.val, 'team', 2)
  const [pointsLeft] = firstOfTypeInSegment(tokens, idx, idToken.val, 'pointsLeft')
  const [pointsRight] = firstOfTypeInSegment(tokens, idx, idToken.val, 'pointsRight')
  if (teams.length < 2 || pointsLeft == null || pointsRight == null) return null
  return {
    playCricketId: parseInt(idToken.val, 10),
    matchDateIso: curDate ? fixtureToIso(curDate.trim(), '12:00') : null,
    homeTeam: decodeHtmlEntities(teams[0]),
    awayTeam: decodeHtmlEntities(teams[1]),
    homePts: parseInt(pointsLeft, 10),
    awayPts: parseInt(pointsRight, 10)
  }
}

// Walk position-ordered tokens and reconstruct one result per distinct play-cricket id,
// deduping the mobile/desktop duplicate the same way divisionFixturesParser does.
function buildResultsFromTokens(tokens) {
  const results = []
  const seen = new Set()
  let curDate = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'date') {
      curDate = t.val
    } else if (t.type === 'id' && !seen.has(t.val)) {
      seen.add(t.val)
      const result = buildResultFromIdToken(t, tokens, i, curDate)
      if (result) results.push(result)
    }
  }
  return results
}

function parseDivisionResults(html) {
  return buildResultsFromTokens(tokenizeDivisionResultsHtml(html))
}

module.exports = { parseDivisionResults }

'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const {
  extractMatchId,
  fetchCricHeroesMatch,
  mapCricHeroesToScorecard
} = require('../../utils/twenty20Import')
const { resolvePlayer, sameSide } = require('./pdfScorecard')

// A resolved match is only kept if it's on the same side (WHCC vs opposition) as this row's
// own team — otherwise a name shared between a real WHCC player and an unrelated opposition
// player in this friendly would silently merge their stats (the resolved id is discarded
// here, same as sameSide() guards the equivalent commit-time lookup in pdfScorecard.js's
// findOrCreate()).
function isSameSideMatch(db, playerId, team) {
  if (!playerId) return false
  const candidate = db.prepare(`SELECT team FROM players WHERE player_id = ?`).get(playerId)
  return sameSide(candidate?.team, team)
}

// Attach only the fixed {player_id, matched, fuzzy} shape resolvePlayer returns — explicit
// fields rather than Object.assign, so nothing beyond that known shape can ever be merged in.
function attachResolution(db, allNames, row, team) {
  const resolved = resolvePlayer(db, row.name, allNames)
  const keep = isSameSideMatch(db, resolved.player_id, team)
  row.player_id = keep ? resolved.player_id : null
  row.matched = keep ? resolved.matched : false
  row.fuzzy = keep ? resolved.fuzzy : false
}

function resolveScorecardPlayers(db, scorecard) {
  const allNames = [
    ...new Set(
      scorecard.innings.flatMap((inn) => [
        ...inn.batting.map((b) => b.name),
        ...inn.bowling.map((b) => b.name)
      ])
    )
  ]
  for (const inn of scorecard.innings) {
    for (const b of inn.batting) attachResolution(db, allNames, b, inn.batting_team)
    for (const b of inn.bowling) attachResolution(db, allNames, b, inn.bowling_team)
  }
  for (const c of scorecard.captains) {
    attachResolution(db, allNames, c, scorecard.innings[c.innings_order - 1]?.batting_team)
  }
  for (const k of scorecard.keepers) {
    attachResolution(db, allNames, k, scorecard.innings[k.innings_order - 1]?.bowling_team)
  }
}

// POST /api/admin/import/twenty20-parse  (body: {url}, returns JSON preview)
// twenty20cricketcompany.com is a CricHeroes white-label site — pull the same match via
// CricHeroes' API and map it into the exact shape /import/scorecard-parse returns, so the
// existing preview/commit UI and commit endpoint (both in ./pdfScorecard.js) work unmodified.
router.post('/import/twenty20-parse', async (req, res, next) => {
  const matchId = extractMatchId(req.body?.url)
  if (!matchId) return res.status(400).json({ error: 'Could not find a match id in that URL' })
  try {
    const { scorecard: chScorecard, commentaryByInning } = await fetchCricHeroesMatch(matchId)
    const scorecard = mapCricHeroesToScorecard({ scorecard: chScorecard, commentaryByInning })
    resolveScorecardPlayers(getDb(), scorecard)
    res.json(scorecard)
  } catch (err) {
    next(err)
  }
})

module.exports = router

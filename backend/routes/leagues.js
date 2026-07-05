'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')
const { getAuthContext } = require('../middleware/auth')
const leagueSimService = require('../services/leagueSimService')

// Resolves the club's play-cricket domain — same fallback as ingestMatch.js/scheduler.js.
function getClubDomain(db, clubId) {
  if (clubId == null) return 'whcc.play-cricket.com'
  const club = db.prepare('SELECT play_cricket_domain FROM clubs WHERE club_id = ?').get(clubId)
  return club?.play_cricket_domain || 'whcc.play-cricket.com'
}

// GET /api/leagues/:fixtureId/prediction
router.get('/:fixtureId/prediction', async (req, res) => {
  const db = getDb()
  const { clubId } = getAuthContext(req)
  const domain = getClubDomain(db, clubId)

  try {
    const result = await leagueSimService.predictLeague(db, req.params.fixtureId, { domain })
    if (!result) {
      return res
        .status(404)
        .json({ error: 'Fixture is not a league fixture with a resolvable division' })
    }
    res.json(result)
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch division data', detail: e.message })
  }
})

module.exports = router
module.exports._test = { getClubDomain }

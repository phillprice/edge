'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../db/schema')
const { getAuthContext } = require('../middleware/auth')

const WHCC_DEFAULT = {
  name: 'Edge XI',
  primaryColour: '#690028',
  secondaryColour: '#a00040'
}

// GET /api/club/config
// Returns branding config for the requesting user's club.
// No auth guard — safe to call when signed in; falls back to WHCC defaults if no club.
router.get('/config', (req, res) => {
  const clubId = getAuthContext(req).clubId
  if (clubId == null) return res.json(WHCC_DEFAULT)

  const db = getDb()
  const club = db
    .prepare(
      `SELECT app_name AS name, primary_colour AS primaryColour, secondary_colour AS secondaryColour
       FROM clubs WHERE club_id = ?`
    )
    .get(clubId)

  res.json(club ?? WHCC_DEFAULT)
})

module.exports = router

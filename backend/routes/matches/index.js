'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { withEtag } = require('../../middleware/cacheHeaders')
const { parseHowOut, getPartnerships, parseCatcher } = require('../../utils/scorecard')
const { buildMatchFlow, getFormatConfig } = require('../../utils/matchFlow')
const { isWhccTeam } = require('../../utils/db')

const matchService = require('../../services/matchService')
const matchEditService = require('../../services/matchEditService')

// GET /api/matches
router.get('/', withEtag('matches-list'), (req, res) => {
  const db = getDb()
  const MAX_LIMIT = 100
  const DEFAULT_LIMIT = 50
  let limit = parseInt(req.query.limit, 10)
  let offset = parseInt(req.query.offset, 10)
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  if (limit > MAX_LIMIT) limit = MAX_LIMIT
  res.json(matchService.getMatchList(db, req, limit, offset))
})

// GET /api/matches/season
router.get('/season', withEtag('matches-season'), (req, res) => {
  const db = getDb()
  res.json(matchService.getSeasonStats(db, req))
})

// GET /api/matches/:fixtureId
router.get('/:fixtureId', (req, res) => {
  const db = getDb()
  const result = matchService.getMatchDetail(db, req.params.fixtureId, req)
  if (!result) return res.status(404).json({ error: 'Match not found' })
  res.json(result)
})

// GET /api/matches/:fixtureId/roles
router.get('/:fixtureId/roles', (req, res) => {
  const db = getDb()
  res.json(matchService.getMatchRoles(db, req.params.fixtureId))
})

// PUT /api/matches/:fixtureId/captain
router.put('/:fixtureId/captain', matchEditService.handleCaptainPut)

// POST /api/matches/:fixtureId/wk
router.post('/:fixtureId/wk', matchEditService.handleWkPost)

// PATCH /api/matches/:fixtureId/wk/:wkId
router.patch('/:fixtureId/wk/:wkId', matchEditService.handleWkPatch)

// DELETE /api/matches/:fixtureId/wk/:wkId
router.delete('/:fixtureId/wk/:wkId', matchEditService.handleWkDelete)

// POST /api/matches/:fixtureId/wk-error
router.post('/:fixtureId/wk-error', matchEditService.handleWkErrorPost)

// DELETE /api/matches/:fixtureId/wk-error/:errorId
router.delete('/:fixtureId/wk-error/:errorId', matchEditService.handleWkErrorDelete)

// PATCH /api/matches/:fixtureId/delivery/:deliveryId
router.patch('/:fixtureId/delivery/:deliveryId', matchEditService.handleDeliveryPatch)

// PATCH /api/matches/:fixtureId/pair-block
router.patch('/:fixtureId/pair-block', matchEditService.handlePairBlockPatch)

// PATCH /api/matches/:fixtureId/result
router.patch('/:fixtureId/result', matchEditService.handleResultPatch)

// POST /api/matches/:fixtureId/innings
router.post('/:fixtureId/innings', matchEditService.handleInningsPost)

// POST /api/matches/:fixtureId/innings/:inningsOrder/delivery
router.post('/:fixtureId/innings/:inningsOrder/delivery', matchEditService.handleDeliveryPost)

// DELETE /api/matches/:fixtureId/delivery/:deliveryId
router.delete('/:fixtureId/delivery/:deliveryId', matchEditService.handleDeliveryDelete)

module.exports = router
module.exports._test = {
  parseHowOut,
  getPartnerships,
  buildMatchFlow,
  isWhccTeam,
  getFormatConfig,
  parseCatcher
}

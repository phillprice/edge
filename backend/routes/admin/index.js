'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { getAuthContext } = require('../../middleware/auth')
const schedulerRouter = require('./scheduler')
const { getAdminMeta } = require('./shared')
const dbExportImportRouter = require('./dbExportImport')
const playerMergeRouter = require('./playerMerge')
const playCricketAssociateRouter = require('./playCricketAssociate')
const manualMatchRouter = require('./manualMatch')
const pdfScorecardRouter = require('./pdfScorecard')
const clerkUsersRouter = require('./clerkUsers')
const jerseyPatchRouter = require('./jerseyPatch')

// GET /api/admin/ingests
router.get('/ingests', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.*, f.home_team, f.away_team, f.match_date
      FROM ingests i
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      ORDER BY i.ingested_at DESC
      LIMIT 100`
    )
    .all()
  res.json(rows)
})

// GET /api/admin/teams
router.get('/teams', (req, res) => {
  const ctx = getAuthContext(req)
  const db = getDb()
  const clubWhere = ctx.isSuperAdmin ? '1=1' : 'club_id = ?'
  const params = ctx.isSuperAdmin ? [] : [ctx.clubId, ctx.clubId]
  const rows = db
    .prepare(
      `SELECT
        wt.id,
        t.team_id,
        t.season_id,
        COALESCE(wt.label, 'Team ' || t.team_id)                              AS label,
        COALESCE(wt.year, substr(MIN(sf.match_date_iso), 1, 4))               AS year
      FROM (
        SELECT team_id, season_id FROM scheduled_fixtures WHERE ${clubWhere}
        UNION
        SELECT team_id, season_id FROM watched_teams WHERE ${clubWhere}
      ) t
      LEFT JOIN watched_teams      wt ON wt.team_id = t.team_id AND wt.season_id = t.season_id
      LEFT JOIN scheduled_fixtures sf ON sf.team_id = t.team_id AND sf.season_id = t.season_id
      WHERE t.team_id IS NOT NULL
      GROUP BY t.team_id, t.season_id
      ORDER BY year DESC, label ASC`
    )
    .all(...params)
  res.json(rows)
})

// GET /api/admin/my-groups
router.get('/my-groups', (req, res) => {
  const db = getDb()
  const { isSuperAdmin, groups } = getAdminMeta(req)

  let rows
  if (isSuperAdmin) {
    rows = db
      .prepare(
        `SELECT team_id, season_id, label, year
        FROM watched_teams ORDER BY year DESC, label ASC`
      )
      .all()
  } else {
    if (!groups.length) return res.json([])
    const clauses = groups.map(() => '(wt.team_id = ? AND wt.season_id = ?)').join(' OR ')
    const params = groups.flatMap((g) => [Number(g.team_id), Number(g.season_id)])
    rows = db
      .prepare(
        `SELECT wt.team_id, wt.season_id, wt.label, wt.year
        FROM watched_teams wt
        WHERE ${clauses}
        ORDER BY wt.year DESC, wt.label ASC`
      )
      .all(...params)
  }

  res.json(
    rows.map((r) => ({
      team_id: r.team_id,
      season_id: r.season_id,
      label: r.label,
      year: r.year ?? null
    }))
  )
})

router.use('/', dbExportImportRouter)
router.use('/', playerMergeRouter)
router.use('/', playCricketAssociateRouter)
router.use('/', manualMatchRouter)
router.use('/', pdfScorecardRouter)
router.use('/', clerkUsersRouter)
router.use('/', jerseyPatchRouter)
router.use('/scheduler', schedulerRouter)

module.exports = router
// Re-exported for fuzzyName.test.js / insertDeliveries.test.js, which test these
// pdfScorecard-internal helpers directly via require('./index').
module.exports._normaliseName = pdfScorecardRouter._normaliseName
module.exports._fuzzyNameMatch = pdfScorecardRouter._fuzzyNameMatch
module.exports._bowlerIdFromMap = pdfScorecardRouter._bowlerIdFromMap
module.exports._resolvePlayer = pdfScorecardRouter._resolvePlayer
module.exports._expandFromScorecard = pdfScorecardRouter._expandFromScorecard
module.exports._insertDeliveries = pdfScorecardRouter._insertDeliveries

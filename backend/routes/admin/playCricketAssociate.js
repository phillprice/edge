'use strict'

const express = require('express')
const router = express.Router()
const { clerkClient } = require('@clerk/express')
const { getDb } = require('../../db/schema')
const { ingestMatch } = require('../../db/ingestMatch')
const { ourFixtureWhere } = require('../../utils/db')
const { getAuthContext } = require('../../middleware/auth')
const { validateBody, z } = require('../../utils/validate')

// GET /api/admin/matches-missing-team
router.get('/matches-missing-team', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso
      FROM fixtures f
      WHERE f.fixture_id NOT LIKE 'manual-%'
        AND ${ourFixtureWhere()}
        AND NOT EXISTS (SELECT 1 FROM fixture_seasons fs WHERE fs.fixture_id = f.fixture_id)
      ORDER BY f.match_date_iso DESC
      LIMIT 100`
    )
    .all()
  res.json(rows)
})

// POST /api/admin/fetch-match
router.post('/fetch-match', async (req, res, next) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url required' })

  const m = url.match(/\/results\/(\d+)/)
  if (!m) return res.status(400).json({ error: 'Could not find fixture ID in URL' })
  const playCricketId = m[1]

  try {
    let userName = null
    if (req.auth?.userId && process.env.CLERK_SECRET_KEY) {
      try {
        const user = await clerkClient.users.getUser(req.auth.userId)
        userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      } catch (_) {}
    }
    const { fixtureId, rvMatchId, results, matchMeta, maxOvers, associated } = await ingestMatch(
      playCricketId,
      { userId: req.auth?.userId ?? null, userName, clubId: getAuthContext(req).clubId ?? null }
    )
    res.json({
      ok: true,
      playCricketId,
      fixtureId,
      rvMatchId,
      results,
      maxOvers: maxOvers ?? null,
      associated: associated ?? null,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    next(err)
  }
})

const associateMatchSchema = z.object({
  fixture_id: z.union([z.string(), z.number()]).refine((v) => !!v, 'fixture_id is required'),
  team_id: z.coerce.number().refine((v) => !!v, 'team_id is required'),
  season_id: z.coerce.number().refine((v) => !!v, 'season_id is required')
})

// POST /api/admin/associate-match
router.post('/associate-match', validateBody(associateMatchSchema), (req, res) => {
  const { fixture_id, team_id, season_id } = req.body

  const db = getDb()
  const fixture = db
    .prepare(
      'SELECT play_cricket_id, home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?'
    )
    .get(String(fixture_id))
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  if (!fixture.play_cricket_id)
    return res.status(400).json({ error: 'Fixture has no play_cricket_id — cannot associate' })

  db.prepare(
    `INSERT OR REPLACE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`
  ).run(
    parseInt(fixture.play_cricket_id),
    parseInt(team_id),
    parseInt(season_id),
    fixture.match_date_iso,
    fixture.match_date_iso,
    new Date().toISOString(),
    fixture.home_team,
    fixture.away_team,
    new Date().toISOString()
  )
  res.json({ ok: true })
})

module.exports = router

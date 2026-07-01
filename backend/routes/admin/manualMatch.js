'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { ourFixtureWhere } = require('../../utils/db')
const { getAuthContext } = require('../../middleware/auth')
const { canManageUsers, VALID_TAGS, syncFixtureTags } = require('./shared')
const { invalidateFixtureCaches } = require('../../utils/cacheInvalidation')

// GET /api/admin/matches-missing-roles
router.get('/matches-missing-roles', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date,
        CASE WHEN (
          EXISTS(SELECT 1 FROM player_flags pf WHERE pf.fixture_id = f.fixture_id AND pf.is_captain = 1)
          OR EXISTS(SELECT 1 FROM match_captains mc WHERE mc.fixture_id = f.fixture_id)
        ) THEN 1 ELSE 0 END AS has_captain,
        CASE WHEN (
          EXISTS(SELECT 1 FROM wk_assignments wa WHERE wa.fixture_id = f.fixture_id)
          OR EXISTS(SELECT 1 FROM player_flags pf WHERE pf.fixture_id = f.fixture_id AND pf.is_wk = 1)
        ) THEN 1 ELSE 0 END AS has_wk
      FROM fixtures f
      JOIN innings i ON i.fixture_id = f.fixture_id
      WHERE f.fixture_id NOT LIKE 'manual-%'
        AND ${ourFixtureWhere()}
      GROUP BY f.fixture_id
      HAVING has_captain = 0 OR has_wk = 0
      ORDER BY f.match_date DESC`
    )
    .all()
  res.json(rows)
})

// GET /api/admin/manual-matches
router.get('/manual-matches', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso,
        f.competition, f.result, f.format, f.match_type,
        (SELECT GROUP_CONCAT(tag) FROM fixture_tags WHERE fixture_id = f.fixture_id) AS tags_csv,
        (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0) AS bat_rows,
        (SELECT COUNT(*) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) AS bowl_rows
      FROM fixtures f
      WHERE f.fixture_id LIKE 'manual-%'
      ORDER BY f.match_date_iso DESC
      LIMIT 200`
    )
    .all()
  res.json(
    rows.map((r) => ({
      ...r,
      tags: r.tags_csv ? r.tags_csv.split(',') : [r.match_type || 'league'],
      tags_csv: undefined
    }))
  )
})

// GET /api/admin/match/:id
router.get('/match/:id', (req, res) => {
  const db = getDb()
  const fixtureId = req.params.id

  const fixture = db
    .prepare(
      `SELECT fixture_id, play_cricket_id, home_team, away_team, match_date_iso,
        format, match_type, competition, ground, result, starting_score, max_overs,
        (SELECT GROUP_CONCAT(tag) FROM fixture_tags WHERE fixture_id = ?) AS tags_csv
      FROM fixtures WHERE fixture_id = ?`
    )
    .get(fixtureId, fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  fixture.tags = fixture.tags_csv ? fixture.tags_csv.split(',') : [fixture.match_type || 'league']
  delete fixture.tags_csv

  const scheduled = fixture.play_cricket_id
    ? db
        .prepare(
          `SELECT sf.play_cricket_id, sf.team_id, sf.season_id, sf.status,
            sf.cron_job_id, sf.attempt_count, sf.ingest_after, sf.ingested_at,
            sf.error_msg, sf.discovered_at,
            wt.label AS team_label, wt.year AS season_year
          FROM scheduled_fixtures sf
          LEFT JOIN watched_teams wt ON wt.team_id = sf.team_id AND wt.season_id = sf.season_id
          WHERE sf.play_cricket_id = ?`
        )
        .all(parseInt(fixture.play_cricket_id))
    : []

  const ingests = db
    .prepare(
      `SELECT id, ingested_at, clerk_user_id, clerk_user_name, source_files, row_counts
      FROM ingests WHERE fixture_id = ? ORDER BY ingested_at DESC`
    )
    .all(fixtureId)

  const associations = db
    .prepare(
      `SELECT fs.team_id, fs.season_id, wt.label AS team_label, wt.year AS season_year
      FROM fixture_seasons fs
      LEFT JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
      WHERE fs.fixture_id = ?`
    )
    .all(fixtureId)

  res.json({ fixture, scheduled, ingests, associations })
})

// DELETE /api/admin/match/:id
router.delete('/match/:id', (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  if (!fixtureId) return res.status(400).json({ error: 'fixture_id required' })
  try {
    db.transaction(() => {
      invalidateFixtureCaches(db, fixtureId)
      db.prepare(`DELETE FROM wk_errors          WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM wk_assignments     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM match_captains     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM player_flags       WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM dismissals         WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_batting     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_bowling     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_extras      WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_fielding    WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM ingests            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(
        `DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id = ?)`
      ).run(fixtureId)
      db.prepare(`DELETE FROM fixture_seasons   WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM innings            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM fixtures           WHERE fixture_id = ?`).run(fixtureId)
    })()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/match/:id/recalculate-score
// Clears the scraped home_score/away_score (which may be league points, not runs)
// and recomputes from delivery totals via backfillFixtureSummary.
router.post('/match/:id/recalculate-score', (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  if (!fixtureId) return res.status(400).json({ error: 'fixture_id required' })
  try {
    db.prepare(
      `UPDATE fixtures SET home_score = NULL, away_score = NULL,
       home_wickets = NULL, away_wickets = NULL, home_overs = NULL, away_overs = NULL
       WHERE fixture_id = ?`
    ).run(fixtureId)
    const { backfillFixtureSummary } = require('../../utils/matchSummary')
    const { clubId } = getAuthContext(req)
    const updated = backfillFixtureSummary(db, fixtureId, clubId ?? null)
    if (!updated)
      return res.status(422).json({
        error: 'Could not compute score from deliveries — need at least 2 innings with data'
      })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/admin/match/:id/tags  (also accepts legacy match_type for backwards compat)
router.patch('/match/:id/type', (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  // Accept either tags[] (new) or match_type string (legacy)
  let tags = req.body?.tags
  if (!tags) {
    const normalised = (req.body?.match_type || '').toLowerCase()
    if (!VALID_TAGS.includes(normalised))
      return res.status(400).json({ error: `match_type must be one of: ${VALID_TAGS.join(', ')}` })
    tags = [normalised]
  }
  if (!Array.isArray(tags) || tags.length > VALID_TAGS.length)
    return res
      .status(400)
      .json({ error: `tags must be an array of up to ${VALID_TAGS.length} items` })
  const invalid = tags.filter((t) => !VALID_TAGS.includes(t))
  if (invalid.length) return res.status(400).json({ error: `Invalid tags: ${invalid.join(', ')}` })
  try {
    const fixture = db
      .prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?')
      .get(fixtureId)
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
    syncFixtureTags(db, fixtureId, tags)
    res.json({ ok: true, tags })
  } catch (err) {
    next(err)
  }
})

module.exports = router

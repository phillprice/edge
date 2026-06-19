'use strict'

const express = require('express')
const router = express.Router()
const { getDb } = require('../../db/schema')
const { resolveTeamSeasons, fetchClubTeams } = require('../../utils/resultsvault')
const { getAuthContext } = require('../../middleware/auth')

function getScheduler() {
  return require('../../scheduler')
}

function canManageUsers(req) {
  const ctx = getAuthContext(req)
  return ctx.isSuperAdmin || ctx.isClubAdmin
}

// GET /api/admin/scheduler/status
router.get('/status', (req, res) => {
  const db = getDb()
  const teams = db.prepare('SELECT * FROM watched_teams ORDER BY added_at DESC').all()
  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM scheduled_fixtures GROUP BY status`)
    .all()
    .reduce((acc, r) => {
      acc[r.status] = r.n
      return acc
    }, {})
  const byTeam = db
    .prepare(
      `SELECT team_id, season_id, status, COUNT(*) AS n,
      CASE WHEN status = 'done' THEN MAX(match_date_iso) ELSE NULL END AS last_match_date
    FROM scheduled_fixtures GROUP BY team_id, season_id, status`
    )
    .all()
  const recent = db
    .prepare(
      `SELECT * FROM scheduled_fixtures WHERE status = 'done' ORDER BY match_date_iso DESC LIMIT 20`
    )
    .all()
  res.json({
    teams,
    queue: { pending: counts.pending || 0, done: counts.done || 0, failed: counts.failed || 0 },
    byTeam,
    recent
  })
})

// GET /api/admin/scheduler/browse-teams
// Returns all teams in the WHCC play-cricket dropdown, each annotated with watched: bool.
router.get('/browse-teams', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  try {
    const db = getDb()
    const watchedIds = new Set(
      db
        .prepare('SELECT DISTINCT team_id FROM watched_teams')
        .all()
        .map((r) => r.team_id)
    )
    const teams = await fetchClubTeams()
    res.json(teams.map((t) => ({ ...t, watched: watchedIds.has(t.team_id) })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/scheduler/teams
router.post('/teams', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const { url, team_id: rawTeamId } = req.body || {}

  let teamId
  if (rawTeamId) {
    teamId = String(rawTeamId)
  } else if (url) {
    try {
      teamId = new URL(url).searchParams.get('team_id')
    } catch (_) {
      return res.status(400).json({ error: 'Invalid URL' })
    }
  }
  if (!teamId) return res.status(400).json({ error: 'team_id or url required' })

  try {
    const seasons = await resolveTeamSeasons(teamId)
    if (!seasons.length) {
      return res.status(404).json({ error: 'No fixtures found for this team in 2025 or later' })
    }
    const db = getDb()
    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(team_id, season_id) DO UPDATE SET label = excluded.label, year = excluded.year
    `)
    for (const s of seasons) {
      upsert.run(parseInt(teamId, 10), parseInt(s.season_id, 10), s.label, s.year, now)
    }
    const rows = db
      .prepare('SELECT * FROM watched_teams WHERE team_id = ? ORDER BY year')
      .all(parseInt(teamId, 10))

    getScheduler().queueTeamSeasons(teamId, seasons)
    getScheduler()
      .processPendingIngests()
      .catch((e) => console.error('[scheduler] post-add ingest error:', e))

    res.json({
      ok: true,
      teams: rows,
      resolved: seasons.map((s) => ({
        season_id: parseInt(s.season_id, 10),
        year: s.year,
        label: s.label,
        fixtures: s.fixtures.length
      }))
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/scheduler/teams/:id
router.delete('/teams/:id', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  db.prepare('DELETE FROM watched_teams WHERE id = ?').run(parseInt(req.params.id, 10))
  res.json({ ok: true })
})

// POST /api/admin/scheduler/discover
router.post('/discover', async (req, res) => {
  try {
    const added = await getScheduler().discoverFixtures()
    res.json({ ok: true, added: added || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/scheduler/rescan
router.post('/rescan', async (req, res) => {
  try {
    const added = await getScheduler().rescanAllSeasons()
    getScheduler()
      .processPendingIngests()
      .catch((e) => console.error('[scheduler] post-rescan ingest error:', e))
    res.json({ ok: true, added: added || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/scheduler/cron-jobs
// Returns the single every-3-hours ingest job status plus upcoming pending fixtures.
router.get('/cron-jobs', async (req, res) => {
  const db = getDb()
  const { listJobs } = require('../../utils/cronJobOrg')
  const { INGEST_CRON_KEY } = getScheduler()

  const liveJobsRes = await listJobs().catch(() => null)
  const liveById = {}
  if (liveJobsRes) {
    for (const j of liveJobsRes.jobs ?? []) liveById[j.jobId] = j
  }

  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(INGEST_CRON_KEY)
  const jobId = row ? parseInt(row.value, 10) : null
  const live = jobId ? liveById[jobId] : null
  const fixedJobs = [
    {
      key: INGEST_CRON_KEY,
      label: 'Every 3 hours (London)',
      job_id: jobId,
      exists: !!live,
      next_execution: live?.nextExecution
        ? new Date(live.nextExecution * 1000).toISOString()
        : null,
      enabled: live?.enabled ?? null
    }
  ]

  const upcomingFixtures = db
    .prepare(
      `SELECT play_cricket_id, home_team, away_team, match_date_iso, ingest_after, attempt_count
      FROM scheduled_fixtures
      WHERE status = 'pending'
        AND ingest_after > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY ingest_after`
    )
    .all()

  res.json({ fixedJobs, upcomingFixtures })
})

// GET /api/admin/scheduler/past-pending
router.get('/past-pending', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT sf.play_cricket_id, sf.home_team, sf.away_team, sf.match_date_iso, sf.ingest_after,
        sf.attempt_count, sf.error_msg
      FROM scheduled_fixtures sf
      WHERE sf.status = 'pending'
        AND sf.ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND NOT EXISTS (SELECT 1 FROM fixtures f WHERE f.play_cricket_id = CAST(sf.play_cricket_id AS TEXT))
      ORDER BY sf.match_date_iso ASC`
    )
    .all()
  res.json(rows)
})

// POST /api/admin/scheduler/process-now
router.post('/process-now', (req, res) => {
  res.json({ ok: true, message: 'Processing pending ingests in background…' })
  getScheduler()
    .processPendingIngests()
    .catch((e) => console.error('[admin] process-now error:', e.message))
})

// POST /api/admin/scheduler/sync-cron-jobs
// Wipes all cron-job.org jobs and recreates the 5 fixed daily ingest slots.
router.post('/sync-cron-jobs', async (req, res) => {
  try {
    const { deleted, created } = await getScheduler().resetFixedIngestJobs()
    res.json({ ok: true, deleted, created })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/admin/scheduler/ingest-one/:playCricketId
router.post('/ingest-one/:playCricketId', async (req, res) => {
  const db = getDb()
  const pcId = String(req.params.playCricketId).trim()
  if (!pcId) return res.status(400).json({ error: 'playCricketId required' })

  const row = db.prepare(`SELECT * FROM scheduled_fixtures WHERE play_cricket_id = ?`).get(pcId)
  if (!row) return res.status(404).json({ error: 'Fixture not found in scheduled_fixtures' })

  const alreadyDone = db
    .prepare(`SELECT fixture_id FROM fixtures WHERE play_cricket_id = ? LIMIT 1`)
    .get(pcId)
  if (alreadyDone) {
    db.prepare(
      `UPDATE scheduled_fixtures SET status='done', ingested_at=COALESCE(ingested_at,?) WHERE play_cricket_id=?`
    ).run(new Date().toISOString(), pcId)
    return res.json({ ok: true, fixtureId: alreadyDone.fixture_id, alreadyDone: true })
  }

  db.prepare(
    `UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`
  ).run(pcId)
  try {
    const { ingestMatch } = require('../../db/ingestMatch')
    const { notifyMatchIngested } = require('../../utils/matchSummary')
    const { deleteJob } = require('../../utils/cronJobOrg')
    const { fixtureId } = await ingestMatch(pcId, { clubId: getAuthContext(req).clubId ?? null })
    db.prepare(
      `UPDATE scheduled_fixtures SET status='done', ingested_at=? WHERE play_cricket_id=?`
    ).run(new Date().toISOString(), pcId)
    if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
    notifyMatchIngested(fixtureId).catch(() => {})
    res.json({ ok: true, fixtureId })
  } catch (e) {
    db.prepare(
      `UPDATE scheduled_fixtures SET status='failed', error_msg=? WHERE play_cricket_id=?`
    ).run(e.message, pcId)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/scheduler/reingest-candidates
router.get('/reingest-candidates', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `WITH last_over AS (
        SELECT result_id, MAX(over_no) AS final_over FROM deliveries GROUP BY result_id
      ),
      batter_last_over AS (
        SELECT d.result_id, d.batter_id, MAX(d.over_no) AS last_over_faced
        FROM deliveries d GROUP BY d.result_id, d.batter_id
      ),
      dismissed AS (
        SELECT result_id, dismissed_batter_id FROM deliveries
        WHERE dismissed_batter_id IS NOT NULL GROUP BY result_id, dismissed_batter_id
      )
      SELECT DISTINCT f.fixture_id, f.home_team, f.away_team, f.match_date_iso,
        f.play_cricket_id
      FROM batter_last_over bl
      JOIN last_over lo ON lo.result_id = bl.result_id
      JOIN innings i ON i.result_id = bl.result_id
      JOIN fixtures f ON f.fixture_id = i.fixture_id
      JOIN players p ON p.player_id = bl.batter_id
      WHERE bl.last_over_faced < lo.final_over
        AND NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.result_id = bl.result_id AND d.dismissed_batter_id = bl.batter_id)
        AND NOT EXISTS (
          SELECT 1 FROM dismissals dis
          WHERE dis.fixture_id = i.fixture_id AND dis.innings_order = i.innings_order
            AND dis.batter_id = bl.batter_id AND dis.method = 'Retired'
        )
        AND f.play_cricket_id IS NOT NULL
        AND p.name NOT LIKE '%:%' AND p.name NOT LIKE 'Unknown%'
        AND p.name NOT LIKE 'Player #%' AND length(p.name) > 4
        AND NOT EXISTS (
          SELECT 1 FROM ingests ing
          WHERE ing.fixture_id = f.fixture_id
            AND ing.ingested_at > 1780576943000
        )
      ORDER BY f.match_date_iso DESC`
    )
    .all()
  res.json(rows)
})

// POST /api/admin/scheduler/reingest-bulk
router.post('/reingest-bulk', (req, res) => {
  const db = getDb()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : []
  if (!ids.length) return res.status(400).json({ error: 'ids required' })

  const nowMs = Date.now()
  const STAGGER_MS = 30_000
  let queued = 0

  const findSf = db.prepare(
    `SELECT play_cricket_id FROM scheduled_fixtures WHERE play_cricket_id = (SELECT play_cricket_id FROM fixtures WHERE fixture_id = ?)`
  )
  const resetSf = db.prepare(
    `UPDATE scheduled_fixtures SET status='pending', ingest_after=?, attempt_count=0, error_msg=NULL WHERE play_cricket_id=?`
  )

  db.transaction(() => {
    ids.forEach((fixtureId, i) => {
      const sf = findSf.get(String(fixtureId))
      if (!sf) return
      const after = new Date(nowMs + i * STAGGER_MS).toISOString()
      const info = resetSf.run(after, sf.play_cricket_id)
      if (info.changes) queued++
    })
  })()

  res.json({ ok: true, queued })

  setTimeout(() => {
    getScheduler()
      .processPendingIngests()
      .catch((e) => console.error('[admin] reingest-bulk process error:', e.message))
  }, 500)
})

// POST /api/admin/scheduler/retry
router.post('/retry', (req, res) => {
  const db = getDb()
  const info = db
    .prepare(
      `UPDATE scheduled_fixtures SET status='pending', error_msg=NULL, attempt_count=0 WHERE status='failed'`
    )
    .run()
  res.json({ ok: true, reset: info.changes })
})

// GET /api/admin/scheduler/stale
router.get('/stale', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT play_cricket_id, team_id, season_id, home_team, away_team,
        match_date_iso, ingest_after, attempt_count, status, error_msg
      FROM scheduled_fixtures
      WHERE status IN ('pending', 'failed')
        AND (
          status = 'failed'
          OR ingest_after < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
        )
      ORDER BY ingest_after ASC
      LIMIT 500`
    )
    .all()
  res.json(rows)
})

// POST /api/admin/scheduler/ignore
router.post('/ignore', (req, res) => {
  const db = getDb()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (!ids.length) return res.status(400).json({ error: 'ids array required' })
  const ph = ids.map(() => '?').join(',') // ph contains only '?' placeholders. nosemgrep
  const info = db
    .prepare(
      `UPDATE scheduled_fixtures SET status='ignored', error_msg=NULL WHERE play_cricket_id IN (${ph}) AND status IN ('pending', 'failed')` // nosemgrep
    )
    .run(...ids)
  res.json({ ok: true, ignored: info.changes })
})

module.exports = router

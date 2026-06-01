const express = require('express')
const router  = express.Router()
const multer  = require('multer')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { clerkClient } = require('@clerk/express')
const { getDb, closeDb, DB_PATH } = require('../db/schema')
const { fetchFixtureList, fetchTeamLabel } = require('../utils/resultsvault')
const { ingestMatch } = require('../db/ingestMatch')

// Lazy getter so scheduler.js (which requires admin.js indirectly) is only loaded after boot
function getScheduler() { return require('../scheduler') }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

// GET /api/admin/ingests — audit log of all ingest operations
router.get('/ingests', (req, res) => {
  const rows = getDb().prepare(`
    SELECT i.*, f.home_team, f.away_team, f.match_date
    FROM ingests i
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    ORDER BY i.ingested_at DESC
    LIMIT 100
  `).all()
  res.json(rows)
})

// GET /api/admin/export — hot backup of the SQLite database
router.get('/export', async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {}))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/import — replace the database with an uploaded .db file
router.post('/import', upload.single('db'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate SQLite magic bytes
  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer)
    closeDb()
    // Remove WAL and shared-memory files so the new DB starts clean
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix) } catch (_) {}
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath)
    getDb() // reopen and run migrations
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/player/:id — update display_name and/or is_sub flag
router.patch('/player/:id', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  if (!playerId) return res.status(400).json({ error: 'Invalid player id' })

  // Player may have deliveries but no players row (synthetic ID deleted by a name-merge,
  // or play-cricket exported a negative ID for an unregistered player). Create a stub so
  // display_name and is_sub can be saved and the player shows up in the stats table.
  const exists = db.prepare('SELECT 1 FROM players WHERE player_id = ?').get(playerId)
  if (!exists) {
    const fixture = db.prepare(`
      SELECT f.home_team, f.away_team FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.batter_id = ? OR d.bowler_id = ?
      LIMIT 1
    `).get(playerId, playerId)
    const isWhcc = t => /woking|horsell|whirlwind|whcc|hurricane/i.test(t || '')
    const team = fixture
      ? (isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
      : null
    db.prepare(`INSERT OR IGNORE INTO players (player_id, name, team) VALUES (?, ?, ?)`)
      .run(playerId, `Player #${playerId}`, team)
  }

  if ('display_name' in req.body) {
    const val = typeof req.body.display_name === 'string' ? req.body.display_name.trim() || null : null
    db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(val, playerId)
  }
  if ('is_sub' in req.body) {
    db.prepare(`UPDATE players SET is_sub = ? WHERE player_id = ?`).run(req.body.is_sub ? 1 : 0, playerId)
  }
  res.json({ ok: true })
})

// GET /api/admin/duplicate-players — groups of players sharing the same effective name
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.player_id, COALESCE(p.display_name, p.name) AS effective_name,
      p.name, p.display_name, p.team,
      COUNT(DISTINCT d.pid) AS appearances
    FROM players p
    LEFT JOIN (
      SELECT batter_id AS pid, result_id FROM deliveries WHERE batter_id IS NOT NULL
      UNION ALL
      SELECT bowler_id AS pid, result_id FROM deliveries WHERE bowler_id IS NOT NULL
    ) d ON d.pid = p.player_id
    WHERE lower(COALESCE(p.display_name, p.name)) IN (
      SELECT lower(COALESCE(display_name, name))
      FROM players
      WHERE COALESCE(display_name, name) IS NOT NULL AND COALESCE(display_name, name) != ''
        AND COALESCE(ignore_flag, 0) = 0
      GROUP BY lower(COALESCE(display_name, name))
      HAVING COUNT(*) > 1
    )
    AND COALESCE(p.ignore_flag, 0) = 0
    GROUP BY p.player_id
    ORDER BY lower(effective_name), appearances DESC
  `).all()

  const groups = {}
  for (const r of rows) {
    const key = r.effective_name.toLowerCase()
    if (!groups[key]) groups[key] = { name: r.effective_name, players: [] }
    groups[key].players.push({ player_id: r.player_id, name: r.name, display_name: r.display_name, team: r.team, appearances: r.appearances })
  }
  res.json(Object.values(groups))
})

// GET /api/admin/matches-missing-roles — ball-by-ball fixtures missing captain or WK
router.get('/matches-missing-roles', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.match_date,
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
      AND (lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
        OR lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%'
        OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%'
        OR lower(f.away_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%hurricane%')
    GROUP BY f.fixture_id
    HAVING has_captain = 0 OR has_wk = 0
    ORDER BY f.match_date DESC
  `).all()
  res.json(rows)
})

// POST /api/admin/merge-players — reassign all data from dropId to keepId, then delete dropId
router.post('/merge-players', (req, res) => {
  const keep = parseInt(req.body?.keepId, 10)
  const drop = parseInt(req.body?.dropId, 10)
  if (!keep || !drop || keep === drop) return res.status(400).json({ error: 'Invalid player IDs' })

  const db = getDb()
  try {
    db.transaction(() => {
      // deliveries — four columns reference player IDs
      db.prepare(`UPDATE deliveries SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET batter_id_ns = ? WHERE batter_id_ns = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET dismissed_batter_id = ? WHERE dismissed_batter_id = ?`).run(keep, drop)
      // dismissals
      db.prepare(`UPDATE dismissals SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET fielder_id = ? WHERE fielder_id = ?`).run(keep, drop)
      // tables with unique constraints on (fixture, player): skip conflicts, then clean up
      for (const tbl of ['player_flags', 'manual_batting', 'manual_bowling']) {
        db.prepare(`UPDATE OR IGNORE ${tbl} SET player_id = ? WHERE player_id = ?`).run(keep, drop)
        db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(drop)
      }
      // no unique constraint on player_id alone in these tables
      db.prepare(`UPDATE wk_assignments SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE wk_errors SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE match_captains SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      // remove the duplicate player record
      db.prepare(`DELETE FROM players WHERE player_id = ?`).run(drop)
    })()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/fetch-match — ingest a match directly from play-cricket by URL
router.post('/fetch-match', async (req, res) => {
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
    const { fixtureId, rvMatchId, results, matchMeta } = await ingestMatch(playCricketId, { userId: req.auth?.userId ?? null, userName })
    res.json({
      ok: true,
      playCricketId,
      fixtureId,
      rvMatchId,
      results,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null,
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    res.status(500).json({ error: err.message })
  }
})

// --- Scheduler endpoints ---

// GET /api/admin/scheduler/status
router.get('/scheduler/status', (req, res) => {
  const db = getDb()
  const teams = db.prepare('SELECT * FROM watched_teams ORDER BY added_at DESC').all()
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM scheduled_fixtures GROUP BY status
  `).all().reduce((acc, r) => { acc[r.status] = r.n; return acc }, {})
  const recent = db.prepare(`
    SELECT * FROM scheduled_fixtures ORDER BY match_date_iso DESC LIMIT 20
  `).all()
  res.json({ teams, queue: { pending: counts.pending || 0, done: counts.done || 0, failed: counts.failed || 0 }, recent })
})

// POST /api/admin/scheduler/teams — add a watched team by pasting a Play Cricket fixtures URL
router.post('/scheduler/teams', async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url required' })

  let teamId, seasonId
  try {
    const u = new URL(url)
    teamId   = u.searchParams.get('team_id')
    seasonId = u.searchParams.get('season_id')
  } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' })
  }
  if (!teamId || !seasonId) return res.status(400).json({ error: 'URL must contain team_id and season_id params' })

  try {
    const label = await fetchTeamLabel(teamId, seasonId)
    const db = getDb()
    db.prepare(`INSERT OR IGNORE INTO watched_teams (team_id, season_id, label, added_at) VALUES (?, ?, ?, ?)`)
      .run(parseInt(teamId), parseInt(seasonId), label, new Date().toISOString())
    const row = db.prepare('SELECT * FROM watched_teams WHERE team_id = ? AND season_id = ?').get(parseInt(teamId), parseInt(seasonId))

    // Kick off discovery in the background
    getScheduler().discoverFixtures().catch(e => console.error('[scheduler] post-add discover error:', e))

    res.json({ ok: true, team: row })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/scheduler/teams/:id
router.delete('/scheduler/teams/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM watched_teams WHERE id = ?').run(parseInt(req.params.id))
  res.json({ ok: true })
})

// POST /api/admin/scheduler/discover — manually trigger fixture discovery
router.post('/scheduler/discover', async (req, res) => {
  try {
    const added = await getScheduler().discoverFixtures()
    res.json({ ok: true, added: added || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/scheduler/cron-jobs — fetch live job state from cron-job.org for pending fixtures
router.get('/scheduler/cron-jobs', async (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT play_cricket_id, cron_job_id, home_team, away_team, match_date_iso, ingest_after, attempt_count
    FROM scheduled_fixtures
    WHERE cron_job_id IS NOT NULL AND status = 'pending'
    ORDER BY ingest_after
  `).all()
  if (!rows.length) return res.json([])

  const { getJob } = require('../utils/cronJobOrg')
  const results = await Promise.allSettled(rows.map(async r => {
    const data = await getJob(r.cron_job_id)
    return {
      play_cricket_id: r.play_cricket_id,
      cron_job_id: r.cron_job_id,
      home_team: r.home_team,
      away_team: r.away_team,
      match_date_iso: r.match_date_iso,
      ingest_after: r.ingest_after,
      attempt_count: r.attempt_count,
      job_url: data?.job?.url ?? null,
      next_execution: data?.job?.nextExecution ?? null,
      enabled: data?.job?.enabled ?? null,
    }
  }))
  res.json(results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean))
})

// POST /api/admin/scheduler/retry — reset failed rows back to pending
router.post('/scheduler/retry', (req, res) => {
  const db = getDb()
  const info = db.prepare(`UPDATE scheduled_fixtures SET status='pending', error_msg=NULL, attempt_count=0 WHERE status='failed'`).run()
  res.json({ ok: true, reset: info.changes })
})

// DELETE /api/admin/match/:id — remove a fixture and all associated data
router.delete('/match/:id', (req, res) => {
  const db = getDb()
  const fixtureId = req.params.id
  if (!fixtureId) return res.status(400).json({ error: 'fixture_id required' })
  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM wk_errors          WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM wk_assignments     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM match_captains     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM player_flags       WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM dismissals         WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_batting     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_bowling     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_extras      WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_fielding    WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM ingests            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id = ?)`).run(fixtureId)
      db.prepare(`DELETE FROM innings            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM fixtures           WHERE fixture_id = ?`).run(fixtureId)
    })()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── User access management ────────────────────────────────────────────────────
// Requires CLERK_SECRET_KEY — no-op in local dev without it.

// GET /api/admin/users — list all Clerk users with their access metadata
router.get('/users', async (req, res) => {
  if (!process.env.CLERK_SECRET_KEY) return res.json([])
  try {
    const { data: users } = await clerkClient.users.getUserList({ limit: 500 })
    if (users.length >= 500) console.warn('[admin] getUserList hit limit of 500 — some users may be missing')
    res.json(users.map(u => ({
      id:           u.id,
      email:        u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName:    u.firstName,
      lastName:     u.lastName,
      canUpload:    u.publicMetadata?.canUpload    === true,
      isSuperAdmin: u.publicMetadata?.isSuperAdmin === true,
      accessGroups: u.publicMetadata?.accessGroups ?? [],
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/users/:userId — update a user's access metadata
// Body: { canUpload?: bool, isSuperAdmin?: bool, accessGroups?: [{team, year}] }
router.patch('/users/:userId', async (req, res) => {
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({ error: 'Clerk not configured' })
  const { userId } = req.params
  const allowed = ['canUpload', 'isSuperAdmin', 'accessGroups']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' })
  if (updates.accessGroups !== undefined) {
    if (!Array.isArray(updates.accessGroups) ||
        !updates.accessGroups.every(g => typeof g.team === 'string' && g.year != null)) {
      return res.status(400).json({ error: 'accessGroups must be an array of {team, year}' })
    }
  }
  try {
    const user = await clerkClient.users.getUser(userId)
    const merged = { ...user.publicMetadata, ...updates }
    await clerkClient.users.updateUserMetadata(userId, { publicMetadata: merged })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

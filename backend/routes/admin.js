const express = require('express')
const router  = express.Router()
const { apiLimiter } = require('../middleware/rateLimit')
router.use(apiLimiter)
const multer  = require('multer')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { clerkClient } = require('@clerk/express')
const { getDb, closeDb, DB_PATH } = require('../db/schema')
const { resolveTeamSeasons } = require('../utils/resultsvault')
const { ingestMatch } = require('../db/ingestMatch')
const { isWhccTeam, whccFixtureWhere, whccCol } = require('../utils/db')
const { getAuthContext } = require('../middleware/auth')

// Lazy getter so scheduler.js (which requires admin.js indirectly) is only loaded after boot
function getScheduler() { return require('../scheduler') }

// Verified auth context (attached by attachAuthContext middleware).
function getAdminMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, isClubAdmin: ctx.isClubAdmin, groups: ctx.groups }
}
function isSuperAdmin(req) { return getAdminMeta(req).isSuperAdmin }
function canManageUsers(req) { const m = getAdminMeta(req); return m.isSuperAdmin || m.isClubAdmin }

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
    const team = fixture
      ? (isWhccTeam(fixture.home_team) ? fixture.home_team : isWhccTeam(fixture.away_team) ? fixture.away_team : null)
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

// GET /api/admin/duplicate-players — groups of WHCC players sharing the same effective name.
// Scoped to WHCC players (team IS NULL or matches our club markers) — we never want to merge
// opposition players who happen to share a name with one of ours.
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
  const isWhcc = `(p.team IS NULL OR ${whccCol('p.team')})`
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
        AND (team IS NULL OR ${whccCol('team')})
      GROUP BY lower(COALESCE(display_name, name))
      HAVING COUNT(*) > 1
    )
    AND COALESCE(p.ignore_flag, 0) = 0
    AND ${isWhcc}
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
      AND ${whccFixtureWhere()}
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
    const { fixtureId, rvMatchId, results, matchMeta, maxOvers, associated } = await ingestMatch(playCricketId, { userId: req.auth?.userId ?? null, userName })
    res.json({
      ok: true,
      playCricketId,
      fixtureId,
      rvMatchId,
      results,
      maxOvers: maxOvers ?? null,
      associated: associated ?? null,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null,
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/associate-match — manually link a fixture to a watched team+season
// Body: { fixture_id, team_id, season_id }
router.post('/associate-match', (req, res) => {
  const { fixture_id, team_id, season_id } = req.body || {}
  if (!fixture_id || !team_id || !season_id) return res.status(400).json({ error: 'fixture_id, team_id and season_id required' })

  const db = getDb()
  const fixture = db.prepare('SELECT play_cricket_id, home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?').get(String(fixture_id))
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  if (!fixture.play_cricket_id) return res.status(400).json({ error: 'Fixture has no play_cricket_id — cannot associate' })

  db.prepare(`
    INSERT OR REPLACE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)
  `).run(
    parseInt(fixture.play_cricket_id),
    parseInt(team_id), parseInt(season_id),
    fixture.match_date_iso, fixture.match_date_iso,
    new Date().toISOString(),
    fixture.home_team, fixture.away_team,
    new Date().toISOString(),
  )
  res.json({ ok: true })
})

// GET /api/admin/teams — all known team+season combos for access group assignment.
// Combines watched_teams (current) with scheduled_fixtures history so past seasons
// remain assignable even after the watched_team entry is removed.
router.get('/teams', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      wt.id,
      t.team_id,
      t.season_id,
      COALESCE(wt.label, 'Team ' || t.team_id)                              AS label,
      COALESCE(wt.year, substr(MIN(sf.match_date_iso), 1, 4))               AS year
    FROM (
      SELECT team_id, season_id FROM scheduled_fixtures
      UNION
      SELECT team_id, season_id FROM watched_teams
    ) t
    LEFT JOIN watched_teams      wt ON wt.team_id = t.team_id AND wt.season_id = t.season_id
    LEFT JOIN scheduled_fixtures sf ON sf.team_id = t.team_id AND sf.season_id = t.season_id
    GROUP BY t.team_id, t.season_id
    ORDER BY year DESC, label
  `).all()
  res.json(rows)
})

// (Past-season registration is gone — adding a team via POST /scheduler/teams now resolves
// and registers every season the team played from 2025 onward in one action.)

// --- Scheduler endpoints ---

// GET /api/admin/scheduler/status
router.get('/scheduler/status', (req, res) => {
  const db = getDb()
  const teams = db.prepare('SELECT * FROM watched_teams ORDER BY added_at DESC').all()
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM scheduled_fixtures GROUP BY status
  `).all().reduce((acc, r) => { acc[r.status] = r.n; return acc }, {})
  // Per (team_id, season_id) status counts so the UI can show per-year progress.
  const byTeam = db.prepare(`
    SELECT team_id, season_id, status, COUNT(*) AS n
    FROM scheduled_fixtures GROUP BY team_id, season_id, status
  `).all()
  const recent = db.prepare(`
    SELECT * FROM scheduled_fixtures ORDER BY match_date_iso DESC LIMIT 20
  `).all()
  res.json({ teams, queue: { pending: counts.pending || 0, done: counts.done || 0, failed: counts.failed || 0 }, byTeam, recent })
})

// POST /api/admin/scheduler/teams — add a team by pasting any Play Cricket URL for it.
// Body: { url }. Only the team_id is used — the season_id in the URL is ignored. Every season
// the team played from 2025 onward is resolved and registered as its own watched_teams row;
// past results queue immediately (staggered) and the live season is set up for ongoing discovery.
router.post('/scheduler/teams', async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url required' })

  let teamId
  try {
    teamId = new URL(url).searchParams.get('team_id')
  } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' })
  }
  if (!teamId) return res.status(400).json({ error: 'URL must contain a team_id param' })

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
      upsert.run(parseInt(teamId), parseInt(s.season_id), s.label, s.year, now)
    }
    const rows = db.prepare('SELECT * FROM watched_teams WHERE team_id = ? ORDER BY year').all(parseInt(teamId))

    // Queue every resolved season's fixtures now (covers past seasons, which the daily
    // discoverFixtures skips), then ingest anything already due.
    getScheduler().queueTeamSeasons(teamId, seasons)
    getScheduler().processPendingIngests()
      .catch(e => console.error('[scheduler] post-add ingest error:', e))

    res.json({
      ok: true,
      teams: rows,
      resolved: seasons.map(s => ({ season_id: parseInt(s.season_id), year: s.year, label: s.label, fixtures: s.fixtures.length })),
    })
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

// POST /api/admin/scheduler/rescan — re-resolve & re-queue every watched team's seasons,
// backfilling past-season fixtures that the daily discovery skips. Then ingest anything due.
router.post('/scheduler/rescan', async (req, res) => {
  try {
    const added = await getScheduler().rescanAllSeasons()
    getScheduler().processPendingIngests().catch(e => console.error('[scheduler] post-rescan ingest error:', e))
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
  const isIngested = db.prepare(`SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`)

  // Build the live-state row for one scheduled fixture. Read-only: stale rows whose match is
  // already ingested are simply omitted from the table — the 30-min poller (processPendingIngests)
  // marks them done, so this GET handler performs no database mutation.
  async function liveStateFor(r) {
    const base = {
      play_cricket_id: r.play_cricket_id,
      cron_job_id: r.cron_job_id,
      home_team: r.home_team,
      away_team: r.away_team,
      match_date_iso: r.match_date_iso,
      ingest_after: r.ingest_after,
      attempt_count: r.attempt_count,
    }
    const liveJob = (await getJob(r.cron_job_id))?.job ?? null
    if (liveJob) {
      return { ...base, job_url: liveJob.url ?? null, next_execution: liveJob.nextExecution ?? null, enabled: liveJob.enabled ?? null, job_missing: false }
    }
    // Job gone (fired+deleted or expired). Already ingested → omit; otherwise show as expired.
    if (isIngested.get(String(r.play_cricket_id))) return null
    return { ...base, job_url: null, next_execution: null, enabled: null, job_missing: true }
  }

  const results = await Promise.allSettled(rows.map(liveStateFor))
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

// GET /api/admin/users — list Clerk users (super admin sees all; club admin sees all but can only change access groups for their teams)
router.get('/users', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
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
      isClubAdmin:  u.publicMetadata?.isClubAdmin  === true,
      accessGroups: u.publicMetadata?.accessGroups ?? [],
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/users/:userId — update a user's access metadata
// Body: { canUpload?: bool, isSuperAdmin?: bool, isClubAdmin?: bool, accessGroups?: [{team_id, season_id}] }
router.patch('/users/:userId', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({ error: 'Clerk not configured' })

  const { isSuperAdmin: callerIsSuper, groups: callerGroups } = getAdminMeta(req)
  const { userId } = req.params
  // Club admins can only change accessGroups, and only for teams they manage
  const allowed = callerIsSuper ? ['canUpload', 'isSuperAdmin', 'isClubAdmin', 'accessGroups'] : ['accessGroups']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' })
  if (updates.accessGroups !== undefined) {
    if (!Array.isArray(updates.accessGroups) ||
        !updates.accessGroups.every(g => g.team_id != null && g.season_id != null)) {
      return res.status(400).json({ error: 'accessGroups must be an array of {team_id, season_id}' })
    }
    updates.accessGroups = updates.accessGroups.map(g => ({ team_id: Number(g.team_id), season_id: Number(g.season_id) }))
    // Club admins can only grant access to teams they manage — merge instead of replace
    if (!callerIsSuper && callerGroups.length > 0) {
      const user = await clerkClient.users.getUser(userId)
      const existing = Array.isArray(user.publicMetadata?.accessGroups) ? user.publicMetadata.accessGroups : []
      // Keep any groups the club admin doesn't manage, merge in their changes
      const unmanaged = existing.filter(g => !callerGroups.some(cg => cg.team_id === g.team_id && cg.season_id === g.season_id))
      updates.accessGroups = [...unmanaged, ...updates.accessGroups.filter(g => callerGroups.some(cg => cg.team_id === g.team_id && cg.season_id === g.season_id))]
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

// GET /api/admin/my-groups — returns the requesting user's access groups enriched with labels.
// Super admins see all watched_teams (useful for admin filtering too).
// Regular users see only their own JWT groups resolved against watched_teams.
router.get('/my-groups', (req, res) => {
  const db = getDb()
  const { isSuperAdmin, groups } = getAdminMeta(req)

  let rows
  if (isSuperAdmin) {
    rows = db.prepare(`
      SELECT team_id, season_id, label, year
      FROM watched_teams ORDER BY year DESC, label ASC
    `).all()
  } else {
    if (!groups.length) return res.json([])
    const clauses = groups.map(() => '(wt.team_id = ? AND wt.season_id = ?)').join(' OR ')
    const params  = groups.flatMap(g => [Number(g.team_id), Number(g.season_id)])
    rows = db.prepare(`
      SELECT wt.team_id, wt.season_id, wt.label, wt.year
      FROM watched_teams wt
      WHERE ${clauses}
      ORDER BY wt.year DESC, wt.label ASC
    `).all(...params)
  }

  res.json(rows.map(r => ({
    team_id:   r.team_id,
    season_id: r.season_id,
    label:     r.label,
    year:      r.year ?? null,
    display:   r.year ? `${r.label} ${r.year}` : r.label,
  })))
})

module.exports = router
